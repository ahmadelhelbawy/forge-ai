/**
 * The context engine's public surface (P2).
 *
 * Pipeline: `query` → `retrievers/*` → `workspace` (WorkspaceGuard) →
 * `rank` + `roles` + `trust` → `resolve` (justified ContextRefs) →
 * `disambiguate` (evidence-first answers, escalation otherwise).
 */
export { normalizeText, tokenize, deriveQuery, type NodeQuery, type QuerySourceNode } from "./query.js";
export {
  scoreCandidate,
  rankCandidates,
  DEFAULT_WEIGHTS,
  ROLE_PRIORS,
  type RankWeights,
  type RankInput,
  type RankParts,
} from "./rank.js";
export {
  assignRole,
  declaresSymbol,
  isTestPath,
  TEST_GLOBS,
  type RoleInput,
  type RoleAssignment,
} from "./roles.js";
export { scanSecrets, probeGitleaks, SecretInlineError, type SecretFinding, type SecretScan } from "./secrets.js";
export { assignTrust, isDocumentationPath, type SourceClass } from "./trust.js";
export {
  WorkspaceGuard,
  GuardDeniedError,
  parseIgnoreFile,
  isIgnored,
  matchGlob,
  BUILTIN_DENY_GLOBS,
  type GuardConfig,
  type GuardFile,
  type DenyReason,
} from "./workspace.js";
export {
  resolveContext,
  DEFAULT_MAX_REFS,
  type ResolveOptions,
  type ResolvedContext,
  type ResolutionRun,
  type ScoreRecord,
  type DropRecord,
  type RedactionRecord,
} from "./resolve.js";
export {
  disambiguate,
  type EvidenceCandidate,
  type AnsweredQuestion,
  type EscalatedQuestion,
  type Disambiguation,
} from "./disambiguate.js";
export type { CandidateHit, RetrieverResult, RetrieverId } from "./retrievers/types.js";
export { ripgrepSearch } from "./retrievers/ripgrep.js";
export { globSearch } from "./retrievers/glob.js";
export { gitHistorySearch, GIT_HISTORY_COMMIT_CAP } from "./retrievers/git-history.js";
export {
  explicitSearch,
  type ExplicitRequest,
  type ExplicitRejection,
} from "./retrievers/explicit.js";
