/**
 * Layer 2's wiring (WS-R26, WS-R29) — server-only.
 *
 * Three jobs, and the boring one matters most: **extract each version's Task IR
 * exactly once** and store it content-addressed, so the advisory layer is a
 * function of stored structures rather than of however the model felt on the
 * day it was asked.
 *
 * Nothing in this file is reachable from a turn. Layer 2 is opt-in and runs on
 * its own request, which is what keeps it off the critical path (WS-R13,
 * WS-R29) and what makes AC-040 true by construction rather than by care.
 */
import { proposeRequirementCandidates } from "forge/dist/critic/deterministic/ledger.js";
import { compareVersionIrs, citationSources, type DriftReport } from "forge/dist/critic/judged/drift.js";
import { preservationResult, type PreservationResult } from "forge/dist/critic/preservation.js";
import { extractIntent, INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION } from "forge/dist/intent/extract.js";
import { attributeDraft, userInputSegment } from "forge/dist/ir/attribution.js";
import { parseTaskIR, type TaskIR } from "forge/dist/ir/schema.js";

import { callHeaders, getEffectiveProvider } from "./forge";
import {
  checkLedger,
  ledgerEntries,
  recordModelCall,
  recordVersionIr,
  store,
  versionIrHash,
  type Conversation,
} from "./store";

/**
 * A stand-in extraction for the offline suite.
 *
 * Structural, deterministic and clearly not a model: the first non-empty line
 * becomes the objective and a goal, obligation-bearing lines become hard
 * constraints. It exists so the drift path — storage, comparison, rendering,
 * and the separation between the layers — is exercised end to end with no
 * network, exactly as `stubDeps` does for a turn.
 */
export function stubExtraction(text: string): TaskIR {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const headline = (lines[0] ?? "an unnamed task").slice(0, 200);
  const obligations = proposeRequirementCandidates(text, 8);
  return attributeDraft(
    {
      objective: {
        statement: headline,
        kind: "feature",
        success_definition: `The prompt still says: ${headline}`,
        derived_from: "s1",
      },
      goals: [
        { id: "g1", statement: headline, priority: "must", acceptance: ["The prompt states it"], derived_from: "s1" },
      ],
      constraints: obligations.map((statement, i) => ({
        id: `c${i + 1}`,
        kind: "scope" as const,
        hardness: "hard" as const,
        statement: statement.slice(0, 200),
        derived_from: "s1",
      })),
      non_goals: [],
      scope: { include: ["**/*"], exclude: [], blast_radius: "module", derived_from: "s1" },
      required_capabilities: [],
      assumptions: [],
      open_questions: [],
      // One obligation satisfying g1, so a stub-mode package has something to
      // verify: without it every stub package had zero obligations and the
      // V2-G/V2-H HTTP verdict tests could only pass vacuously.
      verification: [
        {
          id: "v1",
          kind: "command",
          spec: "grep -q . PROMPT.md",
          expected: "exit 0",
          satisfies: ["g1"],
          derived_from: "s1",
        },
      ],
      deliverables: [{ id: "d1", kind: "doc", description: "the prompt", derived_from: "s1" }],
      risk: { level: "low", factors: [] },
    } as never,
    [userInputSegment("s1")],
  );
}

/** Read a stored IR back out of the object store, or null when absent. */
export function storedIr(convo: Conversation, v: number): TaskIR | null {
  const hash = versionIrHash(convo, v);
  if (!hash) return null;
  const value = store().objects.get(hash);
  return value === null ? null : parseTaskIR(value);
}

/**
 * The IR for one version, extracted once (WS-R26).
 *
 * A version that already has one costs nothing and makes no model call; the
 * `extracted` flag says which happened, so a caller can report honestly how
 * many calls an advisory check cost.
 */
