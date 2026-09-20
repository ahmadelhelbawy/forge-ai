/**
 * Secret corpus (SC-R5, SC-R6, AC-014).
 *
 * Guards in both directions: every synthetic credential in `fake.env` must be
 * detected and redacted with its rule recorded (never the value), and nothing
 * in `clean.ts` may be flagged — a scanner that cries wolf trains users to
 * ignore it, which is itself a security defect.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { probeGitleaks, scanSecrets } from "../../src/context/secrets.js";

const fakeEnv = readFileSync(new URL("../../fixtures/secrets/fake.env", import.meta.url), "utf8");
const cleanTs = readFileSync(new URL("../../fixtures/secrets/clean.ts", import.meta.url), "utf8");

describe("secret detection", () => {
  it("detects every planted credential class", () => {
    const scan = scanSecrets(fakeEnv);
    expect(scan.secretPresent).toBe(true);
    const rules = new Set(scan.findings.map((f) => f.rule));
    for (const rule of ["credential-assignment", "aws-access-key", "github-token", "stripe-live-key", "slack-token"]) {
      expect(rules, `expected rule ${rule}`).toContain(rule);
    }
  });

  it("redacts values and records rule + count, never the secret", () => {
    const scan = scanSecrets(fakeEnv);
    expect(scan.redacted).not.toContain("s3cret-prod-9x7q2w");
    expect(scan.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(scan.redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(scan.redacted).toContain("<redacted:credential-assignment>");
    expect(scan.redacted).toContain("<redacted:aws-access-key>");
    const total = scan.findings.reduce((sum, f) => sum + f.count, 0);
    expect(total).toBeGreaterThan(0);
    for (const finding of scan.findings) {
      expect(Object.keys(finding).sort()).toEqual(["count", "rule"]);
    }
  });

  it("flags nothing in clean code", () => {
    const scan = scanSecrets(cleanTs);
    expect(scan.findings).toEqual([]);
    expect(scan.secretPresent).toBe(false);
    expect(scan.redacted).toBe(cleanTs);
  });

  it("gitleaks probe reports availability honestly", () => {
    const probe = probeGitleaks();
    expect(typeof probe.available).toBe("boolean");
  });
});
