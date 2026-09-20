/**
 * Credential hygiene on save (default suite, offline).
 *
 * A key pasted from a terminal or a password manager frequently carries a
 * trailing newline or space. Stored verbatim it becomes `Bearer sk-x…\n`,
 * which the upstream rejects as an invalid key — indistinguishable, from the
 * UI, from a genuinely wrong key, and it reproduces only for the user who
 * pasted it. The same applies to a base URL with stray whitespace.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProvider, saveProvider } from "../../web/lib/providers";

const SAVED = { dir: process.env["FORGE_DATA_DIR"], secret: process.env["FORGE_APP_SECRET"] };

beforeEach(() => {
  process.env["FORGE_DATA_DIR"] = mkdtempSync(join(tmpdir(), "forge-hygiene-"));
  process.env["FORGE_APP_SECRET"] = "test-secret-at-least-16-chars";
});

afterEach(() => {
  if (SAVED.dir === undefined) delete process.env["FORGE_DATA_DIR"];
  else process.env["FORGE_DATA_DIR"] = SAVED.dir;
  if (SAVED.secret === undefined) delete process.env["FORGE_APP_SECRET"];
  else process.env["FORGE_APP_SECRET"] = SAVED.secret;
});

describe("provider save hygiene", () => {
  it("trims surrounding whitespace from a pasted API key", () => {
    saveProvider("opencode-go", { apiKey: "  sk-real-key-value\n" });
    expect(resolveProvider("opencode-go")!.apiKey).toBe("sk-real-key-value");
  });

  it("trims surrounding whitespace from a pasted base URL", () => {
    saveProvider("opencode-go", { baseURL: " https://opencode.ai/zen/go/v1 " });
    expect(resolveProvider("opencode-go")!.baseURL).toBe("https://opencode.ai/zen/go/v1");
  });

  /** Whitespace-only input must not be stored as a key. */
  it("treats a whitespace-only key as absent rather than storing it", () => {
    saveProvider("opencode-go", { apiKey: "   \n  " });
    expect(resolveProvider("opencode-go")!.apiKey).toBe("");
  });

  /** Interior characters are never touched — some keys legitimately contain them. */
  it("preserves the key's interior exactly", () => {
    saveProvider("opencode-go", { apiKey: "sk-a.b_c-d/e+f=" });
    expect(resolveProvider("opencode-go")!.apiKey).toBe("sk-a.b_c-d/e+f=");
  });

  /** An emptied base URL means "use this provider's default", not "no URL". */
  it("falls back to the preset default when the base URL is cleared", () => {
    saveProvider("opencode-go", { baseURL: "   " });
    expect(resolveProvider("opencode-go")!.baseURL).toBe("https://opencode.ai/zen/go/v1");
  });
});
