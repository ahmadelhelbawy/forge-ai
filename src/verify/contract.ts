/**
 * Validating an Execution Contract before any evidence is read (`FR-054`,
 * `EV-R3`, `AC-048`).
 *
 * The `semantic_id` written in a received `package.json` is a **claim**, and
 * evidence binds to it (`EV-R2`), so it carries no authority until checked.
 * Checking the listed file hashes is not enough: `package.json` is anchored by
 * nothing, so an edit to `verification.json` plus an updated listed hash yields
 * a package that is self-consistent under `sha256sum` and still carries the old
 * id — `semantic_id` hashes the compiler's inputs and the artifacts, not the
 * derived files an executor reads obligations from.
 *
 * So validation **rebuilds** the package from its own inputs — the Task IR, the
 * strategy overlay, the pinned requirements, and the profile the manifest names
 * — with this FORGE's compiler, and requires every semantic file to come out
 * byte-identical. That is `INV-005` used as an integrity check: a fixed input
 * tuple has exactly one set of semantic bytes, so any other set is not this
 * package. Recompiling runs no command; it is the same pure function
 * `forge package` ran (`INV-004`).
 *
 * Pure over an in-memory file map, so the CLI (which reads a directory) and the
 * workspace (which built the package in memory) share one validator.
 */
import { rawHash } from "../ir/canonical.js";
import { safeParseTaskIR } from "../ir/schema.js";
import { compile } from "../compile/compile.js";
import { assemblePackage } from "../package/assemble.js";
import { FORGE_COMPILER_VERSION } from "../compile/version.js";
import { PACKAGE_SCHEMAS } from "../package/schema.js";
import { builtinProfiles, type ProfileRegistry } from "../profile/registry.js";
import type { DerivedOverlay } from "../strategy/schema.js";
import type { LedgerEntry } from "../critic/deterministic/ledger.js";
import { obligationsOf, type Obligation } from "./obligations.js";

export interface ValidatedContract {
  /** Recomputed, not read: equal to the manifest's only because the rebuild agreed. */
  readonly semanticId: string;
  readonly profile: { readonly id: string; readonly version: string };
  readonly obligations: readonly Obligation[];
}

export type ContractValidation =
  | { readonly ok: true; readonly contract: ValidatedContract }
  | { readonly ok: false; readonly claimedSemanticId: string | null; readonly problems: readonly string[] };

/** Package-relative paths only: no absolute path, drive letter or `..` segment. */
export function isSafePackagePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:/.test(path)) return false;
  return !path.split(/[\\/]/).some((segment) => segment === "..");
}

/** The files the rebuild reads or the verifier consumes; each must be listed. */
const REQUIRED_FILES = ["task-ir.json", "strategy.json", "requirements.json", "verification.json"] as const;

const fail = (claimedSemanticId: string | null, problems: readonly string[]): ContractValidation =>
  Object.freeze({ ok: false as const, claimedSemanticId, problems: Object.freeze([...problems]) });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function validatePackage(
  files: ReadonlyMap<string, string>,
  registry: ProfileRegistry = builtinProfiles(),
): ContractValidation {
  // 1. The manifest itself.
  const manifestText = files.get("package.json");
  if (manifestText === undefined) return fail(null, ["package.json is missing"]);
  const manifestParsed = PACKAGE_SCHEMAS["package.json"].safeParse(parseJson(manifestText));
  if (!manifestParsed.success) return fail(null, ["package.json does not match its published schema"]);
  const manifest = manifestParsed.data;
  const claimed = manifest.semantic_id;

  // 2. Every listed file: a safe path, present, the listed bytes, and — where a
  //    schema is published for it — the published shape.
  const problems: string[] = [];
  for (const listed of manifest.files) {
    if (!isSafePackagePath(listed.path)) {
      problems.push(`${JSON.stringify(listed.path)} escapes the package directory`);
      continue;
    }
    const content = files.get(listed.path);
    if (content === undefined) {
      problems.push(`${listed.path} is listed in package.json but missing`);
      continue;
    }
    if (rawHash(content) !== listed.content_hash) {
      problems.push(`${listed.path} does not match the hash package.json lists for it`);
      continue;
    }
    const schema = (PACKAGE_SCHEMAS as Record<string, (typeof PACKAGE_SCHEMAS)[keyof typeof PACKAGE_SCHEMAS]>)[
      listed.path
    ];
    if (schema && !schema.safeParse(parseJson(content)).success) {
      problems.push(`${listed.path} does not match its published schema`);
    }
  }
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const required of REQUIRED_FILES) {
    if (!listed.has(required)) problems.push(`${required} is required (PK-R1) but package.json does not list it`);
  }
  if (problems.length > 0) return fail(claimed, problems);

  // 3. The inputs the rebuild needs, read out of the package itself.
  const parsedIr = safeParseTaskIR(parseJson(files.get("task-ir.json") ?? ""));
  if (!parsedIr.ok) return fail(claimed, ["task-ir.json is not a valid Task IR"]);
  const ir = parsedIr.ir;
  if (!registry.has(manifest.profile.id)) {
    return fail(claimed, [
      `the package was built for profile "${manifest.profile.id}", which this FORGE does not have; ` +
        `it cannot be rebuilt here, so it cannot be validated`,
    ]);
  }
  if (manifest.compiler_version !== FORGE_COMPILER_VERSION) {
    return fail(claimed, [
      `the package was built by compiler ${manifest.compiler_version}; this FORGE is ` +
        `${FORGE_COMPILER_VERSION}, so the package cannot be rebuilt to check it`,
    ]);
  }
  const profile = registry.get(manifest.profile.id);
  if (profile.version !== manifest.profile.version) {
    return fail(claimed, [
      `the package was built for ${manifest.profile.id}@${manifest.profile.version}; this FORGE has ` +
        `@${profile.version}, so the package cannot be rebuilt to check it`,
    ]);
  }
  const overlay = parseJson(files.get("strategy.json") ?? "null") as DerivedOverlay | null | undefined;
  const requirements = PACKAGE_SCHEMAS["requirements.json"].parse(parseJson(files.get("requirements.json")!));
  // Identity is the text (RQ-R2); storage keys are irrelevant to the rebuild.
  const ledger: LedgerEntry[] = requirements.requirements
    .filter((r) => r.kind === "pinned")
    .map((r) => ({ id: r.id, text: r.text, contentHash: "", origin: "user_input" as const }));

  // 4. Rebuild and compare every semantic byte.
  let rebuilt;
  try {
    const result = compile(ir, profile, { taskSlug: ir.objective.kind, overlay: overlay ?? null });
    rebuilt = assemblePackage({ ir, profile, result, overlay: overlay ?? null, ledger, generatedAt: "" });
  } catch (error) {
    return fail(claimed, [
      `the package could not be rebuilt from its own inputs: ${error instanceof Error ? error.name : "error"}`,
    ]);
  }
  for (const f of rebuilt.files) {
    if (files.get(f.path) !== f.content) {
      problems.push(`${f.path} differs from the rebuild of this package from its own inputs`);
    }
  }
  if (rebuilt.semanticId !== claimed) {
    problems.push(`the semantic_id in package.json is not the one its contents rebuild to`);
  }
  if (problems.length > 0) return fail(claimed, problems);

  const verification = PACKAGE_SCHEMAS["verification.json"].parse(parseJson(files.get("verification.json")!));
  return Object.freeze({
    ok: true as const,
    contract: Object.freeze({
      semanticId: rebuilt.semanticId,
      profile: Object.freeze({ id: profile.id, version: profile.version }),
      obligations: obligationsOf(verification.entries),
    }),
  });
}
