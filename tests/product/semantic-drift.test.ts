/**
 * V2-D2 inside the product — per-version IRs and the advisory layer's wiring
 * (WS-R9, WS-R26, WS-R27, WS-R29).
 *
 * The core module is tested as a function in `tests/property/semantic-drift.test.ts`.
 * What is tested here is everything around it: that an IR is extracted once and
 * stored content-addressed, that it survives a reload and an index rebuild,
 * that the offline stand-in extraction produces a **valid** Task IR rather than
 * something that only looks like one, and that Layer 2 failing leaves Layer 1
 * exactly where it was.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { compareVersionIrs } from "../../src/critic/judged/drift.js";
import { preservationFailed, preservationResult } from "../../src/critic/preservation.js";
import { TaskIRSchema } from "../../src/ir/schema.js";
import { irForVersion, preservationFor, stubExtraction, storedIr } from "../../web/lib/preservation";
import {
  addPromptVersion,
  dataDir,
  loadConversation,
  newConversation,
  openStoreIndex,
  pinRequirement,
  saveConversation,
  store,
  type Conversation,
} from "../../web/lib/store";

function isolated(): void {
  process.env["FORGE_DATA_DIR"] = join(mkdtempSync(join(tmpdir(), "forge-v2d2-")), "data");
  // The offline stand-in extraction, for the same reason `stubDeps` exists:
  // the wiring must be exercisable with no network and no key (NFR-007).
  process.env["FORGE_CHAT_STUB"] = "1";
}

const V1 = [
  "Build a data pipeline agent.",
  "- It must use PostgreSQL.",
  "- It must never log credentials.",
  "- It must always run the test suite.",
].join("\n");

const V2 = ["Build a data pipeline agent.", "- It must use PostgreSQL.", "- It must always run the test suite."].join(
  "\n",
);

function twoVersions(): Conversation {
  const convo = newConversation({ title: "drift" });
  addPromptVersion(convo, V1, "model", { action: "CREATE", turnId: "t1" });
  addPromptVersion(convo, V2, "model", { action: "REVISE", turnId: "t2" });
  saveConversation(convo);
  return convo;
}

describe("the stand-in extraction is a real Task IR, not a shape that resembles one", () => {
  beforeEach(isolated);

  it("passes the IR schema", () => {
    const parsed = TaskIRSchema.safeParse(stubExtraction(V1));
    expect(parsed.success).toBe(true);
  });

  it("carries the obligations of the text as constraints, deterministically", () => {
    const first = stubExtraction(V1);
    const second = stubExtraction(V1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.constraints.map((c) => c.statement)).toContain("It must never log credentials.");
  });

  it("attributes every node to user input, never to a model's claim (INV-016)", () => {
    for (const node of stubExtraction(V1).constraints) expect(node.source_ref).toBe("user_input");
  });
});

describe("a version's IR is extracted once and stored content-addressed (WS-R26)", () => {
  beforeEach(isolated);

  it("extracts on first ask and reuses the stored object afterwards", async () => {
    const convo = twoVersions();
    const first = await irForVersion(convo, 1);
    expect(first.extracted).toBe(true);
    const second = await irForVersion(convo, 1);
    expect(second.extracted).toBe(false);
    expect(JSON.stringify(second.ir)).toBe(JSON.stringify(first.ir));
    expect(convo.versionIrs).toHaveLength(1);
  });

  it("survives a reload: the record is folded from the log and the IR read by hash", async () => {
    const convo = twoVersions();
    await irForVersion(convo, 1);
    await irForVersion(convo, 2);
    saveConversation(convo);

    const reloaded = loadConversation(convo.id)!;
    expect(reloaded.versionIrs.map((e) => e.v)).toEqual([1, 2]);
    for (const record of reloaded.versionIrs) expect(record.irHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(storedIr(reloaded, 1)).not.toBeNull();
    expect(JSON.stringify(storedIr(reloaded, 2))).toBe(JSON.stringify(storedIr(convo, 2)));
  });

  it("is projected into the derivable index and survives its deletion (AC-032)", async () => {
    const convo = twoVersions();
    await irForVersion(convo, 1);
    saveConversation(convo);
    const read = (): Array<Record<string, unknown>> => {
      const index = openStoreIndex(store());
      try {
        return index.query("SELECT v, ir_hash, boundary_id FROM version_ir WHERE conversation_id = ?", convo.id);
      } finally {
        index.close();
      }
    };
    const before = read();
    expect(before).toHaveLength(1);
    rmSync(join(dataDir(), "index.sqlite"), { force: true });
    expect(read()).toEqual(before);
  });

  it("refuses to extract a version that does not exist rather than inventing one", async () => {
    const convo = twoVersions();
    await expect(irForVersion(convo, 9)).rejects.toThrow(/Version 9 does not exist/);
  });
});

describe("the two layers are computed together and stay apart (WS-R27, WS-R28)", () => {
  beforeEach(isolated);

  it("reports the dropped statement as advice, at warning severity", async () => {
    const convo = twoVersions();
    const view = await preservationFor(convo, { from: 1, to: 2 });
    expect(view.drift?.layer).toBe("judged");
    const statements = view.drift!.findings.map((f) => f.from.statement);
    expect(statements).toContain("It must never log credentials.");
    for (const finding of view.drift!.findings) {
      expect(finding.diagnostic.severity).toBe("warning");
      expect(finding.diagnostic.source).toBe("judged");
    }
  });

  it("leaves pinned material to Layer 1 entirely (WS-R26)", async () => {
    const convo = twoVersions();
    pinRequirement(convo, { text: "It must never log credentials.", fromVersion: 1 });
    const view = await preservationFor(convo, { from: 1, to: 2 });
    expect(view.drift!.skippedPinned).toBeGreaterThan(0);
    expect(view.drift!.findings.map((f) => f.from.statement)).not.toContain("It must never log credentials.");
    // And Layer 1 reports it as the error it is.
    expect(view.result.ledger.diagnostics.map((d) => d.code)).toEqual(["FORGE-W005"]);
    expect(preservationFailed(view.result)).toBe(true);
  });

  it("gives the same Layer 1 verdict whether or not Layer 2 ran (AC-040)", async () => {
    const convo = twoVersions();
    pinRequirement(convo, { text: "It must never log credentials.", fromVersion: 1 });
    const withoutDrift = await preservationFor(convo, null);
    const withDrift = await preservationFor(convo, { from: 1, to: 2 });
    expect(JSON.stringify(withDrift.result.ledger)).toBe(JSON.stringify(withoutDrift.result.ledger));
  });

  it("keeps Layer 1 intact when a judged finding contradicts it (AC-041)", async () => {
    const convo = twoVersions();
    pinRequirement(convo, { text: "It must never log credentials.", fromVersion: 1 });
    const view = await preservationFor(convo, { from: 1, to: 2 });
    // A judged report built to say the opposite of the ledger changes nothing.
    const contradicting = compareVersionIrs(
      { v: 1, ir: (await irForVersion(convo, 1)).ir },
      { v: 2, ir: (await irForVersion(convo, 1)).ir },
    );
    const combined = preservationResult(view.result.ledger, contradicting);
    expect(contradicting.findings).toEqual([]);
    expect(combined.ledger.diagnostics).toHaveLength(1);
    expect(preservationFailed(combined)).toBe(true);
  });

  it("every drift citation resolves against the rendering the view returns (DG-R4)", async () => {
    const convo = twoVersions();
    const view = await preservationFor(convo, { from: 1, to: 2 });
    for (const finding of view.drift!.findings) {
      for (const evidence of finding.diagnostic.evidence) {
        expect(evidence.kind).toBe("span");
        if (evidence.kind !== "span") continue;
        const source = view.citations[evidence.artifact_path];
        expect(source).toBeDefined();
        expect(source!.slice(evidence.start, evidence.end)).toBe(evidence.quote);
      }
    }
  });
});

/**
 * V2-R step 11: the two extractions a drift check needs are independent, so
 * they must not be serialised.
 *
 * Measured before the fix: 205 seconds on a live run, and on a slow reasoning
 * model a client aborted the request with `UND_ERR_HEADERS_TIMEOUT` after five
 * minutes — the advisory layer failing not because it was wrong but because it
 * took too long to answer. V2-E hit the same wall in candidate generation and
 * fixed it there by dispatching the independent calls together; it recorded
 * that the identical fix applied here and was outside its scope. This is that
 * fix.
 *
 * Concurrency is asserted by observation, not by timing: the test counts how
 * many extractions are in flight at once. A wall-clock assertion would be
 * flaky on a loaded machine and would prove less.
 */
