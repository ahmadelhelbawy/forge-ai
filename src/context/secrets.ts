/**
 * Secret detection — fail-closed content screening (SC-R5, SC-R6).
 *
 * Runs BEFORE content is representable as context (see `workspace.ts`).
 * Findings record the rule and occurrence count — NEVER the secret itself.
 * Vendored high-confidence provider-key patterns plus an entropy heuristic;
 * an optional shell-out to `gitleaks` when installed (probed, never assumed).
 */
import { execFileSync } from "node:child_process";

export interface SecretFinding {
  /** Public rule name, e.g. "aws-access-key". Safe to log and record. */
  readonly rule: string;
  readonly count: number;
}

export interface SecretScan {
  readonly findings: readonly SecretFinding[];
  /** Content with every match replaced by `<redacted:rule>`. */
  readonly redacted: string;
  readonly secretPresent: boolean;
}

interface SecretRule {
  readonly name: string;
  readonly pattern: RegExp;
}

const RULES: readonly SecretRule[] = [
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9-_]{20,}\b/g },
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z-_]{35}\b/g },
  { name: "stripe-live-key", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  // Credential assignment with a substantial value. Bare words like
  // "password field" (no value) must NOT match — the value is required.
  // The keyword may carry an identifier prefix (`db_password`), so the left
  // edge asserts "not preceded by a letter" rather than a word boundary.
  {
    name: "credential-assignment",
    pattern: /(?<![A-Za-z])(?:password|passwd|secret|api[_-]?key|api[_-]?token)\b\s*[:=]\s*["']?[^\s"'<>]{12,}["']?/gi,
  },
];

/** Shannon entropy of a string, in bits per character. */
function shannonEntropy(token: string): number {
  const counts = new Map<string, number>();
  for (const ch of token) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / token.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const TOKEN_PATTERN = /[A-Za-z0-9+/=_-]{24,}/g;

/**
 * High-entropy-token heuristic. Requires mixed character classes so that
 * hex content hashes (lowercase + digits only) are NOT flagged — a hash in a
 * test fixture is not a secret, and a scanner that cries wolf trains users
 * to ignore it.
 */
function entropyFindings(content: string): SecretFinding | null {
  let count = 0;
  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const mixed =
      /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
    if (mixed && shannonEntropy(token) >= 4.5) count += 1;
  }
  return count > 0 ? { rule: "high-entropy-token", count } : null;
}

export function scanSecrets(content: string): SecretScan {
  const findings: SecretFinding[] = [];
  let redacted = content;
  for (const rule of RULES) {
    // Fresh global regex state per scan: module-level /g/ regexes are stateful.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let count = 0;
    redacted = redacted.replace(pattern, () => {
      count += 1;
      return `<redacted:${rule.name}>`;
    });
    if (count > 0) findings.push({ rule: rule.name, count });
  }
  const entropy = entropyFindings(content);
  if (entropy) {
    findings.push(entropy);
    redacted = redacted.replace(TOKEN_PATTERN, (token) => {
      const mixed = /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
      return mixed && shannonEntropy(token) >= 4.5 ? "<redacted:high-entropy-token>" : token;
    });
  }
  return { findings, redacted, secretPresent: findings.length > 0 };
}

/**
 * Whether an external `gitleaks` binary is available for defense in depth.
 * Probed at call time, never assumed. Absence is fine — the vendored rules
 * above are the enforcement path; gitleaks is additive.
 */
export function probeGitleaks(): { available: boolean } {
  try {
    execFileSync("gitleaks", ["version"], { stdio: "ignore", timeout: 5000 });
    return { available: true };
  } catch {
    return { available: false };
  }
}

/**
 * A secret that would be inlined is a hard error, not a warning (SC-R6).
 * Thrown by `WorkspaceGuard.readInline` when scanned content carries secrets.
 * Until an emitter carries bodies (no P2 artifact does), this fires only
 * through the guard API — tested there, so the mechanism exists before any
 * renderer could need it.
 */
export class SecretInlineError extends Error {
  constructor(
    readonly path: string,
    readonly findings: readonly SecretFinding[],
  ) {
    super(
      `Refusing to inline ${path}: ${findings.map((f) => `${f.rule} x${f.count}`).join(", ")}. ` +
        `A secret that would be inlined is a hard error (SC-R6).`,
    );
    this.name = "SecretInlineError";
  }
}
