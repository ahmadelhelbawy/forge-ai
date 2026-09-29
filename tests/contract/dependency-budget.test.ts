/**
 * AC-023 / NFR-010: the runtime dependency budget of each package, asserted
 * from its own package.json. CLAUDE.md recorded that AC-023 cited a test that
 * did not exist; this is that test (pre-release audit, 2026-09-29).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function runtimeDependencies(path: string): string[] {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as { dependencies?: Record<string, string> };
  return Object.keys(manifest.dependencies ?? {});
}

describe("runtime dependency budget (AC-023, NFR-010)", () => {
  it("the core has at most eight runtime dependencies", () => {
    expect(runtimeDependencies("package.json").length).toBeLessThanOrEqual(8);
  });

  it("the web package has at most fourteen", () => {
    expect(runtimeDependencies("web/package.json").length).toBeLessThanOrEqual(14);
  });

  it("the core depends on nothing that exists to serve the web package", () => {
    const web = new Set(runtimeDependencies("web/package.json").filter((d) => d !== "forge"));
    expect(runtimeDependencies("package.json").filter((d) => web.has(d))).toEqual([]);
  });
});
