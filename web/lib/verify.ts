/**
 * Verifying a prompt version's Execution Package against pasted evidence (V2-G).
 *
 * The same relationship `web/lib/package.ts` has to `assemblePackage`: this
 * **calls** `verifyPackage` and decides nothing itself, so the workspace and
 * `forge verify` cannot disagree about a verdict.
 *
 * The package is rebuilt for the version exactly as the Package button builds
 * it, and then validated like any received package (`EV-R3`) — the workspace
 * gets no shortcut past validation merely because it built the bytes.
 *
 * Evidence here is text the user pasted. Log files are a CLI feature (they live
 * beside the evidence file); a pasted record that names one is rejected as
 * "log not supplied" rather than trusted without it (`EV-R5`). Nothing here
 * executes anything (`INV-004`), and no model is consulted (`EV-R1`).
 */
import { scanSecrets } from "forge/dist/context/secrets.js";
import { verifyPackage, type VerdictReport } from "forge/dist/verify/verdict.js";

import { packageVersion } from "./package";
import type { Conversation } from "./store";
import type { VerificationRecord } from "./store-types";

export interface VersionVerification {
  readonly v: number;
  readonly profileId: string;
  readonly report: VerdictReport;
}

export async function verifyVersion(
  convo: Conversation,
  v: number,
  target: string,
  evidence: string,
): Promise<VersionVerification> {
  const built = await packageVersion(convo, v, target);
  const files = new Map([...built.package.files, built.package.run].map((f) => [f.path, f.content]));
  const report = verifyPackage({ files, evidence, logHashes: new Map() });
  return { v: built.v, profileId: built.profileId, report };
}

/**
 * Keep a verification on the conversation, so it survives a reload.
 *
 * The report's own JSON is the source of every number here: FORGE records what
 * `verifyPackage` said, not a second reading of the evidence. The evidence text
 * is kept only when the secret scanner finds nothing in it — a pasted log is
 * untrusted and can carry a credential, and the verdict names the evidence by
 * hash, so a redacted copy would be a different file. Nothing is executed and
 * no model is consulted (INV-004, EV-R1).
 */
export function recordVerification(
  convo: Conversation,
  input: { v: number; target: string; profileId: string; report: VerdictReport; evidence: string },
): VerificationRecord {
  const parsed = JSON.parse(input.report.json) as { evidence_hash: string | null; counts: Record<string, number> };
  const clean = !scanSecrets(input.evidence).secretPresent;
  const record: VerificationRecord = Object.freeze({
    v: input.v,
    target: input.target,
    profileId: input.profileId,
    semanticId: input.report.package_semantic_id,
    packageValid: input.report.package_valid,
    evidenceHash: parsed.evidence_hash ?? "",
    evidence: clean ? input.evidence : null,
    evidenceKept: clean,
    counts: parsed.counts,
    at: new Date().toISOString(),
  });
  convo.verifications.push(record);
  return record;
}

/**
 * The EV-R5 caveat, re-exported so the traceability matrix can repeat it
 * whenever it shows a verdict (TM-R3) without a second importer of the
 * verification layer (AC-050).
 */
export { REPORT_CAVEAT } from "forge/dist/verify/verdict.js";
