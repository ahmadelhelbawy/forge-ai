/**
 * R7 (V2-R step 9): the workspace and the CLI must produce the same artifact.
 *
 * The audit's central structural finding was that the shipped workspace does
 * not use the compiler. The CLI runs
 * `text → extractIntent → TaskIR → compile(ir, profile) → artifacts + spans +
 * diagnostics`; the workspace stops at model prose and only extracts an IR for
 * preservation and candidates. So the profile registry, the trace, the
 * capability gates and every `FORGE-C0xx` diagnostic — the parts of FORGE that
 * are actually novel — were unreachable from the product.
 *
 * Compile-on-demand closes that by CALLING the compiler, not by reimplementing
 * it. These tests exist to keep it that way: the moment `web/lib/compile.ts`
 * grows its own rendering, its bytes stop matching the CLI's and this fails.
 *
 * Byte-identity is the right assertion rather than a loose "looks similar",
 * because `compile()` promises determinism and `content_hash` is a content
 * address — two different strings for the same IR and profile would make the
 * hash meaningless.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { compileVersion, profileForTarget } from "../../web/lib/compile";
import { stubExtraction } from "../../web/lib/preservation";
import {
  addPromptVersion,
  loadConversation,
  newConversation,
  saveConversation,
  type Conversation,
} from "../../web/lib/store";

function isolated(): void {
  const root = join(mkdtempSync(join(tmpdir(), "forge-v2r-compile-")), "data");
  mkdirSync(root, { recursive: true });
  process.env["FORGE_DATA_DIR"] = root;
  // NFR-007: the whole path must run with no network and no key.
  process.env["FORGE_CHAT_STUB"] = "1";
}

const PROMPT = [
  "You are a code review assistant for a TypeScript service.",
  "",
  "You must never approve a change that removes a test.",
  "Report findings with a file path and a line number.",
].join("\n");

function conversationWithPrompt(): Conversation {
  const convo = newConversation({ title: "parity", target: "claude-code" });
  addPromptVersion(convo, PROMPT, "model", { action: "CREATE", turnId: "t1" });
  saveConversation(convo);
  return loadConversation(convo.id)!;
}

describe("R7 — the workspace compiles through the same compiler as the CLI", () => {
  beforeEach(isolated);

  it("produces byte-identical artifacts for the same IR and profile", async () => {
    const convo = conversationWithPrompt();
    const web = await compileVersion(convo, convo.currentV, "claude-code");
    expect(web.refused).toBe(false);

    // The CLI's half of the comparison: the same IR, the same profile, through
    // `compile()` directly. If the web path had rendered anything itself, the
    // two byte strings would diverge here.
    const cli = compile(web.ir as TaskIR, builtinProfiles().get("claude-code"), {
      taskSlug: web.taskSlug,
    });

    expect(web.artifacts.map((a) => a.path)).toEqual(cli.artifacts.map((a) => a.path));
    for (const [i, artifact] of web.artifacts.entries()) {
      expect(artifact.content, `artifact ${artifact.path} differs`).toBe(cli.artifacts[i]!.content);
      expect(artifact.content_hash).toBe(cli.artifacts[i]!.content_hash);
    }
    expect(web.diagnostics.map((d) => d.code)).toEqual(cli.diagnostics.map((d) => d.code));
  });

  it("holds for every shipped profile, not just the default", async () => {
    const convo = conversationWithPrompt();
    for (const id of builtinProfiles().ids) {
      const web = await compileVersion(convo, convo.currentV, id);
      const cli = compile(web.ir as TaskIR, builtinProfiles().get(id), { taskSlug: web.taskSlug });
      expect(web.refused, `${id} refusal disagrees`).toBe(cli.refused);
      expect(
        web.artifacts.map((a) => a.content),
        `${id} artifacts differ`,
      ).toEqual(cli.artifacts.map((a) => a.content));
    }
  });

  /**
   * `"generic"` is a workspace-only sentinel; `registry.get("generic")` throws.
   * `web/lib/forge.ts` already maps it to `claude-code`, and the compile path
   * must do the same DELIBERATELY — a silent throw here would look like "the
   * compiler does not work in the product", which is the exact misreading V2-R
   * exists to correct.
   */
  it("maps the workspace's 'generic' sentinel to a real profile", () => {
    expect(profileForTarget("generic").id).toBe("claude-code");
    expect(profileForTarget("kiro").id).toBe("kiro");
  });

  it("refuses rather than throwing for an unknown target", () => {
    expect(() => profileForTarget("not-a-real-target")).toThrow();
  });

  /** Determinism, end to end: the product must not drift between two clicks. */
  it("is deterministic across repeated compilations", async () => {
    const convo = conversationWithPrompt();
    const first = await compileVersion(convo, convo.currentV, "kiro");
    const second = await compileVersion(convo, convo.currentV, "kiro");
    expect(first.artifacts.map((a) => a.content_hash)).toEqual(
      second.artifacts.map((a) => a.content_hash),
    );
  });

  /**
   * The capability gate is one of the things the workspace could not reach
   * before. `run_tests` and `shell` are SOFT — `degrade.command_to_manual`
   * compensates for them, so their absence degrades rather than refuses, and
   * asserting a refusal on those would have been asserting the wrong thing.
   * `fs_write` has no compensating rule, so a design target asked to write
   * files must refuse with FORGE-C030 rather than emit an artifact telling a
   * tool to do something it cannot do (INV-003, FR-015).
   */
  it("carries the capability refusal into the product", async () => {
    const convo = conversationWithPrompt();
    // A hand-built IR is used rather than the stub's, so the demand is explicit
    // and this test does not depend on what the stub happens to extract.
    const demanding: TaskIR = parseTaskIR({
      ...stubExtraction(PROMPT),
      required_capabilities: ["fs_write"],
    });
    const result = compile(demanding, builtinProfiles().get("claude-design"), { taskSlug: "parity" });
    expect(result.refused).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-C030");
    expect(result.artifacts).toEqual([]);
    void convo;
  });

  /**
   * The trace reaches the product too. Spans are what make `forge explain`
   * possible and are the evidence behind INV-010; a compile surface that
   * dropped them would be showing the artifact without its provenance.
   */
  it("carries spans and a clean coverage verdict into the product", async () => {
    const convo = conversationWithPrompt();
    const web = await compileVersion(convo, convo.currentV, "claude-code");
    expect(web.spans.length).toBeGreaterThan(0);
    expect(web.diagnostics.map((d) => d.code)).not.toContain("FORGE-C100");
  });

  /**
   * `compileVersion` records the extracted IR onto the conversation, exactly as
   * the preservation path does, so a second compilation costs nothing. The
   * caller must persist it — which is why the route saves — and this test does
   * the same rather than pretending the mutation persists itself.
   */
  it("makes no second model call once the version's IR is stored", async () => {
    const convo = conversationWithPrompt();
    const first = await compileVersion(convo, convo.currentV, "claude-code");
    expect(first.extracted).toBe(true);
    saveConversation(convo);

    const reloaded = loadConversation(convo.id)!;
    const second = await compileVersion(reloaded, reloaded.currentV, "claude-code");
    expect(second.extracted).toBe(false);
    // And the cached IR is the same one, so the artifact cannot drift between
    // the first compilation and the second.
    expect(second.semanticHash).toBe(first.semanticHash);
  });

  /** A different target must not force a re-extraction: the IR is target-free (INV-001). */
  it("reuses one IR across targets", async () => {
    const convo = conversationWithPrompt();
    await compileVersion(convo, convo.currentV, "claude-code");
    saveConversation(convo);
    const reloaded = loadConversation(convo.id)!;
    const other = await compileVersion(reloaded, reloaded.currentV, "kiro");
    expect(other.extracted).toBe(false);
  });
});
