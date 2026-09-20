/**
 * Server-side AI provider settings (server-only).
 *
 * Effective configuration = stored override ?? environment ?? preset
 * default. Secrets (API keys, custom headers) live ONLY in
 * data/providers.secrets, encrypted at rest with AES-256-GCM under a key
 * derived from FORGE_APP_SECRET. The browser sees masked keys, never values.
 * Environment variables keep working as fallback/defaults (documented in
 * .env.example); Settings writes always land in the store.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { openCodeModel, openCodeModels } from "./opencode-models";
import { dataDir } from "./store";

export type ProviderKind = "anthropic" | "openai-compat";

export interface ProviderPreset {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly defaultBaseURL: string | null;
  readonly envKeys: readonly string[];
  readonly envBaseURLs: readonly string[];
  readonly defaultModel: string;
  readonly modelsPreset: readonly { id: string; displayName: string }[];
  /** Gateway routing header filled with a random UUID per call (OpenCode Go). */
  readonly sessionHeader: string | null;
}

export const PRESETS: readonly ProviderPreset[] = [
  {
    id: "anthropic",
    kind: "anthropic",
    displayName: "Anthropic",
    defaultBaseURL: null,
    envKeys: ["ANTHROPIC_API_KEY", "FORGE_API_KEY"],
    envBaseURLs: [],
    defaultModel: "claude-sonnet-4-5",
    modelsPreset: [
      { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
      { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
    ],
    sessionHeader: null,
  },
  {
    id: "openai",
    kind: "openai-compat",
    displayName: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    envKeys: ["OPENAI_API_KEY", "FORGE_API_KEY"],
    envBaseURLs: ["OPENAI_BASE_URL", "FORGE_BASE_URL"],
    defaultModel: "gpt-4o-mini",
    modelsPreset: [
      { id: "gpt-4o-mini", displayName: "GPT-4o mini" },
      { id: "gpt-4o", displayName: "GPT-4o" },
      { id: "gpt-5.6", displayName: "GPT-5.6" },
    ],
    sessionHeader: null,
  },
  {
    id: "google",
    kind: "openai-compat",
    displayName: "Google Gemini",
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    envBaseURLs: [],
    defaultModel: "gemini-2.0-flash",
    modelsPreset: [
      { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro" },
      { id: "gemini-3.8-pro", displayName: "Gemini 3.8 Pro" },
    ],
    sessionHeader: null,
  },
  {
    id: "xai",
    kind: "openai-compat",
    displayName: "xAI / Grok",
    defaultBaseURL: "https://api.x.ai/v1",
    envKeys: ["XAI_API_KEY"],
    envBaseURLs: [],
    defaultModel: "grok-2",
    modelsPreset: [
      { id: "grok-2", displayName: "Grok 2" },
      { id: "grok-4", displayName: "Grok 4" },
    ],
    sessionHeader: null,
  },
  {
    id: "opencode-go",
    kind: "openai-compat",
    displayName: "OpenCode Go",
    defaultBaseURL: "https://opencode.ai/zen/go/v1",
    envKeys: ["FORGE_API_KEY", "OPENAI_API_KEY"],
    envBaseURLs: ["FORGE_BASE_URL"],
    defaultModel: "kimi-k3",
    // From the documented registry: display name for the UI, id for the wire.
    modelsPreset: openCodeModels().map((m) => ({ id: m.id, displayName: m.displayName })),
    sessionHeader: "x-opencode-session",
  },
  {
    id: "openrouter",
    kind: "openai-compat",
    displayName: "OpenRouter",
    defaultBaseURL: "https://openrouter.ai/api/v1",
    envKeys: ["OPENROUTER_API_KEY"],
    envBaseURLs: [],
    defaultModel: "anthropic/claude-sonnet-4",
    // No presets. OpenRouter fronts hundreds of models whose availability
    // depends on the account (a free key cannot call a paid model), so any
    // hardcoded entry is a guess that goes stale. The selector offers the
    // model the user saved and tested, and "Custom model ID…" for the rest.
    modelsPreset: [],
    sessionHeader: null,
  },
];

export interface StoredOverride {
  enabled?: boolean;
  displayName?: string;
  baseURL?: string | null;
  defaultModel?: string;
}

type SecretsFile = Record<string, { apiKey?: { iv: string; tag: string; data: string }; headers?: { iv: string; tag: string; data: string } }>;

interface StoreFile {
  overrides: Record<string, StoredOverride>;
  custom: Array<{ id: string; kind: ProviderKind; displayName: string; baseURL: string | null; defaultModel: string; sessionHeader: string | null }>;
  lastTest: Record<string, { ok: boolean; message: string; at: string }>;
  defaultModel?: { provider: string; model: string; custom?: true };
}

function storePath(): string {
  return join(dataDir(), "providers.json");
}

function secretsPath(): string {
  return join(dataDir(), "providers.secrets");
}

function appSecret(): { secret: string; insecureDefault: boolean } {
  const configured = process.env["FORGE_APP_SECRET"];
  if (configured && configured.length >= 16) return { secret: configured, insecureDefault: false };
  if (!configured) {
    console.warn("[forge] FORGE_APP_SECRET is not set — provider secrets use an insecure dev key. Set it in production.");
  }
  return { secret: configured && configured.length > 0 ? configured : "forge-dev-secret--change-me", insecureDefault: true };
}

function cipherKey(): Buffer {
  return scryptSync(appSecret().secret, "forge-provider-v1", 32);
}

function encryptSecret(plain: string): { iv: string; tag: string; data: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function decryptSecret(blob: { iv: string; tag: string; data: string }): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(blob.iv, "base64"));
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Provider secrets cannot be decrypted — FORGE_APP_SECRET changed or is wrong.");
  }
}

function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as Partial<StoreFile>;
    return {
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      lastTest: parsed.lastTest && typeof parsed.lastTest === "object" ? parsed.lastTest : {},
      defaultModel: parsed.defaultModel,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { overrides: {}, custom: [], lastTest: {} };
    }
    throw new Error("Provider settings file is corrupt and cannot be loaded.");
  }
}

