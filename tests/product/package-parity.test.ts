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
 * "The same inputs" means ALL the package's semantic inputs, and the pinned
 * ledger is one of them (`PK-R3`). The workspace holds a ledger and
 * `forge package` has none, so parity is asserted twice: with an unpinned
 * conversation (both ledgers empty), and with a pinned one whose ledger is
 * handed to the CLI-side assembly verbatim. A pinned workspace package and an
 * unpinned CLI package are **different contracts**, and must not share an id —
 * V2-G binds evidence to that id (`EV-R2`).
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { assemblePackage } from "../../src/package/assemble.js";
import { compile } from "../../src/compile/compile.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import type { TaskIR } from "../../src/ir/schema.js";
import type { LedgerEntry } from "../../src/critic/deterministic/ledger.js";
import { packageVersion } from "../../web/lib/package";
import {
  addPromptVersion,
  loadConversation,
  ledgerEntries,
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

/**
 * The CLI's half: the same IR and profile through `assemblePackage` directly.
 * `ledger` defaults to empty, which is exactly what `forge package` supplies.
 */
function cliPackage(
  ir: TaskIR,
  profileId: string,
  generatedAt: string,
  ledger: readonly LedgerEntry[] = [],
) {
  const profile = builtinProfiles().get(profileId);
  const result = compile(ir, profile, { taskSlug: ir.objective.kind });
  return assemblePackage({ ir, profile, result, ledger, generatedAt });
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
   * Truly equivalent inputs with a pin present: the workspace's ledger is
   * handed to the CLI-side assembly verbatim, so every semantic input is equal
   * and every semantic byte must be too. `kiro` is the target on which the
   * V2-F acceptance run first saw the two packages disagree.
   */
  it("is byte-identical with a pinned ledger when the CLI is given the same ledger", async () => {
    const convo = conversation();
    pinRequirement(convo, { text: "You must never approve a change that removes a test." });
    pinRequirement(convo, { text: "Every finding cites a file path and a line number." });
    saveConversation(convo);
    const pinned = loadConversation(convo.id)!;

    for (const id of ["kiro", ...builtinProfiles().ids.filter((p) => p !== "kiro")]) {
      const web = await packageVersion(pinned, pinned.currentV, id, {
        generatedAt: "2026-01-01T00:00:00.000Z",
      });
      saveConversation(pinned);
      const ledger = ledgerEntries(pinned) as readonly LedgerEntry[];
      expect(ledger).toHaveLength(2);
      const cli = cliPackage(irOf(web), id, "2031-07-04T12:34:56.000Z", ledger);

      expect(web.package.semanticId, `${id} semantic_id differs`).toBe(cli.semanticId);
      expect(web.package.files.map((f) => f.path)).toEqual(cli.files.map((f) => f.path));
      for (const [i, f] of web.package.files.entries()) {
        expect(f.content, `${id}: ${f.path} differs with equal inputs`).toBe(cli.files[i]!.content);
      }
      // Different clocks, so run.json alone differs (TS-R3).
      expect(web.package.run.content).not.toBe(cli.run.content);
    }
  });

  /**
   * The acceptance-run finding, as a regression. A pin adds a `user_stated`
   * requirement — a different Execution Contract from the CLI's unpinned one,
   * though the compilation (every artifact) is the same. The two must not
   * share a `semantic_id`, or evidence for one binds to the other.
   */
  it("gives a pinned workspace package and an unpinned CLI package different ids", async () => {
    const convo = conversation();
    pinRequirement(convo, { text: "You must never approve a change that removes a test." });
    saveConversation(convo);
    const pinned = loadConversation(convo.id)!;

    const web = await packageVersion(pinned, pinned.currentV, "kiro", {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const cli = cliPackage(irOf(web), "kiro", "2026-01-01T00:00:00.000Z");

    const manifestOf = (files: readonly { path: string; content: string }[]): Array<{ origin: string }> =>
      JSON.parse(files.find((f) => f.path === "requirements.json")!.content).requirements;
    expect(manifestOf(web.package.files).some((r) => r.origin === "user_stated")).toBe(true);
    expect(manifestOf(cli.files).some((r) => r.origin === "user_stated")).toBe(false);

    // Same compilation…
    const artifacts = (files: readonly { path: string; content: string }[]): string[] =>
      files.filter((f) => f.path.startsWith("artifacts/")).map((f) => f.content);
    expect(artifacts(web.package.files)).toEqual(artifacts(cli.files));
    // …different contract, so a different identity.
    expect(web.package.semanticId).not.toBe(cli.semanticId);
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
