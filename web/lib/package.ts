/**
 * Packaging a prompt version from the workspace (V2-F).
 *
 * The same relationship `web/lib/compile.ts` has to `compile()`: this **calls**
 * `assemblePackage` and duplicates none of it. A second assembler in `web/`
 * would drift from the CLI's within a phase, and `AC-046` — the two packages
 * must be byte-identical except `run.json` — is the test that keeps it honest.
 *
 * The one input the workspace has that the CLI does not is the conversation's
 * **pinned ledger**, which becomes the `user_stated` half of the requirement
 * manifest (§22.9). It changes no byte of any artifact, but it is part of the
 * contract and so of `semantic_id` (`PK-R3`): a pinned package built here and an
 * unpinned one built by the CLI from the same IR share every artifact hash and
 * differ in identity. Given the same ledger, the two are byte-identical.
 */
import { assemblePackage, type ExecutionPackage } from "forge/dist/package/assemble.js";
import { verifyRelocatable } from "forge/dist/package/export.js";
import { compile } from "forge/dist/compile/compile.js";
import type { LedgerEntry } from "forge/dist/critic/deterministic/ledger.js";

import { profileForTarget, taskSlugFor } from "./compile";
import { irForVersion } from "./preservation";
import { ledgerEntries, type Conversation } from "./store";

export class PackageLeakError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `Refusing to build a package that would leak a host path: ${problems.join("; ")}. ` +
        `An absolute path discloses a username and a directory layout to whoever ` +
        `receives the package (PK-R7).`,
    );
    this.name = "PackageLeakError";
  }
}

export interface VersionPackage {
  readonly v: number;
  readonly target: string;
  readonly profileId: string;
  readonly package: ExecutionPackage;
  readonly refused: boolean;
  /** True when this call had to extract the version's IR; false when it was cached. */
  readonly extracted: boolean;
}

export async function packageVersion(
  convo: Conversation,
  v: number,
  target: string,
  options: { provider?: string; model?: string; generatedAt?: string } = {},
): Promise<VersionPackage> {
  const profile = profileForTarget(target);
  const { ir, extracted } = await irForVersion(convo, v, {
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
  });
  const result = compile(ir, profile, { taskSlug: taskSlugFor(ir) });

  const pkg = assemblePackage({
    ir,
    profile,
    result,
    ledger: ledgerEntries(convo) as readonly LedgerEntry[],
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });

  // Checked before the package leaves the server, for the same reason the CLI
  // checks before writing: a leak is cheaper to refuse than to recall.
  const leaks = verifyRelocatable(pkg);
  if (leaks.length > 0) throw new PackageLeakError(leaks);

  return { v, target, profileId: profile.id, package: pkg, refused: result.refused, extracted };
}