function writeStore(store: StoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  renameSync(tmp, path);
}

function readSecrets(): SecretsFile {
  try {
    return JSON.parse(readFileSync(secretsPath(), "utf8")) as SecretsFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function writeSecrets(secrets: SecretsFile): void {
  const path = secretsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(secrets), "utf8");
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort (non-POSIX filesystems).
  }
}

/** Masked for the browser: prefix plus last four, never the middle. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  const prefix = key.slice(0, 3);
  return `${prefix}••••••••${key.slice(-4)}`;
}

function firstEnv(names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
  }
  return "";
}

export interface EffectiveProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly custom: boolean;
  readonly source: "settings" | "environment" | "default";
  readonly apiKey: string;
  readonly baseURL: string | null;
  readonly defaultModel: string;
  readonly headers: Record<string, string>;
  readonly sessionHeader: string | null;
}

function presetById(id: string): ProviderPreset | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}

function customById(store: StoreFile, id: string) {
  return store.custom.find((c) => c.id === id) ?? null;
}

/** Resolve one provider to its effective server-side configuration. */
export function resolveProvider(id: string): EffectiveProvider | null {
  const store = readStore();
  const secrets = readSecrets();
  const override = store.overrides[id];
  const custom = customById(store, id);
  const preset = presetById(id);
  if (!custom && !preset) return null;

  const kind = custom ? custom.kind : preset!.kind;
  const displayName = override?.displayName ?? custom?.displayName ?? preset!.displayName;
  const storedSecrets = secrets[id];
  // Trimmed on read as well as on write: a key stored before this hygiene
  // existed, or supplied through the environment, must not carry whitespace
  // into the Authorization header either.
  const apiKey = (
    (storedSecrets?.apiKey ? decryptSecret(storedSecrets.apiKey) : "") ||
    (preset ? firstEnv(preset.envKeys) : "")
  ).trim();
  const headers: Record<string, string> = {};
  if (storedSecrets?.headers) {
    try {
      Object.assign(headers, JSON.parse(decryptSecret(storedSecrets.headers)) as Record<string, string>);
    } catch {
      // Corrupt headers blob: fail closed on headers, keep the key path working.
    }
  }
  const envModel = process.env["FORGE_MODEL"] ?? "";  const baseURL =
    override?.baseURL ?? custom?.baseURL ?? (preset ? firstEnv(preset.envBaseURLs) || preset.defaultBaseURL : null);
  const hasStoredConfig = override !== undefined || storedSecrets !== undefined || custom !== null;
  return {
    id,
    kind,
    displayName,
    enabled: override?.enabled ?? true,
    custom: custom !== null,
    source: hasStoredConfig ? "settings" : apiKey ? "environment" : "default",
    apiKey,
    baseURL,
    defaultModel: override?.defaultModel || custom?.defaultModel || envModel || preset!.defaultModel,
    headers,
    sessionHeader: custom?.sessionHeader ?? preset?.sessionHeader ?? null,
  };
}

