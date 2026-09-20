/**
 * Shared CLI failure mapping (CLI-R5).
 *
 * One allowlist, one mapping, every command. When each command held its own
 * copy they drifted — that is how exit 4 became unreachable in P1. `forge
 * task` (async, P1.5) exposed the second copy, so the mapping lives here.
 *
 * Exit codes: 0 ok · 1 diagnostics · 2 usage · 3 refused · 4 internal.
 */
export const EXIT = { ok: 0, diagnostics: 1, usage: 2, refused: 3, internal: 4 } as const;

/**
 * Map a thrown error to an exit code (CLI-R5).
 *
 * Deliberately an allowlist of known failure shapes. The pre-P1.4 form was
 * `error.name.includes("Error") ? usage : internal`, and since EVERY
 * JavaScript error name contains "Error" (`TypeError`, `RangeError`, …) exit
 * code 4 was unreachable and genuine internal faults were reported as usage
 * errors. An unexpected error must be loud and distinguishable, because that
 * is the difference between "you typed it wrong" and "FORGE has a bug".
 */
export const USAGE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "IrShapeError", // a malformed IR file the user supplied
  "ProfileShapeError", // a malformed profile YAML
  "ProfileNotFoundError",
  "StrategyNotFoundError", // unknown --strategy id (P4)
  "UnsupportedIrVersionError",
  "MigrationError",
  "PathTemplateError",
  "CanonicalizationError",
  "AttributionError",
  "SyntaxError", // JSON.parse on the user's file
  "CommanderError",
  "BoundaryError", // unusable boundary input, e.g. empty task text
]);

export function exitCodeFor(error: unknown): number {
  if (error instanceof Error && USAGE_ERROR_NAMES.has(error.name)) return EXIT.usage;
  if (error instanceof Error && (error as { code?: string }).code === "ENOENT") return EXIT.usage;
  return EXIT.internal;
}

export function fatal(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = exitCodeFor(error);
  process.stderr.write(`${message}\n`);
  if (code === EXIT.internal && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(code);
}
