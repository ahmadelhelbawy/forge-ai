/**
 * Provider selection contract (NFR-003).
 *
 * Selection is external configuration: an explicit FORGE_PROVIDER wins,
 * otherwise legacy keys preserve behaviour, otherwise no source (refuse).
 * All cases run in-memory with fake env objects — no keys, no network.
 */
import { describe, expect, it } from "vitest";

import { selectProvider } from "../../src/cli/task.js";

describe("selectProvider", () => {
  it("selects openai-compatible from FORGE_* with base URL and model", () => {
    const selection = selectProvider(
      {},
      {
        FORGE_PROVIDER: "openai-compatible",
        FORGE_API_KEY: "test-key-never-sent",
        FORGE_BASE_URL: "https://example.invalid/v1",
        FORGE_MODEL: "example/model",
      },
    );
    expect(selection.provider?.id).toBe("openai-compat");
    expect(selection.provider?.defaultModel).toBe("example/model");
    expect(selection.summary).toContain("https://example.invalid/v1");
    expect(selection.summary).not.toContain("test-key-never-sent");
  });

  it("prefers --model over FORGE_MODEL", () => {
    const selection = selectProvider(
      { model: "example/override" },
      { FORGE_PROVIDER: "openai-compatible", FORGE_API_KEY: "k", FORGE_MODEL: "example/base" },
    );
    expect(selection.provider?.defaultModel).toBe("example/override");
  });

  it("selects anthropic from FORGE_PROVIDER=anthropic", () => {
    const selection = selectProvider(
      {},
      { FORGE_PROVIDER: "anthropic", FORGE_API_KEY: "k", FORGE_MODEL: "example/claude" },
    );
    expect(selection.provider?.id).toBe("anthropic");
  });

  it("rejects an unknown FORGE_PROVIDER as a usage error", () => {
    expect(() => selectProvider({}, { FORGE_PROVIDER: "telepathy" })).toThrow(/Unknown FORGE_PROVIDER/);
  });

  it("returns no source when FORGE_PROVIDER is set but the key is missing", () => {
    const selection = selectProvider({}, { FORGE_PROVIDER: "openai-compatible" });
    expect(selection.provider).toBeUndefined();
  });

  it("preserves legacy behaviour: anthropic key, then OpenAI key, then nothing", () => {
    expect(selectProvider({}, { ANTHROPIC_API_KEY: "k" }).provider?.id).toBe("anthropic");
    expect(selectProvider({}, { OPENAI_API_KEY: "k" }).provider?.id).toBe("openai-compat");
    expect(selectProvider({}, {}).provider).toBeUndefined();
  });

  it("treats empty-string env as unset (cleared credentials must not error)", () => {
    // Regression: the CLI test harness clears keys by exporting them empty.
    // FORGE_PROVIDER="" fell through to the unknown-provider usage error.
    expect(selectProvider({}, { FORGE_PROVIDER: "", FORGE_API_KEY: "" }).provider).toBeUndefined();
    expect(selectProvider({}, { FORGE_PROVIDER: "", OPENAI_API_KEY: "k" }).provider?.id).toBe(
      "openai-compat",
    );
  });
});