export interface ProviderSummary {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly custom: boolean;
  readonly source: "settings" | "environment" | "default";
  readonly status: "connected" | "error" | "not-configured" | "disabled" | "untested";
  readonly maskedKey: string;
  readonly baseURL: string | null;
  readonly defaultModel: string;
  readonly headers: string[];
  readonly modelsPreset: Array<{ id: string; displayName: string }>;
  readonly sessionHeader: string | null;
  readonly lastTest: { ok: boolean; message: string; at: string } | null;
}

export function listProviderSummaries(): ProviderSummary[] {
  const store = readStore();
  const ids = [...PRESETS.map((p) => p.id), ...store.custom.map((c) => c.id)];
  return ids.map((id) => {
    const eff = resolveProvider(id)!;
    const lastTest = store.lastTest[id] ?? null;
    const status = !eff.enabled
      ? "disabled"
      : !eff.apiKey
        ? "not-configured"
        : lastTest
          ? lastTest.ok ? "connected" : "error"
          : "untested";
    const preset = presetById(id);
    return {
      id: eff.id,
      kind: eff.kind,
      displayName: eff.displayName,
      enabled: eff.enabled,
      custom: eff.custom,
      source: eff.source,
      status,
      maskedKey: maskKey(eff.apiKey),
      baseURL: eff.baseURL,
      defaultModel: eff.defaultModel,
      headers: Object.keys(eff.headers),
      modelsPreset: preset ? [...preset.modelsPreset] : [],
      sessionHeader: eff.sessionHeader,
      lastTest,
    };
  });
}

export interface SaveInput {
  enabled?: boolean;
  displayName?: string;
  apiKey?: string;
  baseURL?: string | null;
  defaultModel?: string;
  headers?: Record<string, string> | null;
}

/** Save a settings override. An empty/absent apiKey keeps the stored key. */
export function saveProvider(id: string, input: SaveInput): ProviderSummary {
  const store = readStore();
  const secrets = readSecrets();
  const existing = store.overrides[id] ?? {};
  const next: StoredOverride = { ...existing };
  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.displayName !== undefined && input.displayName.trim()) next.displayName = input.displayName.trim().slice(0, 80);
  // Whitespace around a pasted value is invisible in the UI but fatal on the
  // wire: a key becomes `Bearer sk-…\n` and the upstream rejects it as
  // invalid. An emptied field means "use the default", so it stores nothing.
  if (input.baseURL !== undefined) next.baseURL = input.baseURL === null ? null : input.baseURL.trim() || null;
  if (input.defaultModel !== undefined && input.defaultModel.trim()) next.defaultModel = input.defaultModel.trim().slice(0, 120);
  store.overrides[id] = next;
  const entry = secrets[id] ?? {};
  const apiKey = input.apiKey?.trim() ?? "";
  if (apiKey.length > 0) {
    entry.apiKey = encryptSecret(apiKey);
  }
  if (input.headers !== undefined) {
    if (input.headers === null) delete entry.headers;
    else entry.headers = encryptSecret(JSON.stringify(input.headers));
  }
  if (entry.apiKey || entry.headers) secrets[id] = entry;
  else delete secrets[id];
  writeStore(store);
  writeSecrets(secrets);
  return listProviderSummaries().find((p) => p.id === id)!;
}

