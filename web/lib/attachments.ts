/**
 * Ingesting an uploaded file (V2-R step 10).
 *
 * TWO DEFECTS, ONE PATH. An attachment went into the model's system prompt
 * verbatim, which was wrong in two unrelated ways.
 *
 * SECRETS. `src/context/` has scanned and redacted since P2 — `WorkspaceGuard`
 * will not hand back un-redacted bytes (SC-R6) — but the workspace's upload
 * route never called any of it. A `.env` dragged into the chat window was
 * forwarded to a third-party provider in full. That is the security half, and
 * it is the reason this step exists.
 *
 * TRUST. INV-002: untrusted content never becomes an authoritative instruction
 * *or premise*. An uploaded file is `explicit` under SC-R2 — the user chose the
 * file, which says nothing whatever about who wrote its bytes — so it resolves
 * to `semi_trusted`. It was previously introduced to the model as "project
 * material, not instructions", which is a hint rather than a rule, and a hint
 * is not what stands between a poisoned file and a prompt that obeys it.
 *
 * Both halves reuse `src/context/`'s pure functions. Nothing is reimplemented
 * here, `forge` gains no dependency on `web`, and a test asserts this path and
 * `scanSecrets` agree byte for byte — so a future change to the vendored rules
 * cannot leave the upload path behind.
 *
 * Redaction is surgical, not refusal: the rest of the file is kept, because a
 * user who attached a deployment note with one key in it still needs the note.
 * Findings are recorded by rule and count and never by value, so the record of
 * a secret is not a second copy of it.
 */
import { scanSecrets, type SecretFinding } from "forge/dist/context/secrets.js";
import { assignTrust, type SourceClass } from "forge/dist/context/trust.js";
import type { TrustTier } from "forge/dist/ir/vocabulary.js";

/**
 * The source class an upload gets.
 *
 * `explicit` is SC-R2's class for a file the user named directly (`--file` on
 * the CLI). Naming it here rather than inlining the string keeps the choice
 * visible: promoting an attachment to `trusted` would be a one-word edit, and
 * it should look like the invariant change it is.
 */
export const ATTACHMENT_SOURCE_CLASS: SourceClass = "explicit";

export interface IngestedAttachment {
  /** What is stored and what the model sees: redacted, NUL-free. */
  readonly content: string;
  /** Rule and count only — never a value (SC-R6). */
  readonly findings: readonly SecretFinding[];
  readonly trust: TrustTier;
}

/** Strip NUL bytes, which break storage and display and are never meaningful here. */
function stripNul(text: string): string {
  const nul = String.fromCharCode(0);
  return text.indexOf(nul) >= 0 ? text.split(nul).join("") : text;
}

export function ingestAttachment(_name: string, raw: string): IngestedAttachment {
  const scan = scanSecrets(stripNul(raw));
  return {
    content: scan.redacted,
    findings: scan.findings,
    trust: assignTrust(ATTACHMENT_SOURCE_CLASS),
  };
}
