/**
 * Provider settings unit tests (default suite, offline).
 *
 * Crypto roundtrip, masking, settings-vs-environment precedence, presets,
 * custom providers, default model, and the wrong-secret failure — all
 * against an isolated data dir, no network.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCustomProvider,
  deleteProvider,
  getDefaultModel,
  listModelOptions,
  listProviderSummaries,
  maskKey,
  resolveProvider,
  saveProvider,
  setDefaultModel,
} from "../../web/lib/providers";

const SAVED_ENV: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (!(name in SAVED_ENV)) SAVED_ENV[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

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

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "forge-prov-"));
  process.env["FORGE_DATA_DIR"] = join(dir, "data");
  process.env["FORGE_APP_SECRET"] = "unit-test-secret-0123456789";
  for (const name of PROVIDER_ENV) setEnv(name, undefined);
});

afterEach(() => {
  for (const [name, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("fresh install with no providers", () => {
  it("lists presets unconfigured with no usable models", async () => {
    const summaries = listProviderSummaries();
    expect(summaries).toHaveLength(6);
    expect(summaries.every((p) => p.status === "not-configured" || p.status === "untested")).toBe(true);
    expect(summaries.every((p) => p.maskedKey === "")).toBe(true);
    expect(await listModelOptions()).toEqual([]);
    expect(getDefaultModel()).toBeNull();
  });
});

describe("keys and masking", () => {
  it("stores encrypted secrets and masks browser output", () => {
    saveProvider("xai", { apiKey: "xai-test-key-abcdef1234" });
    const raw = readFileSync(join(process.env["FORGE_DATA_DIR"]!, "providers.secrets"), "utf8");
    expect(raw).not.toContain("xai-test-key-abcdef1234");
    const summary = listProviderSummaries().find((p) => p.id === "xai")!;
    expect(summary.maskedKey).toBe("xai••••••••1234");
    expect(summary.source).toBe("settings");
    expect(resolveProvider("xai")!.apiKey).toBe("xai-test-key-abcdef1234");
  });

  it("keeps the stored key when the update omits it", () => {
    saveProvider("xai", { apiKey: "xai-original-key" });
    saveProvider("xai", { enabled: false });
    expect(resolveProvider("xai")!.apiKey).toBe("xai-original-key");
    expect(resolveProvider("xai")!.enabled).toBe(false);
  });

  it("fails loudly on the wrong app secret", () => {
    saveProvider("xai", { apiKey: "xai-original-key" });
    process.env["FORGE_APP_SECRET"] = "different-secret-9999999999";
    expect(() => resolveProvider("xai")).toThrow(/cannot be decrypted/);
  });

  it("masks short and empty keys safely", () => {
    expect(maskKey("")).toBe("");
    expect(maskKey("abc")).toBe("••••••••");
  });
});

describe("environment fallback", () => {
  it("uses env keys with environment source until Settings overrides", () => {
    setEnv("XAI_API_KEY", "env-xai-key-1");
    expect(resolveProvider("xai")!.apiKey).toBe("env-xai-key-1");
    expect(resolveProvider("xai")!.source).toBe("environment");
    saveProvider("xai", { apiKey: "stored-xai-key-2" });
    expect(resolveProvider("xai")!.apiKey).toBe("stored-xai-key-2");
    expect(resolveProvider("xai")!.source).toBe("settings");
    const options = listProviderSummaries().find((p) => p.id === "xai")!;
    expect(options.status).toBe("untested");
  });

  it("exposes enabled providers with keys as model options", async () => {
    setEnv("XAI_API_KEY", "env-xai-key-1");
    const options = await listModelOptions();
    expect(options.some((o) => o.provider === "xai" && o.id === "grok-2")).toBe(true);
    expect(options.every((o) => o.provider === "xai")).toBe(true);
  });
});

describe("custom providers and defaults", () => {
  it("creates, configures, and deletes a custom provider", () => {
    const created = createCustomProvider({ name: "Acme Cloud", baseURL: "https://acme.example/v1", model: "acme-large" });
    expect(created.id).toBe("custom-acme-cloud");
    expect(created.custom).toBe(true);
    saveProvider(created.id, { apiKey: "acme-key-1" });
    expect(resolveProvider(created.id)!.baseURL).toBe("https://acme.example/v1");
    setDefaultModel(created.id, "acme-large");
    expect(getDefaultModel()).toEqual({ provider: created.id, model: "acme-large" });
    expect(deleteProvider(created.id)).toEqual({ deleted: true, reset: false });
    expect(resolveProvider(created.id)).toBeNull();
    expect(getDefaultModel()).toBeNull();
  });

  it("resets presets instead of deleting them", () => {
    saveProvider("openai", { apiKey: "sk-test-1", enabled: false });
    expect(deleteProvider("openai")).toEqual({ deleted: false, reset: true });
    const summary = listProviderSummaries().find((p) => p.id === "openai")!;
    expect(summary.source).toBe("default");
    expect(summary.enabled).toBe(true);
  });
});
