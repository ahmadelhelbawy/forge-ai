/**
 * Published JSON Schemas for the Execution Package (`PK-R8`, `FR-010`).
 *
 * `PK-R8` says consuming a package requires only JSON parsing and the published
 * schema — no FORGE runtime. That promise is worth exactly as much as the
 * schema's accuracy, so these are not documentation: `assemblePackage`'s output
 * is validated against them in the test suite, and a drift between the
 * assembler and the published contract fails the build rather than shipping a
 * schema that describes a package FORGE does not produce.
 *
 * They are deliberately **permissive about the interior of borrowed
 * structures** and strict about the package's own shape. `task-ir.json` already
 * has a published schema of its own (`schema/task-ir.schema.json`) and is not
 * re-described here; diagnostics and spans are validated on their required
 * fields rather than re-specified, because the authority for those is
 * `spec.md` §10.2 and §12.2 and duplicating it would create a second place to
 * get them wrong.
 */
import { z } from "zod";

import { DIAGNOSTIC_SEVERITIES, DIAGNOSTIC_SOURCES } from "../ir/diagnostic.js";
import { REQUIREMENT_ORIGINS } from "../requirement/identity.js";
import { VERIFICATION_KINDS } from "../ir/vocabulary.js";

const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const FileRef = z.object({ path: z.string().min(1), content_hash: Sha256 });

export const PackageManifestSchema = z.object({
  package_format_version: z.string(),
  semantic_id: Sha256,
  forge_version: z.string(),
  ir_version: z.string(),
  compiler_version: z.string(),
  profile: z.object({ id: z.string(), version: z.string(), fidelity: z.string() }),
  tokenizer: z.object({ id: z.string(), version: z.string() }),
  strategy: z.object({ archetype: z.string(), version: z.number() }).nullable(),
  repository: z.object({ commit: z.string().nullable(), dirty: z.boolean().nullable() }),
  refused: z.boolean(),
  files: z.array(FileRef),
});

export const RequirementManifestSchema = z.object({
  requirements: z.array(
    z.object({
      id: z.string().regex(/^req-[0-9a-f]{12}$/),
      text: z.string().min(1),
      origin: z.enum(REQUIREMENT_ORIGINS),
      /** Null for a pinned requirement, which does not come from the IR (RQ-R1). */
      node_id: z.string().nullable(),
      kind: z.enum(["pinned", "goal", "constraint", "non_goal", "deliverable"]),
    }),
  ),
});

export const RuntimeContractSchema = z.object({
  /**
   * Both literal, and both load-bearing (`PK-R4`, `INV-004`). A consumer reading
   * this file must not have to infer that FORGE granted nothing; the file says so.
   */
  declares_only: z.literal(true),
  grants: z.null(),
  required_capabilities: z.array(z.string()),
  target: z.object({
    id: z.string(),
    version: z.string(),
    tools: z.array(z.string()),
    autonomy: z.string(),
    permission_model: z.string(),
  }),
  network_policy: z.string(),
  filesystem_scope: z.object({ include: z.array(z.string()), exclude: z.array(z.string()) }),
  blast_radius: z.string(),
  repository: z.object({ commit: z.string().nullable(), dirty: z.boolean().nullable() }),
  degradations: z.array(
    z.object({
      rule_id: z.string(),
      capability: z.string().nullable(),
      reason: z.string(),
      effect: z.string(),
    }),
  ),
});

export const VerificationFileSchema = z.object({
  /** `INV-004` stated in the artifact, not only in the specification. */
  executed_by_forge: z.literal(false),
  entries: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(VERIFICATION_KINDS),
      spec: z.string(),
      expected: z.string(),
      satisfies: z.array(z.string()),
      degraded_from: z.enum(VERIFICATION_KINDS).nullable(),
      degraded_by: z.string().nullable(),
    }),
  ),
});

const DiagnosticSchema = z.object({
  code: z.string(),
  name: z.string(),
  severity: z.enum(DIAGNOSTIC_SEVERITIES),
  source: z.enum(DIAGNOSTIC_SOURCES),
  message: z.string(),
  evidence: z.array(z.record(z.string(), z.unknown())).min(1),
});

export const DiagnosticsFileSchema = z.object({
  deterministic: z.array(DiagnosticSchema),
  judged: z.array(DiagnosticSchema),
  /** Covers the deterministic findings alone, so they verify without the judged ones. */
  deterministic_hash: Sha256,
  refused: z.boolean(),
});

export const TraceFileSchema = z.object({
  spans: z.array(
    z.object({
      artifact_path: z.string(),
      /** UTF-8 byte offsets (`src/trace/span.ts`), never code-unit offsets. */
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      origin: z.object({ kind: z.string() }).loose(),
    }),
  ),
});

export const ProvenanceFileSchema = z.object({
  nodes: z.array(z.object({ node_id: z.string(), source_ref: z.string() })),
  context_refs: z.array(
    z.object({
      ref_id: z.string(),
      content_hash: z.string(),
      trust: z.string(),
      justifies: z.array(z.string()),
    }),
  ),
  materialization: z.record(z.string(), z.string()),
  dropped_context: z.array(z.record(z.string(), z.unknown())),
  topology_gaps: z.array(z.record(z.string(), z.unknown())),
});

export const RunFileSchema = z.object({
  generated_at: z.string(),
  forge_version: z.string(),
  volatile: z.literal(true),
  note: z.string(),
});

/** Every published package schema, by the filename it validates. */
export const PACKAGE_SCHEMAS = {
  "package.json": PackageManifestSchema,
  "requirements.json": RequirementManifestSchema,
  "runtime-contract.json": RuntimeContractSchema,
  "verification.json": VerificationFileSchema,
  "diagnostics.json": DiagnosticsFileSchema,
  "trace.json": TraceFileSchema,
  "provenance.json": ProvenanceFileSchema,
  "run.json": RunFileSchema,
} as const;
