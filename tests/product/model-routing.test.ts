/**
 * Provider → catalog → selection → request routing (regression).
 *
 * The defect this file exists for, as observed in a real browser: OpenRouter
 * was connected, its connection test passed on
 * `nvidia/nemotron-3-ultra-550b-a55b:free`, that model was saved as its default
 * — and the workspace selector offered only a hardcoded
 * "Claude Sonnet 4 (via OpenRouter)". Sending a message then produced an empty
 * assistant reply and no error, because the provider's `402` arrived as a
 * stream `error` part that nothing read.
 *
 * Each link of that chain is asserted separately, so a regression names the
 * link that broke rather than the symptom a user would see:
 *
 * 1. the catalog carries each provider's **saved** default, and no stale preset;
 * 2. display name and API model id stay separate;
 * 3. the selection rule prefers what is valid and falls back to the provider's
 *    saved default when the current pick is not;
 * 4. the request resolves to the exact API id;
 * 5. a stream error part is a thrown error, never an empty success;
 * 6. an empty completion fails the turn visibly instead of writing a blank reply.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectTextStream } from "../../web/lib/ai-provider";
import { resolveCall } from "../../web/lib/forge";
import { resolveSelection, type CatalogModel } from "../../web/lib/model-selection";
import { getDefaultModel, listModelOptions, saveProvider, setDefaultModel } from "../../web/lib/providers";
import { addPromptVersion, newConversation } from "../../web/lib/store";
import { executeTurn, type TurnDeps } from "../../web/lib/turn/pipeline";

const NEMOTRON = "nvidia/nemotron-3-ultra-550b-a55b:free";

const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "FORGE_API_KEY",
  "FORGE_BASE_URL",
  "FORGE_MODEL",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
];
const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of [...PROVIDER_ENV, "FORGE_DATA_DIR", "FORGE_APP_SECRET"]) {
    if (!(name in SAVED_ENV)) SAVED_ENV[name] = process.env[name];
  }
  for (const name of PROVIDER_ENV) delete process.env[name];
  const dir = mkdtempSync(join(tmpdir(), "forge-routing-"));
  process.env["FORGE_DATA_DIR"] = join(dir, "data");
  process.env["FORGE_APP_SECRET"] = "unit-test-secret-0123456789";
});

afterEach(() => {
  for (const [name, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("1–2. the catalog is the provider's real saved catalog", () => {
  it("offers OpenRouter's saved default model", async () => {
    saveProvider("openrouter", { apiKey: "sk-or-test-1", defaultModel: NEMOTRON });
    const openrouter = (await listModelOptions()).filter((m) => m.provider === "openrouter");
    expect(openrouter.map((m) => m.id)).toContain(NEMOTRON);
  });

  it("offers no stale hardcoded OpenRouter preset", async () => {
    saveProvider("openrouter", { apiKey: "sk-or-test-1", defaultModel: NEMOTRON });
    const openrouter = (await listModelOptions()).filter((m) => m.provider === "openrouter");
    expect(openrouter.map((m) => m.id)).toEqual([NEMOTRON]);
    expect(openrouter.map((m) => m.displayName).join(" ")).not.toContain("Claude Sonnet");
  });

  it("lists the saved default first even for a provider that has presets", async () => {
    saveProvider("anthropic", { apiKey: "sk-ant-test-1", defaultModel: "claude-haiku-4-5" });
    const anthropic = (await listModelOptions()).filter((m) => m.provider === "anthropic");
    expect(anthropic[0]?.id).toBe("claude-haiku-4-5");
    // No duplicate when the saved default is also a preset.
    expect(anthropic.filter((m) => m.id === "claude-haiku-4-5")).toHaveLength(1);
  });

  it("includes a saved default that is not a preset at all", async () => {
    saveProvider("anthropic", { apiKey: "sk-ant-test-1", defaultModel: "claude-experimental-x" });
    const anthropic = (await listModelOptions()).filter((m) => m.provider === "anthropic");
    expect(anthropic[0]?.id).toBe("claude-experimental-x");
  });

  it("keeps display name and API id separate", async () => {
    saveProvider("anthropic", { apiKey: "sk-ant-test-1", defaultModel: "claude-haiku-4-5" });
    saveProvider("openrouter", { apiKey: "sk-or-test-1", defaultModel: NEMOTRON });
    const options = await listModelOptions();
    const haiku = options.find((m) => m.id === "claude-haiku-4-5");
    expect(haiku?.displayName).toBe("Claude Haiku 4.5");
    // A model FORGE has no documented name for is shown by its id, never by
    // an invented label.
    expect(options.find((m) => m.id === NEMOTRON)?.displayName).toBe(NEMOTRON);
  });
});

describe("3. the selection rule", () => {
  const catalog: CatalogModel[] = [
    { id: NEMOTRON, displayName: NEMOTRON, provider: "openrouter", providerDisplayName: "OpenRouter" },
    { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", provider: "anthropic", providerDisplayName: "Anthropic" },
    { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", provider: "anthropic", providerDisplayName: "Anthropic" },
  ];
  const providers = [
    { id: "openrouter", defaultModel: NEMOTRON },
    { id: "anthropic", defaultModel: "claude-opus-4-6" },
  ];

  it("keeps a current selection that is still in the catalog", () => {
    expect(
      resolveSelection({ models: catalog, providers, current: { provider: "anthropic", model: "claude-haiku-4-5" } }),
    ).toEqual({ provider: "anthropic", model: "claude-haiku-4-5", custom: false });
  });

  it("switches an invalid current model to THAT provider's saved default", () => {
    // Exactly the observed state: a stale Claude id under OpenRouter.
    expect(
      resolveSelection({
        models: catalog,
        providers,
        current: { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
      }),
    ).toEqual({ provider: "openrouter", model: NEMOTRON, custom: false });
  });

  it("uses the stored selection on a fresh load", () => {
    expect(
      resolveSelection({ models: catalog, providers, stored: { provider: "openrouter", model: NEMOTRON } }),
    ).toEqual({ provider: "openrouter", model: NEMOTRON, custom: false });
  });

  it("restores a stored custom model ID across a refresh", () => {
    expect(
      resolveSelection({
        models: catalog,
        providers,
        stored: { provider: "openrouter", model: "meta-llama/some-new-model", custom: true },
      }),
    ).toEqual({ provider: "openrouter", model: "meta-llama/some-new-model", custom: true });
  });

  it("does not resurrect a stale NON-custom stored model", () => {
    expect(
      resolveSelection({
        models: catalog,
        providers,
        stored: { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
      }),
    ).toEqual({ provider: "openrouter", model: NEMOTRON, custom: false });
  });

  it("keeps an on-screen custom model when its provider is still available", () => {
    expect(
      resolveSelection({
        models: catalog,
        providers,
        current: { provider: "anthropic", model: "claude-typed-by-hand", custom: true },
      }),
    ).toEqual({ provider: "anthropic", model: "claude-typed-by-hand", custom: true });
  });

  it("falls back to the first catalog model when the provider is gone", () => {
    expect(
      resolveSelection({ models: catalog, providers, current: { provider: "xai", model: "grok-2" } }),
    ).toEqual({ provider: "openrouter", model: NEMOTRON, custom: false });
  });

  it("leaving custom mode resolves to a list entry even when the custom id is stored", () => {
    // What the "List" button does: the typed id is current, NOT custom any
    // more, and the stored custom choice is the thing being abandoned.
    const typed = { provider: "openrouter", model: "nvidia/does-not-exist:free" };
    expect(resolveSelection({ models: catalog, providers, current: typed, stored: null })).toEqual({
      provider: "openrouter",
      model: NEMOTRON,
      custom: false,
    });
    // And the trap it avoids: with the custom choice still passed as stored,
    // the rule correctly keeps it — so the caller must not pass it.
    expect(
      resolveSelection({ models: catalog, providers, current: typed, stored: { ...typed, custom: true } })?.custom,
    ).toBe(true);
  });

  it("returns null when there is nothing to select", () => {
    expect(resolveSelection({ models: [], providers: [], current: null })).toBeNull();
  });
});

describe("persisting the selection", () => {
  it("records a custom flag only when the selection is custom", () => {
    saveProvider("openrouter", { apiKey: "sk-or-test-1", defaultModel: NEMOTRON });
    setDefaultModel("openrouter", NEMOTRON);
    expect(getDefaultModel()).toEqual({ provider: "openrouter", model: NEMOTRON });
    setDefaultModel("openrouter", "meta-llama/typed", true);
    expect(getDefaultModel()).toEqual({ provider: "openrouter", model: "meta-llama/typed", custom: true });
  });
});

describe("4. the request carries the exact API model id", () => {
  it("resolves an OpenRouter call to the id, verbatim", () => {
    saveProvider("openrouter", { apiKey: "sk-or-test-1", defaultModel: NEMOTRON });
    const call = resolveCall("openrouter", NEMOTRON);
    expect(call.modelId).toBe(NEMOTRON);
    expect(call.providerId).toBe("openrouter");
  });

  it("never sends a display label as the model id", () => {
    saveProvider("anthropic", { apiKey: "sk-ant-test-1" });
    expect(resolveCall("anthropic", "claude-haiku-4-5").modelId).toBe("claude-haiku-4-5");
  });
});

describe("5. a stream error is an error, never an empty success", () => {
  async function* parts(list: unknown[]): AsyncGenerator<unknown> {
    for (const part of list) yield part;
  }

  it("concatenates text deltas and reports each one", async () => {
    const seen: string[] = [];
    const text = await collectTextStream(
      parts([
        { type: "start" },
        { type: "text-delta", id: "t", text: "FORGE_" },
        { type: "text-delta", id: "t", text: "CONNECTED" },
        { type: "finish" },
      ]),
      (chunk) => seen.push(chunk),
    );
    expect(text).toBe("FORGE_CONNECTED");
    expect(seen).toEqual(["FORGE_", "CONNECTED"]);
  });

  it("throws the provider's own error when an error part arrives", async () => {
    const provider402 = Object.assign(new Error("Insufficient credits. Add more using https://openrouter.ai/settings/credits"), {
      statusCode: 402,
    });
    await expect(
      collectTextStream(parts([{ type: "start" }, { type: "error", error: provider402 }]), () => undefined),
    ).rejects.toBe(provider402);
  });

  it("wraps a non-Error error part so the message survives", async () => {
    await expect(
      collectTextStream(parts([{ type: "error", error: "model not found" }]), () => undefined),
    ).rejects.toThrow("model not found");
  });
});

describe("6. an empty completion fails the turn visibly", () => {
  const deps = (generated: string): TurnDeps => ({
    providerId: "test",
    renderGeneration: () => ({ system: "s", user: "u" }),
    complete: async (request) =>
      request.user.includes("Classify the user's message")
        ? { text: JSON.stringify({ action: "REVISE", versions: [] }), model: "m", latencyMs: 0 }
        : { text: generated, model: "m", latencyMs: 0 },
  });

  it("fails the turn and writes no blank assistant message", async () => {
    const convo = newConversation({});
    addPromptVersion(convo, "a prompt", "model", { action: "CREATE", turnId: "t0" });
    const result = await executeTurn(convo, "Reply exactly FORGE_CONNECTED", deps("   "));
    expect(result.failed).toBe(true);
    expect(String((result.error as Error | undefined)?.message)).toContain("empty response");
    expect(convo.messages.filter((m) => m.role === "assistant")).toEqual([]);
    expect(convo.promptVersions).toHaveLength(1);
  });

  it("still keeps a non-empty unreadable reply as chat, as before (W003)", async () => {
    const convo = newConversation({});
    addPromptVersion(convo, "a prompt", "model", { action: "CREATE", turnId: "t0" });
    const result = await executeTurn(convo, "hello", deps("plain prose, no envelope"));
    expect(result.failed).toBe(false);
    expect(result.reply).toBe("plain prose, no envelope");
  });
});
