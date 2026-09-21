/**
 * Execution Package assembly (`FR-040`–`FR-042`, `PK-R1`–`PK-R6`).
 *
 * The package is the object FORGE has always claimed to produce and never did:
 * a portable, reviewable, attributable record of one compilation that a
 * developer or a CI job can consume **with JSON parsing and the published
 * schema alone** (`PK-R8`). No FORGE runtime is needed to read one, which is
 * what keeps the open-source claim honest — a package must not be a blob only
 * its author can open.
 *
 * **This module computes nothing new.** Every value here already exists on a
 * `CompileResult`, a `TaskIR`, an `AgentProfile` or a `DerivedOverlay`;
 * assembly is projection and naming. If a number appears here that no other
 * part of FORGE produced, that is a defect, because it would be a claim no
 * other test covers.
 *
 * **The semantic/volatile split is physical, not a convention.** `run.json` is
 * a separate file, written last, excluded from `semantic_id`. A determinism bug
 * therefore surfaces as a `diff` between two exported directories rather than
 * as a subtly unstable hash nobody notices (`INV-013`, `AC-005`).
 *
 * **`runtime-contract.json` declares; it never grants** (`PK-R4`, `INV-004`).
 * It states what the task would need — capabilities, the target's tools, a
 * network policy, a filesystem scope. FORGE enforces none of it and executes
 * none of it. That keeps `INV-004` structural rather than a matter of restraint:
 * there is no code here that could run anything even if it wanted to.
 */
import { contentHash, rawHash } from "../ir/canonical.js";
import { semanticHash } from "../ir/projection.js";
import type { TaskIR } from "../ir/schema.js";
import type { AgentProfile } from "../profile/schema.js";
import type { DerivedOverlay } from "../strategy/schema.js";
import type { CompileResult } from "../compile/types.js";
import { FORGE_COMPILER_VERSION } from "../compile/version.js";
import { IR_VERSION } from "../ir/version.js";
import { requirementManifest, type Requirement } from "../requirement/identity.js";
import type { LedgerEntry } from "../critic/deterministic/ledger.js";

/** The published format version of the package layout itself. */
export const PACKAGE_FORMAT_VERSION = "1.0";

export interface AssembleInput {
  readonly ir: TaskIR;
  readonly profile: AgentProfile;
  readonly result: CompileResult;
  readonly overlay?: DerivedOverlay | null;
  /** Pinned requirements, when a conversation supplied them. Empty for the CLI. */
  readonly ledger?: readonly LedgerEntry[];
  /**
   * When the package was built. Injected rather than read from the clock here
   * so that assembly stays a pure function — the caller owns the one impure
   * value, and it lands only in `run.json`.
   */
  readonly generatedAt: string;
}

/** One file of the package, already canonicalized. `path` is package-relative. */
export interface PackageFile {
  readonly path: string;
  readonly content: string;
  readonly contentHash: string;
}

export interface ExecutionPackage {
  readonly semanticId: string;
  /** Every semantic file, including `package.json`, in stable order. */
  readonly files: readonly PackageFile[];
  /** Written last and hashed by nothing (`PK-R3`, `INV-013`). */
  readonly run: PackageFile;
}

/**
 * Pretty JSON with a trailing newline, hashed **over the bytes that are written**.
 *
 * `rawHash` rather than `contentHash` is the whole of `PK-R8` in one line. A
 * canonical-JSON hash is reproducible only by something that implements FORGE's
 * canonicalization (`IR-R12`), so a stranger holding the package could not check
 * it — the manifest's hashes would be useful to FORGE alone, which is exactly the
 * proprietary-blob failure the requirement forbids. Hashing the file bytes makes
 * every entry verifiable with `sha256sum`.
 *
 * Two-space JSON with a trailing newline is also what makes `diff -r` between two
 * exported packages readable, which is how `AC-005` is actually checked by a human.
 */
function file(path: string, value: unknown): PackageFile {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  return { path, content, contentHash: rawHash(content) };
}

