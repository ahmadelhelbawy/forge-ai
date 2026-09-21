/**
 * `AC-046`: a package built by the workspace and one built by the CLI from the
 * same IR and profile are byte-identical except `run.json`.
 *
 * This is the V2-R parity test's successor, and it exists for the same reason.
 * `web/lib/package.ts` *calls* `assemblePackage`; the moment it grows its own
 * assembly — a field the CLI does not set, a different key order, a second
 * hashing rule — the bytes diverge and this fails. Without it, "the workspace
 * and the CLI produce the same thing" is a statement about intentions.
 *
 * The one asymmetry is deliberate and is asserted rather than hidden: the
 * workspace has a pinned ledger and the CLI does not, so an unpinned
 * conversation is used for byte-equality, and a separate test shows what a pin
 * changes — the requirement manifest, and nothing that `semantic_id` covers.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { assemblePackage } from "../../src/package/assemble.js";
import { compile } from "../../src/compile/compile.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import type { TaskIR } from "../../src/ir/schema.js";
import { packageVersion } from "../../web/lib/package";
import {
  addPromptVersion,
  loadConversation,
  newConversation,
  pinRequirement,
  saveConversation,
  type Conversation,
} from "../../web/lib/store";

function isolated(): void {
  const root = join(mkdtempSync(join(tmpdir(), "forge-v2f-pkg-")), "data");
  mkdirSync(root, { recursive: true });
  process.env["FORGE_DATA_DIR"] = root;
  // NFR-007: the whole path runs with no network and no key.
  process.env["FORGE_CHAT_STUB"] = "1";
}

const PROMPT = [
  "You are a code review assistant for a TypeScript service.",
  "",
  "You must never approve a change that removes a test.",
  "Report findings with a file path and a line number.",
].join("\n");

function conversation(): Conversation {
  const convo = newConversation({ title: "package", target: "claude-code" });
  addPromptVersion(convo, PROMPT, "model", { action: "CREATE", turnId: "t1" });
  saveConversation(convo);
  return loadConversation(convo.id)!;
}

/** The CLI's half: the same IR and profile through `assemblePackage` directly. */
function cliPackage(ir: TaskIR, profileId: string, generatedAt: string) {
  const profile = builtinProfiles().get(profileId);
  const result = compile(ir, profile, { taskSlug: ir.objective.kind });
  return assemblePackage({ ir, profile, result, generatedAt });
}

describe("R7/AC-046 — the workspace packages through the same assembler", () => {
  beforeEach(isolated);

  it("produces byte-identical semantic files and the same semantic_id", async () => {
    const convo = conversation();
    const web = await packageVersion(convo, convo.currentV, "claude-code", {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    // The IR is read back out of the package the workspace produced, so both
    // halves demonstrably compile the same object rather than two that happen
    // to agree.
    const cli = cliPackage(irOf(web), "claude-code", "2026-01-01T00:00:00.000Z");

    expect(web.package.semanticId).toBe(cli.semanticId);
    expect(web.package.files.map((f) => f.path)).toEqual(cli.files.map((f) => f.path));
    for (const [i, f] of web.package.files.entries()) {
      expect(f.content, `${f.path} differs between the workspace and the CLI`).toBe(cli.files[i]!.content);
    }
  });

  it("holds on every shipped profile", async () => {
    const convo = conversation();
    for (const id of builtinProfiles().ids) {
      const web = await packageVersion(convo, convo.currentV, id, {
        generatedAt: "2026-01-01T00:00:00.000Z",
      });
      saveConversation(convo);
      const cli = cliPackage(irOf(web), id, "2026-01-01T00:00:00.000Z");
      expect(web.package.semanticId, `${id} semantic_id differs`).toBe(cli.semanticId);
      expect(web.package.files.map((f) => f.content), `${id} files differ`).toEqual(
        cli.files.map((f) => f.content),
      );
    }
  });

  /**
   * The asymmetry, stated rather than avoided. A pin adds a `user_stated`
   * requirement — which is the workspace's whole advantage over the CLI here —
   * and changes the manifest and `package.json`, but not `semantic_id`, because
   * pinning changes no byte of any artifact (`PK-R3`).
   */
  it("records a pinned requirement without changing the compilation's identity", async () => {
    const convo = conversation();
    const before = await packageVersion(convo, convo.currentV, "claude-code", {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    saveConversation(convo);

    const pinned = loadConversation(convo.id)!;
    pinRequirement(pinned, { text: "You must never approve a change that removes a test." });
    saveConversation(pinned);

    const after = await packageVersion(pinned, pinned.currentV, "claude-code", {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(after.package.semanticId).toBe(before.package.semanticId);

    const manifestOf = (p: typeof after): Array<{ origin: string }> =>
      JSON.parse(p.package.files.find((f) => f.path === "requirements.json")!.content).requirements;
    expect(manifestOf(before).some((r) => r.origin === "user_stated")).toBe(false);
    expect(manifestOf(after).some((r) => r.origin === "user_stated")).toBe(true);
  });

  it("writes no prompt version — packaging is a read (WS-R2)", async () => {
    const convo = conversation();
    const versionsBefore = convo.promptVersions.length;
    await packageVersion(convo, convo.currentV, "kiro", { generatedAt: "2026-01-01T00:00:00.000Z" });
    saveConversation(convo);
    expect(loadConversation(convo.id)!.promptVersions).toHaveLength(versionsBefore);
  });

  it("reuses a stored IR rather than extracting twice", async () => {
    const convo = conversation();
    const first = await packageVersion(convo, convo.currentV, "claude-code", {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(first.extracted).toBe(true);
    saveConversation(convo);
    const reloaded = loadConversation(convo.id)!;
    const second = await packageVersion(reloaded, reloaded.currentV, "claude-code", {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(second.extracted).toBe(false);
    expect(second.package.semanticId).toBe(first.package.semanticId);
  });
});

/** The IR the workspace compiled, read back out of the package it produced. */
function irOf(built: Awaited<ReturnType<typeof packageVersion>>): TaskIR {
  return JSON.parse(built.package.files.find((f) => f.path === "task-ir.json")!.content) as TaskIR;
}
