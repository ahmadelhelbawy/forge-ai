/**
 * Verification evidence — the untrusted input V2-G ingests (`EV-R1`, `EV-R5`).
 *
 * Evidence is what an external executor reports about a run: which obligation,
 * what exit code, hashes of what it printed, who ran it and when. FORGE never
 * produces it (`INV-004`), and no model boundary can (`EV-R1`,
 * `tests/contract/verify-boundaries.test.ts`): it arrives as a file or a
 * request body the user supplies, and it is parsed here as hostile.
 *
 * **Hashes, never output.** A record carries `stdout_hash` and `stderr_hash`
 * and is rejected if it carries anything else — the schema is strict, so a
 * record with an inline `stdout` excerpt is refused as a whole rather than
 * stored. Raw test output routinely contains tokens, connection strings and
 * paths; keeping only hashes means none of it can reach a report, a package or
 * a conversation, and there is no excerpt to secret-scan because there is no
 * excerpt.
 *
 * **What a log adds.** A record may name `logs.stdout` / `logs.stderr`, files
 * beside the evidence file. When it does, the verifier hashes the file and the
 * record is rejected if the hash disagrees — which catches output edited after
 * it was recorded. It cannot catch a fabricator who recomputes the hash: there
 * is no signature, and `VERIFIED` means exactly *the supplied evidence, taken
 * at its word, shows the expected exit code* (`EV-R5`).
 */
import { z } from "zod";

import { VERIFICATION_KINDS } from "../ir/vocabulary.js";
import { isSafePackagePath } from "./contract.js";

const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const EVIDENCE_FORMAT_VERSION = "1.0";

export const EvidenceRecordSchema = z.strictObject({
  obligation_id: z.string().min(1),
  kind: z.enum(VERIFICATION_KINDS),
  /** Null only for a non-executable obligation, e.g. a human sign-off. */
  exit_code: z.number().int().nullable(),
  stdout_hash: Sha256.nullable(),
  stderr_hash: Sha256.nullable(),
  started_at: z.string().min(1),
  duration_ms: z.number().int().nonnegative().nullable(),
  /** Who executed: `ci`, `claude-code`, `codex`, `human`, … Free text; recorded, never trusted. */
  runner: z.string().min(1),
  repo_commit: z.string().nullable(),
  package_semantic_id: Sha256,
  /** Optional log files, relative to the evidence file, checked against the hashes above. */
  logs: z
    .strictObject({ stdout: z.string().min(1).optional(), stderr: z.string().min(1).optional() })
    .optional(),
});

export const EvidenceFileSchema = z.strictObject({
  records: z.array(EvidenceRecordSchema),
});

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type EvidenceFile = z.infer<typeof EvidenceFileSchema>;

export class EvidenceShapeError extends Error {
  constructor(detail: string) {
    super(
      `The evidence file is not valid evidence (${detail}). It is rejected as a whole: evidence is ` +
        `untrusted input, and a partially readable file is not evidence of anything (EV-R5).`,
    );
    this.name = "EvidenceShapeError";
  }
}

export function parseEvidence(text: string): EvidenceFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new EvidenceShapeError("not JSON");
  }
  const parsed = EvidenceFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new EvidenceShapeError(
      first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "does not match the evidence schema",
    );
  }
  return parsed.data;
}

/**
 * Every log path the evidence names, in record order — so the caller that can
 * read files (the CLI) knows what to hash. A path that could escape the
 * evidence directory is omitted: it is never read, and the record that names
 * it is rejected by the verdict pass.
 */
export function logPathsOf(evidence: EvidenceFile): readonly string[] {
  const paths = new Set<string>();
  for (const r of evidence.records) {
    for (const p of [r.logs?.stdout, r.logs?.stderr]) if (p !== undefined && isSafeLogPath(p)) paths.add(p);
  }
  return [...paths];
}

/** Relative, inside the evidence directory: no absolute path, drive letter or `..`. */
export const isSafeLogPath = isSafePackagePath;