describe("the two extractions a drift check needs run together (V2-R)", () => {
  beforeEach(isolated);

  it("dispatches both version extractions concurrently", async () => {
    const { preservationFor } = await import("../../web/lib/preservation");
    const { addPromptVersion, newConversation, saveConversation } = await import("../../web/lib/store");

    const convo = newConversation({ title: "concurrency", target: "generic" });
    addPromptVersion(convo, "Build an agent. It must use PostgreSQL.", "model", {
      action: "CREATE",
      turnId: "t1",
    });
    addPromptVersion(convo, "Build an agent. It must use PostgreSQL and never log credentials.", "model", {
      action: "REVISE",
      turnId: "t2",
    });
    saveConversation(convo);
    // A real provider is needed for this path: the stub returns without ever
    // reaching fetch, which is exactly what must not be measured here.
    const { saveProvider } = await import("../../web/lib/providers");
    process.env["FORGE_APP_SECRET"] = "test-secret-at-least-16-chars";
    saveProvider("opencode-go", { apiKey: "test-key", enabled: true });

    let inFlight = 0;
    let peak = 0;
    const realFetch = globalThis.fetch;
    const draft = (statement: string): string =>
      JSON.stringify({
        objective: { statement, kind: "feature", success_definition: "It runs", derived_from: "s1" },
        goals: [{ id: "g1", statement, priority: "must", acceptance: ["It runs"], derived_from: "s1" }],
        constraints: [],
        non_goals: [],
        scope: { include: ["**/*"], exclude: [], blast_radius: "module", derived_from: "s1" },
        required_capabilities: [],
        assumptions: [],
        open_questions: [],
        verification: [],
        deliverables: [{ id: "d1", kind: "code_change", description: "the agent", derived_from: "s1" }],
        risk: { level: "low", factors: [] },
      });

    globalThis.fetch = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Long enough that a serialised pair cannot overlap by accident, short
      // enough to keep the suite fast.
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          model: "kimi-k3",
          choices: [{ index: 0, message: { role: "assistant", content: draft("Build an agent") }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const stub = process.env["FORGE_CHAT_STUB"];
    delete process.env["FORGE_CHAT_STUB"];
    try {
      await preservationFor(convo, { from: 1, to: 2 }, { provider: "opencode-go", model: "kimi-k3" });
    } finally {
      globalThis.fetch = realFetch;
      if (stub === undefined) delete process.env["FORGE_CHAT_STUB"];
      else process.env["FORGE_CHAT_STUB"] = stub;
    }

    expect(peak, "the two extractions were serialised").toBeGreaterThan(1);
  });
});