export async function irForVersion(
  convo: Conversation,
  v: number,
  options: { provider?: string; model?: string } = {},
): Promise<{ ir: TaskIR; extracted: boolean }> {
  const cached = storedIr(convo, v);
  if (cached) return { ir: cached, extracted: false };

  const version = convo.promptVersions.find((p) => p.v === v);
  if (!version) throw new Error(`Version ${v} does not exist in this conversation.`);

  if (process.env["FORGE_CHAT_STUB"]) {
    const ir = stubExtraction(version.text);
    recordVersionIr(convo, {
      v,
      irHash: store().objects.put(ir),
      boundaryId: "stub.extract",
      boundaryVersion: "1",
    });
    return { ir, extracted: true };
  }

  const resolved = getEffectiveProvider(options.provider ?? convo.provider, options.model ?? convo.model ?? undefined);
  const headers = callHeaders(resolved);
  const { ir, record } = await extractIntent(version.text, {
    provider: resolved.provider,
    model: resolved.model,
    ...(Object.keys(headers).length > 0 ? { sessionHeaders: headers } : {}),
  });
  // WS-R14: an advisory call is still a call, and an unrecorded call is a gap
  // in the audit trail whether or not anyone acted on its result.
  recordModelCall(convo, record);
  recordVersionIr(convo, {
    v,
    irHash: store().objects.put(ir),
    boundaryId: INTENT_EXTRACT_ID,
    boundaryVersion: INTENT_EXTRACT_VERSION,
  });
  return { ir, extracted: true };
}

export interface PreservationView {
  readonly result: PreservationResult;
  readonly drift: DriftReport | null;
  /** The renderings a drift citation resolves against (DG-R4). */
  readonly citations: Record<string, string>;
  readonly extractedCalls: number;
}

/**
 * Both layers, computed and kept apart.
 *
 * Layer 1 runs first and unconditionally. Layer 2 runs only when asked, and if
 * it throws, Layer 1's verdict is returned unchanged — which is WS-R27.3 as
 * control flow rather than as a promise.
 */
export async function preservationFor(
  convo: Conversation,
  pair: { from: number; to: number } | null,
  options: { provider?: string; model?: string } = {},
): Promise<PreservationView> {
  const ledger = checkLedger(convo, pair ? pair.to : convo.currentV);
  if (!pair) {
    return { result: preservationResult(ledger, null), drift: null, citations: {}, extractedCalls: 0 };
  }

  /**
   * The two extractions are independent, so they are dispatched together
   * (V2-R step 11).
   *
   * Serialised, this was measured at 205s on a live run, and on a slow
   * reasoning model a client aborted it with `UND_ERR_HEADERS_TIMEOUT` after
   * five minutes — the advisory layer failing not because it was wrong but
   * because it took too long to answer. V2-E hit the same wall in candidate
   * generation and fixed it the same way.
   *
   * Concurrency is safe here because the two calls touch different versions:
   * `recordVersionIr` appends one record per `v`, and the same `v` twice would
   * write the record twice, so that case is taken sequentially rather than
   * assumed away. Both paths still record every call (WS-R14).
   */
  let from: Awaited<ReturnType<typeof irForVersion>>;
  let to: Awaited<ReturnType<typeof irForVersion>>;
  if (pair.from === pair.to) {
    from = await irForVersion(convo, pair.from, options);
    to = from;
  } else {
    [from, to] = await Promise.all([
      irForVersion(convo, pair.from, options),
      irForVersion(convo, pair.to, options),
    ]);
  }
  const drift = compareVersionIrs(
    { v: pair.from, ir: from.ir },
    { v: pair.to, ir: to.ir },
    { pinned: ledgerEntries(convo).map((e) => e.text) },
  );
  return {
    result: preservationResult(ledger, drift),
    drift,
    citations: citationSources({ v: pair.from, ir: from.ir }, { v: pair.to, ir: to.ir }),
    extractedCalls: (from.extracted ? 1 : 0) + (to.extracted ? 1 : 0),
  };
}