/** Delete a custom provider entirely; reset a preset to defaults. */
export function deleteProvider(id: string): { deleted: boolean; reset: boolean } {
  const store = readStore();
  const secrets = readSecrets();
  const customIndex = store.custom.findIndex((c) => c.id === id);
  if (customIndex >= 0) {
    store.custom.splice(customIndex, 1);
    delete store.overrides[id];
    delete store.lastTest[id];
    delete secrets[id];
    if (store.defaultModel?.provider === id) delete store.defaultModel;
    writeStore(store);
    writeSecrets(secrets);
    return { deleted: true, reset: false };
  }
  if (!presetById(id)) return { deleted: false, reset: false };
  delete store.overrides[id];
  delete store.lastTest[id];
  delete secrets[id];
  if (store.defaultModel?.provider === id) delete store.defaultModel;
  writeStore(store);
  writeSecrets(secrets);
  return { deleted: false, reset: true };
}

export function createCustomProvider(input: { name: string; baseURL: string; model: string }): ProviderSummary {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Custom provider needs a name.");
  if (!input.baseURL.trim()) throw new Error("Custom provider needs a base URL.");
  const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "provider"}`;
  const store = readStore();
  if (customById(store, id) || presetById(id)) throw new Error(`A provider named "${name}" already exists.`);
  store.custom.push({
    id,
    kind: "openai-compat",
    displayName: name,
    baseURL: input.baseURL.trim(),
    defaultModel: input.model.trim() || "model",
    sessionHeader: null,
  });
  writeStore(store);
  return listProviderSummaries().find((p) => p.id === id)!;
}

export function recordTestResult(id: string, ok: boolean, message: string): void {
  const store = readStore();
  store.lastTest[id] = { ok, message: message.slice(0, 300), at: new Date().toISOString() };
  writeStore(store);
}

export interface StoredSelection {
  readonly provider: string;
  readonly model: string;
  /**
   * True when the user typed the id rather than picking it from the list.
   * Recorded so a refresh restores "Custom model ID…" instead of treating an
   * uncatalogued id as stale and replacing it.
   */
  readonly custom?: true;
}

export function getDefaultModel(): StoredSelection | null {
  return readStore().defaultModel ?? null;
}

export function setDefaultModel(provider: string, model: string, custom = false): void {
  const store = readStore();
  store.defaultModel = { provider, model: model.slice(0, 120), ...(custom ? { custom: true as const } : {}) };
  writeStore(store);
}

export interface ModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly provider: string;
  readonly providerDisplayName: string;
}

/** Models from ENABLED providers with keys: discovered where possible, else presets. */
export async function listModelOptions(fetcher?: (id: string, eff: EffectiveProvider) => Promise<string[]>): Promise<ModelOption[]> {
  const out: ModelOption[] = [];
  for (const summary of listProviderSummaries()) {
    if (!summary.enabled) continue;
    const eff = resolveProvider(summary.id);
    if (!eff || !eff.apiKey) continue;
    let ids: string[] | null = null;
    if (fetcher) {
      try {
        ids = await fetcher(summary.id, eff);
      } catch {
        ids = null;
      }
    }
    const presetNames = new Map(summary.modelsPreset.map((m) => [m.id, m.displayName]));
    const discovered = ids ?? [];
    // The provider's SAVED default comes first, always. It is the model the
    // user chose and the connection test ran against; leaving it out whenever
    // presets existed is how a connected OpenRouter ended up offering only a
    // hardcoded model the account could not call.
    const saved = summary.defaultModel ? [summary.defaultModel] : [];
    const merged = [...saved, ...discovered, ...summary.modelsPreset.map((m) => m.id)];
    const isOpenCode = summary.id === "opencode-go" || (eff.baseURL ?? "").includes("opencode.ai/zen");
    for (const modelId of [...new Set(merged)]) {
      // An OpenCode model with no documented protocol cannot be routed, so it
      // is not offered: sending it somewhere plausible would be a guess.
      if (isOpenCode && !openCodeModel(modelId)) continue;
      out.push({
        id: modelId,
        // Display name and API id stay separate: a documented name when FORGE
        // has one, otherwise the id itself — never an invented label.
        displayName: presetNames.get(modelId) ?? openCodeModel(modelId)?.displayName ?? modelId,
        provider: summary.id,
        providerDisplayName: summary.displayName,
      });
    }
  }
  return out;
}