/**
 * The §6.4 semantic input tuple, the requirement manifest, and every
 * artifact's content hash (`PK-R3`).
 *
 * `semantic_id` names the **Execution Contract**, not only the compilation. The
 * manifest changes no artifact byte, but it is part of what the package claims,
 * and V2-G binds evidence to this id (`EV-R2`): two contracts with different
 * requirements sharing one id would let evidence for one bind to the other, and
 * would make `INV-005` false of `requirements.json`. The compilation alone is
 * still visible — `ir_semantic_hash` and `artifacts` below, and the artifact
 * hashes in `package.json`.
 *
 * Written as an explicit ordered object rather than a concatenated string so a
 * reader can see exactly what identity covers — and, just as importantly, what
 * it does not: no timestamp, no latency, no model identity, no host metadata
 * (`INV-013`).
 */
export function semanticIdInputs(input: AssembleInput): Record<string, unknown> {
  const { ir, profile, result, overlay } = input;
  return {
    ir_semantic_hash: semanticHash(ir),
    // The manifest's value, not the ledger's: storage keys and pin times are
    // not part of a requirement's identity (RQ-R2), so two ledgers holding the
    // same text in the same order name the same contract.
    requirement_manifest: contentHash(requirementManifest(ir, input.ledger ?? [])),
    strategy_semantic_hash: overlay ? contentHash(overlay) : null,
    profile: `${profile.id}@${profile.version}`,
    forge_compiler_version: FORGE_COMPILER_VERSION,
    ir_version: IR_VERSION,
    tokenizer: `${result.tokenizer.id}@${result.tokenizer.version}`,
    // Ordered by ref id so map iteration order cannot change the identity.
    context_refs: Object.fromEntries(
      [...ir.context_refs].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, r.content_hash]),
    ),
    artifacts: result.artifacts.map((a) => ({ path: a.path, content_hash: a.content_hash })),
  };
}

/**
 * What a future executor would have to provide. A **declaration**, never a grant.
 *
 * Tool names appear here and nowhere in the IR: `INV-001` keeps the canonical
 * representation vendor-free, and this file is post-compilation and explicitly
 * target-specific, which is the one place a tool name is honest.
 */
function runtimeContract(input: AssembleInput): Record<string, unknown> {
  const { ir, profile, result } = input;
  return {
    declares_only: true,
    grants: null,
    required_capabilities: [...ir.required_capabilities],
    target: {
      id: profile.id,
      version: profile.version,
      tools: [...profile.retrieval.tools],
      autonomy: profile.autonomy.default,
      permission_model: profile.autonomy.permission_model,
    },
    // No retriever in v0.1 produces network context, and FORGE never fetches
    // during compilation. Declaring "none" is a statement about this package,
    // not a restriction FORGE could impose.
    network_policy: "none",
    filesystem_scope: { include: [...ir.scope.include], exclude: [...ir.scope.exclude] },
    blast_radius: ir.scope.blast_radius,
    /**
     * Null until a repository is bound, which is V2-H. Recording `null` is the
     * honest value: a commit invented from an unbound working tree would be a
     * claim about a repository this package was never checked against.
     */
    repository: { commit: null, dirty: null },
    degradations: result.degradations.map((d) => ({
      rule_id: d.rule_id,
      capability: d.capability,
      reason: d.reason,
      effect: d.effect,
    })),
  };
}

/**
 * Verification specifications as DATA (`PK-R5`, `FR-042`, `INV-004`).
 *
 * The legalized list is used, not the raw IR one, because legalization is what
 * decides whether a `command` step survives as a command on this target or is
 * recorded for a human. A package that published the pre-legalization kind
 * would be telling the executor to run something the target cannot run.
 */
function verificationFile(input: AssembleInput): Record<string, unknown> {
  return {
    executed_by_forge: false,
    entries: input.result.verification.map((v) => ({
      id: v.id,
      kind: v.kind,
      spec: v.spec,
      expected: v.expected,
      satisfies: [...v.satisfies],
      // Recorded when the target could not execute the original kind, so the
      // executor sees that FORGE changed it and why (INV-012).
      degraded_from: v.degraded_from,
      degraded_by: v.degraded_by,
    })),
  };
}

