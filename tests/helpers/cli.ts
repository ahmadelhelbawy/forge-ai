/**
 * CLI invocation helper for contract tests.
 *
 * WHY A REAL CHILD PROCESS. The CLI's contract is its OBSERVABLE behaviour: an exit code
 * (CLI-R5), what lands on stdout versus stderr, and what it writes to disk. Importing the
 * command module and calling a handler in-process would test neither the exit codes nor
 * commander's own argument handling, and `process.exit` inside an action makes in-process
 * testing unsound anyway. Spawning is slower and correct.
 *
 * This exists BEFORE `forge task` (P1.5) deliberately. The CLI carried 0 tests through P0
 * and P1, and `forge task` is the product's primary entry point — building the harness
 * afterwards is how a primary path stays untested.
 *
 * No network and no API key: `tsx` runs the local source tree.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = new URL(".", import.meta.url).pathname;
export const CLI_REPO_ROOT = join(here, "..", "..");
const TSX = join(CLI_REPO_ROOT, "node_modules", ".bin", "tsx");
const ENTRY = join(CLI_REPO_ROOT, "src", "cli", "index.ts");

/** Exit codes, from spec.md CLI-R5. Mirrored here so tests name them, not numbers. */
export const EXIT = {
  ok: 0,
  diagnostics: 1,
  usage: 2,
  refused: 3,
  internal: 4,
} as const;

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run `forge <args>` and capture the outcome.
 *
 * Never throws on a non-zero exit: the exit code IS the thing under test.
 */
export async function runCli(args: readonly string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(TSX, [ENTRY, ...args], {
      cwd: CLI_REPO_ROOT,
      env: {
        ...process.env,
        // The whole suite must pass with no credentials (NFR-007, AC-019). Clearing
        // them here means a command that quietly starts depending on one fails in CI
        // rather than on a contributor's machine.
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        FORGE_PROVIDER: "",
        FORGE_API_KEY: "",
        NO_COLOR: "1",
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : EXIT.internal,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** Parse `--json` output, failing with the raw text when it is not JSON. */
export function parseJson<T = unknown>(result: CliResult): T {
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(
      `Expected JSON on stdout but got:\n${result.stdout.slice(0, 2000)}\n--- stderr ---\n${result.stderr.slice(0, 2000)}`,
    );
  }
}
