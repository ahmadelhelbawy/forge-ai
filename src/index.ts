/**
 * Public surface of the FORGE core.
 *
 * `package.json` has always mapped `exports["."]` here, but the file did not
 * exist, so `import "forge"` threw for every consumer. This is that entrypoint.
 *
 * It is deliberately narrow. What is exported here is what external code may
 * depend on: the IR, the compiler, the profile registry, and the diagnostic
 * catalogue. Everything else stays reachable through the `./dist/*` subpath,
 * which is explicitly a deep-import escape hatch rather than a contract.
 *
 * The model layer is NOT re-exported. A consumer that wants to drive a boundary
 * supplies its own `ModelProvider` through the deep path, because pulling the
 * vendor SDKs into the root entrypoint would make `import "forge"` expensive for
 * the majority of consumers who only want to read or compile an IR.
 */

/** The Task IR: schema, vocabulary, hashing, attribution, trust, diagnostics. */
export * from "./ir/index.js";

/** Compilation: IR + profile -> artifacts, spans, diagnostics. Pure. */
export { compile, type CompileOptions } from "./compile/compile.js";
export type {
  Artifact,
  CompileResult,
  Materialization,
  SectionKey,
} from "./compile/types.js";

/** Agent profiles. Adding a target is a YAML file, not a code change. */
export {
  BUILTIN_PROFILE_DIR,
  ProfileNotFoundError,
  builtinProfiles,
  loadProfilesFrom,
} from "./profile/registry.js";
export { parseAgentProfile, type AgentProfile } from "./profile/schema.js";

/** Byte-level attribution of a compiled artifact. */
export {
  analyseCoverage,
  coverageEvidence,
  verifyCoverage,
  type CoverageGap,
  type CoverageReport,
} from "./trace/coverage.js";
export {
  describeOrigin,
  type LocalSpan,
  type NodeId,
  type Span,
  type TraceOrigin,
  type TraceOriginKind,
} from "./trace/span.js";