/** Findings, split so the reproducible half is checkable on its own (`PK-R6`). */
function diagnosticsFile(input: AssembleInput): Record<string, unknown> {
  const all = input.result.diagnostics;
  const deterministic = all.filter((d) => d.source === "deterministic");
  const judged = all.filter((d) => d.source === "judged");
  return {
    deterministic,
    judged,
    /**
     * Covers the deterministic findings alone, so a consumer can verify the
     * reproducible portion without knowing whether an optional judged critic
     * ran. Hashing all findings together would make the reproducible half
     * unverifiable the moment an advisory one appeared.
     *
     * This one IS a canonical-value hash (`IR-R12`) rather than a byte hash,
     * because it covers a sub-object rather than a file. Tamper detection for
     * the file itself is `package.json`'s byte hash; this is for comparing the
     * reproducible half across two packages.
     */
    deterministic_hash: contentHash(deterministic),
    refused: input.result.refused,
  };
}

/** Semantic provenance: who introduced each node, and what trust it resolved to. */
function provenanceFile(input: AssembleInput): Record<string, unknown> {
  const { ir } = input;
  const nodes: Array<Record<string, unknown>> = [];
  const push = (id: string, source_ref: string): void => {
    nodes.push({ node_id: id, source_ref });
  };
  push("objective", ir.objective.source_ref);
  push("scope", ir.scope.source_ref);
  for (const n of [
    ...ir.goals,
    ...ir.constraints,
    ...ir.non_goals,
    ...ir.assumptions,
    ...ir.open_questions,
    ...ir.verification,
    ...ir.deliverables,
  ]) {
    push(n.id, n.source_ref);
  }
  return {
    nodes,
    context_refs: ir.context_refs.map((r) => ({
      ref_id: r.id,
      content_hash: r.content_hash,
      trust: r.trust,
      justifies: [...r.justifies],
    })),
    materialization: input.result.materialization,
    dropped_context: input.result.droppedContext,
    topology_gaps: input.result.topologyGaps,
  };
}

/**
 * Assemble one package. Pure: the only impure value, `generatedAt`, is supplied
 * by the caller and reaches nothing but `run.json`.
 */
export function assemblePackage(input: AssembleInput): ExecutionPackage {
  const { ir, profile, result, overlay } = input;
  const requirements: readonly Requirement[] = requirementManifest(ir, input.ledger ?? []);

  const semanticId = contentHash(semanticIdInputs(input));

  // Order is fixed so two assemblies produce the same file list in the same
  // sequence; `package.json` is built last because it hashes the others.
  const body: PackageFile[] = [
    file("task-ir.json", ir),
    file("strategy.json", overlay ?? null),
    file("requirements.json", { requirements }),
    file("trace.json", {
      spans: result.spans.map((s) => ({
        artifact_path: s.artifact_path,
        start: s.start,
        end: s.end,
        origin: s.origin,
      })),
    }),
    file("provenance.json", provenanceFile(input)),
    file("runtime-contract.json", runtimeContract(input)),
    file("verification.json", verificationFile(input)),
    file("diagnostics.json", diagnosticsFile(input)),
  ];

  const artifacts: PackageFile[] = result.artifacts.map((a) => ({
    path: `artifacts/${a.path}`,
    content: a.content,
    contentHash: a.content_hash,
  }));

  const manifest = file("package.json", {
    package_format_version: PACKAGE_FORMAT_VERSION,
    semantic_id: semanticId,
    forge_version: FORGE_COMPILER_VERSION,
    ir_version: IR_VERSION,
    compiler_version: FORGE_COMPILER_VERSION,
    profile: { id: profile.id, version: profile.version, fidelity: profile.fidelity },
    tokenizer: { id: result.tokenizer.id, version: result.tokenizer.version },
    strategy: result.strategy,
    repository: { commit: null, dirty: null },
    refused: result.refused,
    // PK-R2: the content hash of every other semantic file, artifacts included,
    // so a consumer can detect tampering without recompiling.
    files: [...body, ...artifacts].map((f) => ({ path: f.path, content_hash: f.contentHash })),
  });

  return {
    semanticId,
    files: [manifest, ...body, ...artifacts],
    run: file("run.json", {
      generated_at: input.generatedAt,
      forge_version: FORGE_COMPILER_VERSION,
      // Named so nobody mistakes this file for something identity depends on.
      volatile: true,
      note: "Operational provenance (PV-R1). Excluded from semantic_id and expected to differ every run.",
    }),
  };
}
