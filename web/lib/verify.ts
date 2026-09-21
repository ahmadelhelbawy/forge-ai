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
import { verifyPackage, type VerdictReport } from "forge/dist/verify/verdict.js";

import { packageVersion } from "./package";
import type { Conversation } from "./store";

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
