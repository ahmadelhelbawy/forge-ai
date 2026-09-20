/**
 * AgentProfile — the target description, as pure data (FR-012, AP-R1..AP-R8).
 *
 * A profile is DATA. The compiler never imports one as code, and nothing in the
 * compiler branches on a profile id. Adding a target at `compatibility` or
 * `native_topology` fidelity is a YAML file and zero TypeScript (NFR-004, AC-017).
 *
 * Capabilities use the SAME closed vocabulary as `TaskIR.required_capabilities`, which
 * is what makes legalization a total function rather than a string match (AP-R2).
 */
import { z } from "zod";

import { CAPABILITIES } from "../ir/vocabulary.js";
import {
  CAPABILITY_LEVELS,
  FIDELITY_LEVELS,
  PATH_VARS,
  RETRIEVAL_STRENGTHS,
  SECTION_KEYS,
} from "../compile/vocabulary.js";

const ShortText = z.string().trim().min(1).max(500);

const ProfileId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "must be lowercase kebab-case, e.g. \"claude-code\"");

/** Free-form but ordered: profiles version independently of FORGE (NFR-012). */
const ProfileVersion = z.string().regex(/^[0-9]+(\.[0-9]+)*$/, 'must look like "2026.09.1"');

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like "2026-09-07"');

const CapabilityDeclaration = z.strictObject({
  level: z.enum(CAPABILITY_LEVELS),
  note: ShortText.optional(),
});

/**
 * Every capability in the vocabulary must be declared explicitly.
 *
 * No defaulting: an omitted capability would silently become whatever the default is,
 * and a profile author who has not considered a capability should be forced to say so
 * rather than inherit an assumption. This is what keeps INV-014 honest at the source.
 */
const CapabilityMap = z.strictObject(
  Object.fromEntries(CAPABILITIES.map((c) => [c, CapabilityDeclaration])) as Record<
    (typeof CAPABILITIES)[number],
    typeof CapabilityDeclaration
  >,
);

/**
 * Sections without which a compiled package would be missing instructions the author
 * actually gave. A topology omitting one of these is malformed, not merely minimal.
 */
export const MANDATORY_SECTIONS = ["objective", "goals", "constraints"] as const;

/**
 * One output file and the sections it carries, in order (AP-R4).
 *
 * `path` is a template over the closed `PATH_VARS` set. It is validated as a TEMPLATE,
 * not merely as a rendered result: a template that *could* escape the output directory
 * is a defect even when today's values happen not to.
 */
const ArtifactTopology = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(300)
    .refine((p) => !p.startsWith("/"), "must be relative, not absolute")
    .refine((p) => !/^[a-zA-Z]:[\\/]/.test(p), "must not be a drive-qualified path")
    .refine((p) => !p.includes("\\"), 'must use "/" separators')
    .refine((p) => !p.split("/").includes(".."), 'must not contain a ".." segment')
    .refine(
      (p) => [...p.matchAll(/\{([^}]*)\}/g)].every((m) => (PATH_VARS as readonly string[]).includes(m[1] ?? "")),
      `may only use these template variables: ${PATH_VARS.map((v) => `{${v}}`).join(", ")}`,
    ),
  sections: z.array(z.enum(SECTION_KEYS)).min(1),
});

export const AgentProfileSchema = z.strictObject({
  id: ProfileId,
  display_name: ShortText,
  version: ProfileVersion,
  /** When a human last checked this profile against the real target (AP-R7). */
  verified_against: IsoDate,
  family: ShortText,
  /** An honest claim, enforced by FORGE-C101 (INV-014). */
  fidelity: z.enum(FIDELITY_LEVELS),

  retrieval: z.strictObject({
    /** Primary driver of materialization (AP-R3, FR-019). */
    autonomous_search: z.enum(RETRIEVAL_STRENGTHS),
    tools: z.array(ShortText).default([]),
  }),

  capabilities: CapabilityMap,

  autonomy: z.strictObject({
    default: z.enum(["low", "medium", "high"]),
    configurable: z.boolean(),
    permission_model: ShortText,
  }),

  budget: z.strictObject({
    max_context_tokens: z.number().int().positive(),
    /** Fraction of the context window the compiled package may occupy. */
    artifact_share: z.number().gt(0).lte(1),
  }),

  output: z
    .strictObject({
      artifacts: z.array(ArtifactTopology).min(1),
      path_vars: z.array(z.enum(PATH_VARS)).default([]),
      /**
       * Section overrides for `full` fidelity (FR-022, P6). Declaring one in P1 is a
       * FORGE-C101 error because no override is registered yet — a profile may not
       * claim capability the renderer does not have.
       */
      overrides: z.partialRecord(z.enum(SECTION_KEYS), ShortText).default({}),
    })
    /**
     * Mandatory sections must appear EXACTLY ONCE across the topology
     * (docs/architecture.md §8.2).
     *
     * Without this, a topology could silently omit the goals or the constraints and
     * still compile: FORGE-C002 only protects hard constraints, so goals, non-goals,
     * verification and deliverables could vanish by omission with no diagnostic at all.
     * A profile that cannot carry the core instruction set is malformed, so this is a
     * profile validity error rather than a task diagnostic.
     */
    .refine(
      (output) => {
        const counts = new Map<string, number>();
        for (const artifact of output.artifacts) {
          for (const key of artifact.sections) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return MANDATORY_SECTIONS.every((key) => counts.get(key) === 1);
      },
      {
        error: `topology must contain each of ${MANDATORY_SECTIONS.join(", ")} exactly once; ` +
          `omitting one would silently drop instructions, and duplicating one would render it twice`,
      },
    )
    .refine(
      (output) => {
        const seen = new Set<string>();
        for (const artifact of output.artifacts) {
          for (const key of artifact.sections) {
            if (seen.has(key)) return false;
            seen.add(key);
          }
        }
        return true;
      },
      { error: "no section may appear in more than one artifact" },
    ),

  limits: z.strictObject({
    /** Surfaced by `forge agents show`; the honest counterweight to `fidelity`. */
    known_gaps: z.array(ShortText).default([]),
    known_failure_modes: z.array(ShortText).default([]),
  }),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type ArtifactTopologyEntry = z.infer<typeof ArtifactTopology>;
export type CapabilityDeclarationValue = z.infer<typeof CapabilityDeclaration>;

export class ProfileShapeError extends Error {
  constructor(
    readonly source: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    const summary = issues
      .slice(0, 10)
      .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    super(`Agent profile ${source} failed validation with ${issues.length} issue(s):\n${summary}`);
    this.name = "ProfileShapeError";
  }
}

export function parseAgentProfile(input: unknown, source: string): AgentProfile {
  const result = AgentProfileSchema.safeParse(input);
  if (!result.success) throw new ProfileShapeError(source, result.error.issues);
  return result.data;
}
