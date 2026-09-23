/**
 * Compile-on-demand: the workspace, through the real compiler (V2-R step 9).
 *
 * THE DIVERGENCE THIS CLOSES. The CLI runs
 *
 *     text → extractIntent → TaskIR → compile(ir, profile)
 *              → artifacts + spans + diagnostics
 *
 * while the workspace stopped at model prose and extracted an IR only for
 * preservation and candidates. Everything that makes FORGE more than a chat
 * wrapper — the profile registry, the byte-level trace, the capability gates,
 * every `FORGE-C0xx` — was therefore unreachable from the product. The audit
 * called this the central structural finding, and it was right.
 *
 * WHAT THIS FILE IS AND IS NOT. It CALLS `compile()`; it duplicates none of it.
 * There is no rendering here, no section logic, no diagnostic construction — if
 * any of that appears in this file, `tests/product/compile-parity.test.ts`
 * fails, because the bytes stop matching the CLI's. `forge` may never depend on
 * `web`, and the traffic in the other direction is a function call, not a copy.
 *
 * Nothing about the prompt's authority changes. The `PromptVersion` prose is
 * still the truth; compiling is a READ of it, produces no version, and writes
 * nothing to the conversation except the extracted IR that `irForVersion`
 * already caches for preservation.
 */
import { compile, type CompileOptions } from "forge/dist/compile/compile.js";
import type { CompileResult } from "forge/dist/compile/types.js";
import type { Diagnostic } from "forge/dist/ir/diagnostic.js";
import type { TaskIR } from "forge/dist/ir/schema.js";
import { semanticHash } from "forge/dist/ir/projection.js";
import { builtinProfiles } from "forge/dist/profile/registry.js";
import type { AgentProfile } from "forge/dist/profile/schema.js";
import type { Span } from "forge/dist/trace/span.js";

import { irForVersion } from "./preservation";
import type { Conversation } from "./store";

/**
 * The workspace's target list carries `"generic"`, which is not a profile —
 * `registry.get("generic")` throws `ProfileNotFoundError`. `web/lib/forge.ts`
 * already maps it to `claude-code` for briefs and strategies; the compile path
 * does the same, in one named place, DELIBERATELY. Letting the throw escape
 * would surface as "the compiler does not work in the product", which is the
 * precise misreading V2-R exists to correct.
 *
 * Any other unknown target still throws: an unrecognised profile is the user's
 * request being wrong, and guessing a substitute for it would be a silent
 * fallback (the core forbids those, and for good reason — a prompt compiled for
 * the wrong agent looks exactly like one compiled for the right agent).
 */
export const GENERIC_FALLBACK_TARGET = "claude-code";

export function profileForTarget(target: string): AgentProfile {
  return builtinProfiles().get(target === "generic" ? GENERIC_FALLBACK_TARGET : target);
}

export interface VersionCompilation {
  readonly v: number;
  readonly target: string;
  /** The profile actually compiled against — differs from `target` only for `generic`. */
  readonly profileId: string;
  readonly ir: TaskIR;
  readonly semanticHash: string;
  /** True when this call had to extract the IR; false when it was already stored. */
  readonly extracted: boolean;
  readonly artifacts: CompileResult["artifacts"];
  readonly spans: readonly Span[];
  readonly diagnostics: readonly Diagnostic[];
  readonly refused: boolean;
  readonly tokenizer: CompileResult["tokenizer"];
  readonly taskSlug: string;
}

/**
 * A stable slug for the artifact paths a topology templates.
 *
 * Derived from the objective's kind rather than from the conversation id or the
 * clock: two compilations of the same version must produce the same paths, and
 * the CLI derives it the same way (`src/cli/task.ts` passes
 * `ir.objective.kind`). A slug that varied would make byte-identity impossible
 * for every topology that templates a filename.
 */
export function taskSlugFor(ir: TaskIR): string {
  return ir.objective.kind;
}

/**
 * Compile one prompt version for one target.
 *
 * Async only because the IR may still need extracting; when the version already
 * has a stored IR this makes no model call at all, which `extracted` reports
 * honestly so a caller can say what a compilation cost.
 */
export async function compileVersion(
  convo: Conversation,
  v: number,
  target: string,
  options: { provider?: string; model?: string } & Pick<CompileOptions, "overlay"> = {},
): Promise<VersionCompilation> {
  const [only] = await compileVersionForTargets(convo, v, [target], options);
  return only!;
}

/** WS-R41: how many targets one request may name — the seven built-in profiles. */
export const MAX_COMPILE_TARGETS = 7;

/**
 * Compile one version for several targets (WS-R41).
 *
 * The IR is obtained ONCE and `compile()` runs once per profile, so each
 * result is exactly what a single-target compile of that profile produces and
 * no target's output is derived from another's text. A refusal is per target:
 * it is in that target's result and withholds nothing else.
 */
export async function compileVersionForTargets(
  convo: Conversation,
  v: number,
  targets: readonly string[],
  options: { provider?: string; model?: string } & Pick<CompileOptions, "overlay"> = {},
): Promise<VersionCompilation[]> {
  // Resolve every profile first: an unknown target is the request being wrong,
  // and it should fail before a model call is spent on the IR.
  const profiles = targets.map((target) => ({ target, profile: profileForTarget(target) }));
  const { ir, extracted } = await irForVersion(convo, v, {
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
  });
  const taskSlug = taskSlugFor(ir);
  const hash = semanticHash(ir);
  return profiles.map(({ target, profile }, i) => {
    const result = compile(ir, profile, {
      taskSlug,
      ...(options.overlay !== undefined ? { overlay: options.overlay } : {}),
    });
    return {
      v,
      target,
      profileId: profile.id,
      ir,
      semanticHash: hash,
      // Only the first result paid for an extraction, if any was paid at all.
      extracted: extracted && i === 0,
      artifacts: result.artifacts,
      spans: result.spans,
      diagnostics: result.diagnostics,
      refused: result.refused,
      tokenizer: result.tokenizer,
      taskSlug,
    };
  });
}
