/**
 * Explicit-file retriever (FR-025: "explicit user-supplied files").
 *
 * A user-named file carries a user-asserted justification (`--justifies g1`),
 * which FR-026 accepts in place of retrieval provenance. Two fail-closed
 * validations apply BEFORE the file becomes a candidate:
 *
 * 1. Every asserted id must be a goal or constraint of THIS IR. Anything
 *    else is rejected — it would be FORGE-C010 downstream (INV-006).
 * 2. The file must pass the full WorkspaceGuard gate on read (path jail,
 *    ignore rules, deny globs). Explicit selection does NOT bypass the
 *    guard, and per SC-R2 it does NOT promote trust either: an explicit
 *    repository file is still `semi_trusted`.
 */

import { GuardDeniedError, type WorkspaceGuard } from "../workspace.js";
import type { CandidateHit, RetrieverResult } from "./types.js";

export interface ExplicitRequest {
  readonly path: string;
  readonly justifies: readonly string[];
}

export interface ExplicitRejection {
  readonly path: string;
  readonly reason: string;
}

export function explicitSearch(
  guard: WorkspaceGuard,
  files: readonly ExplicitRequest[],
  justifiableIds: ReadonlySet<string>,
): { result: RetrieverResult; rejections: readonly ExplicitRejection[] } {
  const resultHits: CandidateHit[] = [];
  const rejections: ExplicitRejection[] = [];
  const notes: string[] = [];
  for (const file of files) {
    const bad = file.justifies.filter((id) => !justifiableIds.has(id));
    if (bad.length > 0) {
      rejections.push({
        path: file.path,
        reason: `justifies unknown node(s): ${bad.join(", ")}. Explicit files require --justifies with a goal or constraint id of this IR (C010).`,
      });
      continue;
    }
    if (file.justifies.length === 0) {
      rejections.push({
        path: file.path,
        reason: "no --justifies given. Explicit files require an explicit justification or are rejected (C010).",
      });
      continue;
    }
    try {
      const read = guard.readText(file.path, "explicit");
      resultHits.push({
        relPath: read.relPath,
        matchedNodeIds: [...file.justifies].sort(),
        matchedTerms: [],
        viaScopeGlob: false,
        sourceClass: "explicit",
        gitRecency: null,
        foundVia: ["explicit"],
      });
    } catch (error) {
      const reason = error instanceof GuardDeniedError ? error.reason : "read-error";
      rejections.push({ path: file.path, reason: `WorkspaceGuard denied: ${reason}.` });
    }
  }
  resultHits.sort((a, b) => (a.relPath < b.relPath ? -1 : 1));
  notes.push(
    `explicit: ${resultHits.length} accepted, ${rejections.length} rejected from ${files.length} request(s).`,
  );
  return { result: { hits: resultHits, notes }, rejections };
}
