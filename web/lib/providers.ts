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
    envKeys: ["ANTHROPIC_API_KEY"],
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
    envKeys: ["OPENAI_API_KEY"],
    envBaseURLs: ["OPENAI_BASE_URL"],
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
    envKeys: [],
    envBaseURLs: [],
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

/**
 * The key that encrypted secrets before 0.1.0. It is published in this source,
 * so it protects nothing: it is only ever used to READ an old secrets file,
 * which is then re-encrypted under the real key (see `readSecrets`).
 */
const LEGACY_PUBLIC_SECRET = "forge-dev-secret--change-me";

function appSecretPath(): string {
  return join(dataDir(), "app.secret");
}

/**
 * FORGE_APP_SECRET when set; otherwise a random per-install key kept beside
 * the store with owner-only permissions. A short FORGE_APP_SECRET is refused,
 * never silently weakened (INV-012).
 */
function appSecret(): string {
  const configured = process.env["FORGE_APP_SECRET"];
  if (configured !== undefined && configured.length > 0) {
    if (configured.length < 16) throw new Error("FORGE_APP_SECRET must be at least 16 characters.");
    return configured;
  }
  const path = appSecretPath();
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    // Another request created it first; use theirs.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readFileSync(path, "utf8").trim();
}

function keyFrom(secret: string): Buffer {
  return scryptSync(secret, "forge-provider-v1", 32);
}

type SecretBlob = { iv: string; tag: string; data: string };

function encryptSecret(plain: string): SecretBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(appSecret()), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function decryptWith(secret: string, blob: SecretBlob): string {
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]).toString("utf8");
}

function decryptSecret(blob: SecretBlob): string {
  try {
    return decryptWith(appSecret(), blob);
  } catch (error) {
    if ((error as Error).message.startsWith("FORGE_APP_SECRET")) throw error;
    throw new Error("Provider secrets cannot be decrypted — FORGE_APP_SECRET changed or is wrong.");
  }
}

/** Re-encrypt blobs written under the published pre-0.1.0 key. Returns true if any changed. */
function migrateLegacySecrets(secrets: SecretsFile): boolean {
  const current = appSecret();
  let changed = false;
  for (const entry of Object.values(secrets)) {
    for (const field of ["apiKey", "headers"] as const) {
      const blob = entry[field];
      if (!blob) continue;
      try {
        decryptWith(current, blob);
        continue;
      } catch {
        // not under the current key — maybe the legacy one
      }
      try {
        entry[field] = encryptSecret(decryptWith(LEGACY_PUBLIC_SECRET, blob));
        changed = true;
      } catch {
        // Neither key opens it: leave it for decryptSecret to report loudly.
      }
    }
  }
  return changed;
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
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

const migratedSecrets = new Set<string>();

function readSecrets(): SecretsFile {
  let secrets: SecretsFile;
  try {
    secrets = JSON.parse(readFileSync(secretsPath(), "utf8")) as SecretsFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const path = secretsPath();
  if (!migratedSecrets.has(path)) {
    if (migrateLegacySecrets(secrets)) writeSecrets(secrets);
    migratedSecrets.add(path);
  }
  return secrets;
}

function writeSecrets(secrets: SecretsFile): void {
  const path = secretsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  // Owner-only from the first byte: a chmod after the rename left a window.
  writeFileSync(tmp, JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort (non-POSIX filesystems); the file was created 0600 above.
  }
}

/** Masked for the browser: prefix plus last four, never the middle. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  const prefix = key.slice(0, 3);
  return `${prefix}••••••••${key.slice(-4)}`;
}

function isOpenCodeHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "opencode.ai" || host.endsWith(".opencode.ai");
  } catch {
    return false;
  }
}

/**
 * The environment names that belong to one preset. The generic legacy names
 * (FORGE_API_KEY / FORGE_BASE_URL) belong to exactly ONE preset — the one
 * FORGE_PROVIDER or FORGE_BASE_URL names — so a key issued by one vendor is
 * never offered to (and sent to) another. OPENAI_* reaches OpenCode Go only
 * when OPENAI_BASE_URL points at OpenCode.
 */
function envNames(preset: ProviderPreset): { keys: string[]; baseURLs: string[] } {
  const keys = [...preset.envKeys];
  const baseURLs = [...preset.envBaseURLs];
  const legacyOwner =
    process.env["FORGE_PROVIDER"] === "anthropic"
      ? "anthropic"
      : isOpenCodeHost(process.env["FORGE_BASE_URL"])
        ? "opencode-go"
        : "openai";
  if (preset.id === legacyOwner) {
    keys.push("FORGE_API_KEY");
    if (legacyOwner !== "anthropic") baseURLs.push("FORGE_BASE_URL");
  }
  if (preset.id === "opencode-go" && isOpenCodeHost(process.env["OPENAI_BASE_URL"])) {
    keys.push("OPENAI_API_KEY");
    baseURLs.push("OPENAI_BASE_URL");
  }
  return { keys, baseURLs };
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
    (preset ? firstEnv(envNames(preset).keys) : "")
  ).trim();
  const headers: Record<string, string> = {};
  if (storedSecrets?.headers) {
    const plain = decryptSecret(storedSecrets.headers);
    try {
      Object.assign(headers, JSON.parse(plain) as Record<string, string>);
    } catch {
      // Sending the request without them would fail as a confusing auth error.
      throw new Error(`Stored headers for provider "${id}" are corrupt — re-enter them in Settings.`);
    }
  }
  const envModel = process.env["FORGE_MODEL"] ?? "";
  const baseURL =
    override?.baseURL ?? custom?.baseURL ?? (preset ? firstEnv(envNames(preset).baseURLs) || preset.defaultBaseURL : null);
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

/** A settings change the user must correct; routes answer it with HTTP 400. */
export class ProviderInputError extends Error {}

/** An endpoint FORGE may send a key to: an absolute http(s) URL, nothing else. */
export function checkBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderInputError("Base URL must be an absolute URL, e.g. https://api.example.com/v1.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProviderInputError("Base URL must start with https:// (or http:// for a local server).");
  }
  if (url.username || url.password) throw new ProviderInputError("Put credentials in the API key field, not in the URL.");
  return value;
}

/**
 * Save a settings override. An empty/absent apiKey keeps the stored key —
 * but only for the endpoint it was saved with: moving a key to a different
 * endpoint requires supplying it again, so no request can redirect a stored
 * (or environment) key to a host of its choosing.
 */
export function saveProvider(id: string, input: SaveInput): ProviderSummary {
  const before = resolveProvider(id);
  const store = readStore();
  const secrets = readSecrets();
  const existing = store.overrides[id] ?? {};
  if (typeof input.baseURL === "string" && input.baseURL.trim()) checkBaseURL(input.baseURL.trim());
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
  if (before && before.apiKey && apiKey.length === 0) {
    const preset = presetById(id);
    const custom = customById(store, id);
    const after = next.baseURL ?? custom?.baseURL ?? (preset ? firstEnv(envNames(preset).baseURLs) || preset.defaultBaseURL : null);
    if ((after ?? "") !== (before.baseURL ?? "")) {
      throw new ProviderInputError("Enter the API key again to use it with a different base URL.");
    }
  }
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
  checkBaseURL(input.baseURL.trim());
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
