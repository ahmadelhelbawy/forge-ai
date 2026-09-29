/**
 * The core never depends on the workspace (CLAUDE.md: "`forge` may never
 * depend on `web`"; AD-21). The root tsconfig maps the web app's `@/` alias
 * so tests can import web code — which also means a core file COULD now
 * type-check against web/. This makes the direction a test, not a habit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.ts$/.test(name) ? [path] : [];
  });
}

const IMPORT = /(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

describe("the core never imports the workspace (AD-21)", () => {
  it("no file under src/ imports @/, web/, next, react or the AI SDK", () => {
    const offending: string[] = [];
    for (const file of sources(join(process.cwd(), "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const spec = match[1] ?? match[2] ?? "";
        if (/^@\//.test(spec) || /(^|\/)web\//.test(spec) || /^(next|react|react-dom|ai|@ai-sdk\/)/.test(spec)) {
          offending.push(`${file}: ${spec}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });
});
