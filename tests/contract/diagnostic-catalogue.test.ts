/**
 * The diagnostic registry must agree with `spec.md` §10.2.
 *
 * `src/ir/diagnostic.ts` says of itself: "The registry below transcribes
 * spec.md §10.2 in full." Nothing enforced that, and it drifted — `FORGE-W007`
 * was added to the registry during V2-E and never written into the
 * specification, so for a while the catalogue and the contract disagreed about
 * which codes exist. `plan.md`'s own precedent for V2-D1 is explicit that the
 * specification changes first, "so the registry transcribes §10.2".
 *
 * This test is the enforcement that was missing. It parses the two catalogue
 * tables out of `spec.md` and compares them to the registry in both directions:
 * a code in one and not the other fails, and so does a mismatched name,
 * severity or source.
 *
 * Reading a Markdown table in a test is unusual, and it is the point: the
 * specification is the artifact humans review, so the specification is what the
 * code must be checked against. Deriving the table from the registry instead
 * would make the check vacuous.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DIAGNOSTIC_REGISTRY, DIAGNOSTIC_SEVERITIES, DIAGNOSTIC_SOURCES } from "../../src/ir/diagnostic.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface SpecRow {
  readonly code: string;
  readonly name: string;
  readonly severity: string;
  readonly source: string;
}

/**
 * Rows look like:
 *   | `FORGE-W004` | `read_only_write_blocked` | error | deterministic | … |
 *
 * Footnote markers (`error¹`) are stripped: they qualify *when* a severity
 * applies, which §10.2 explains in prose beneath the table, and are not part of
 * the declared value.
 */
function specRows(): SpecRow[] {
  const spec = readFileSync(join(REPO_ROOT, "spec.md"), "utf8");
  const rows: SpecRow[] = [];
  const pattern = /^\|\s*`(FORGE-[CW]\d+)`\s*\|\s*`([a-z0-9_]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm;
  for (const m of spec.matchAll(pattern)) {
    rows.push({
      code: m[1]!,
      name: m[2]!,
      severity: m[3]!.replace(/[^a-z]/g, ""),
      source: m[4]!.replace(/[^a-z]/g, ""),
    });
  }
  return rows;
}

describe("the diagnostic registry transcribes spec.md §10.2", () => {
  const rows = specRows();

  /** Guards the parser itself: a regex that matched nothing would pass everything. */
  it("finds the catalogue tables in spec.md", () => {
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.map((r) => r.code)).toContain("FORGE-C001");
    expect(rows.map((r) => r.code)).toContain("FORGE-W001");
  });

  it("declares every code the registry implements", () => {
    const inSpec = new Set(rows.map((r) => r.code));
    const missing = Object.keys(DIAGNOSTIC_REGISTRY).filter((code) => !inSpec.has(code));
    expect(missing, `in the registry but absent from spec.md §10.2: ${missing.join(", ")}`).toEqual([]);
  });

  it("implements every code the specification declares", () => {
    const registered = new Set(Object.keys(DIAGNOSTIC_REGISTRY));
    const missing = rows.map((r) => r.code).filter((code) => !registered.has(code));
    expect(missing, `declared in spec.md §10.2 but absent from the registry: ${missing.join(", ")}`).toEqual([]);
  });

  it("agrees with the specification on every name, severity and source", () => {
    for (const row of rows) {
      const entry = DIAGNOSTIC_REGISTRY[row.code as keyof typeof DIAGNOSTIC_REGISTRY];
      expect(entry, `${row.code} is in spec.md but not the registry`).toBeDefined();
      expect(entry.name, `${row.code} name`).toBe(row.name);
      expect(entry.severity, `${row.code} severity`).toBe(row.severity);
      expect(entry.source, `${row.code} source`).toBe(row.source);
    }
  });

  /**
   * The claim `diagnostic.ts` has always made about itself. It was untrue for
   * long enough to be worth asserting rather than asserting again in prose.
   */
  it("keys its registry by the same code each entry carries", () => {
    for (const [key, entry] of Object.entries(DIAGNOSTIC_REGISTRY)) {
      expect(entry.code, `registry key ${key} disagrees with its entry's code`).toBe(key);
    }
  });

  it("uses only declared severities and sources", () => {
    for (const entry of Object.values(DIAGNOSTIC_REGISTRY)) {
      expect(DIAGNOSTIC_SEVERITIES).toContain(entry.severity);
      expect(DIAGNOSTIC_SOURCES).toContain(entry.source);
    }
  });
});
