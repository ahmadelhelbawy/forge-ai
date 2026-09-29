/**
 * Pre-release audit (2026-09-29): provider secrets and credential routing.
 *
 * Each case is a defect the audit reproduced before it was fixed:
 * - a stored key followed a base-URL change to any host (exfiltration);
 * - FORGE_API_KEY was offered to — and sent to — three different vendors;
 * - secrets were encrypted under a key published in the source;
 * - a provider that echoed the rejected key had it shown and logged;
 * - the SDK's hidden retries tripled a failing call and hid its status.
 *
 * Offline: the only sockets are to a server this file starts on 127.0.0.1.
 */
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generate, generateStream } from "../../web/lib/ai-provider";
import { classifyFailure, providerDiagnostic, redactCredentials } from "../../web/lib/diagnostics";
import { resolveCall } from "../../web/lib/forge";
import { checkBaseURL, ProviderInputError, resolveProvider, saveProvider } from "../../web/lib/providers";

const ENV = [
  "FORGE_DATA_DIR",
  "FORGE_APP_SECRET",
  "FORGE_PROVIDER",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "FORGE_API_KEY",
  "FORGE_BASE_URL",
  "FORGE_MODEL",
  "OPENROUTER_API_KEY",
];
const saved: Record<string, string | undefined> = {};

let dataDir = "";
beforeEach(() => {
  for (const name of ENV) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  dataDir = join(mkdtempSync(join(tmpdir(), "forge-audit-")), "data");
  process.env["FORGE_DATA_DIR"] = dataDir;
});

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("a stored key only goes to the endpoint it was saved with", () => {
  beforeEach(() => {
    process.env["FORGE_APP_SECRET"] = "audit-secret-0123456789";
  });

  it("refuses a base-URL change that would carry the stored key along", () => {
    saveProvider("openai", { apiKey: "sk-stored-0123456789abcdef" });
    expect(() => saveProvider("openai", { baseURL: "http://attacker.example/v1" })).toThrow(ProviderInputError);
    expect(resolveProvider("openai")!.baseURL).toBe("https://api.openai.com/v1");
  });

  it("accepts the change when the key is entered again, and a no-op resave", () => {
    saveProvider("openai", { apiKey: "sk-stored-0123456789abcdef" });
    saveProvider("openai", { baseURL: "https://api.openai.com/v1" });
    saveProvider("openai", { baseURL: "https://gateway.example/v1", apiKey: "sk-new-0123456789abcdef" });
    const eff = resolveProvider("openai")!;
    expect(eff.baseURL).toBe("https://gateway.example/v1");
    expect(eff.apiKey).toBe("sk-new-0123456789abcdef");
  });

  it("refuses the same move for a key that came from the environment", () => {
    process.env["OPENAI_API_KEY"] = "sk-env-0123456789abcdef";
    expect(() => saveProvider("openai", { baseURL: "http://attacker.example/v1" })).toThrow(ProviderInputError);
  });

  it("accepts only absolute http(s) base URLs without embedded credentials", () => {
    expect(checkBaseURL("https://api.example.com/v1")).toBe("https://api.example.com/v1");
    expect(checkBaseURL("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "gopher://x", "api.example.com", "https://u:p@host/v1"]) {
      expect(() => checkBaseURL(bad), bad).toThrow(ProviderInputError);
    }
  });

  it("does not send stored headers to a base URL typed only for a test", () => {
    saveProvider("openai", { apiKey: "sk-stored-0123456789abcdef", headers: { "x-org-token": "secret-header" } });
    expect(resolveCall("openai", "gpt-x").configuredHeaders).toEqual({ "x-org-token": "secret-header" });
    const probe = resolveCall("openai", "gpt-x", { apiKey: "sk-typed-0123456789", baseURL: "https://other.example/v1" });
    expect(probe.configuredHeaders).toEqual({});
  });
});

describe("the generic legacy key belongs to exactly one vendor", () => {
  it("FORGE_API_KEY with an OpenCode base URL reaches OpenCode Go only", () => {
    process.env["FORGE_API_KEY"] = "oc-key-0123456789abcdef";
    process.env["FORGE_BASE_URL"] = "https://opencode.ai/zen/go/v1";
    expect(resolveProvider("opencode-go")!.apiKey).toBe("oc-key-0123456789abcdef");
    expect(resolveProvider("anthropic")!.apiKey).toBe("");
    expect(resolveProvider("openai")!.apiKey).toBe("");
  });

  it("FORGE_API_KEY with FORGE_PROVIDER=anthropic reaches Anthropic only", () => {
    process.env["FORGE_API_KEY"] = "sk-ant-0123456789abcdef";
    process.env["FORGE_PROVIDER"] = "anthropic";
    expect(resolveProvider("anthropic")!.apiKey).toBe("sk-ant-0123456789abcdef");
    expect(resolveProvider("openai")!.apiKey).toBe("");
    expect(resolveProvider("opencode-go")!.apiKey).toBe("");
  });

  it("OPENAI_API_KEY reaches OpenCode Go only when OPENAI_BASE_URL is OpenCode", () => {
    process.env["OPENAI_API_KEY"] = "sk-openai-0123456789abcdef";
    expect(resolveProvider("opencode-go")!.apiKey).toBe("");
    process.env["OPENAI_BASE_URL"] = "https://opencode.ai/zen/go/v1";
    expect(resolveProvider("opencode-go")!.apiKey).toBe("sk-openai-0123456789abcdef");
  });
});

describe("provider secrets at rest", () => {
  it("without FORGE_APP_SECRET, uses a random per-install key, owner-only", () => {
    saveProvider("openai", { apiKey: "sk-at-rest-0123456789abcdef" });
    const keyFile = join(dataDir, "app.secret");
    expect(readFileSync(keyFile, "utf8")).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
      expect(statSync(join(dataDir, "providers.secrets")).mode & 0o777).toBe(0o600);
    }
    expect(resolveProvider("openai")!.apiKey).toBe("sk-at-rest-0123456789abcdef");
  });

  it("re-encrypts a secrets file written under the old published key", () => {
    const legacyKey = scryptSync("forge-dev-secret--change-me", "forge-provider-v1", 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const data = Buffer.concat([cipher.update("sk-legacy-0123456789abcdef", "utf8"), cipher.final()]);
    const blob = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "providers.secrets"), JSON.stringify({ openai: { apiKey: blob } }));

    expect(resolveProvider("openai")!.apiKey).toBe("sk-legacy-0123456789abcdef");
    const rewritten = JSON.parse(readFileSync(join(dataDir, "providers.secrets"), "utf8"));
    expect(rewritten.openai.apiKey.data).not.toBe(blob.data);
  });

  it("refuses a FORGE_APP_SECRET too short to be a key", () => {
    process.env["FORGE_APP_SECRET"] = "short";
    expect(() => saveProvider("openai", { apiKey: "sk-x-0123456789abcdef" })).toThrow(/at least 16/);
  });
});

describe("provider text shown to the user carries no credential", () => {
  it("redacts echoed keys, bearer tokens and URL credentials, keeps model ids", () => {
    expect(redactCredentials("Incorrect API key provided: sk-proj-abcdefghijklmnop1234.")).not.toContain("abcdefghijklmnop");
    expect(redactCredentials("Bearer abcdefghijklmnopqrstuvwx")).toBe("Bearer [redacted]");
    expect(redactCredentials("https://user:pw@host/v1")).toBe("https://[redacted]@host/v1");
    expect(redactCredentials("model claude-sonnet-4-5-20250929 not found")).toBe("model claude-sonnet-4-5-20250929 not found");
  });

  it("applies it to the diagnostic built from an SDK error", () => {
    const d = providerDiagnostic(
      Object.assign(new Error("Unauthorized"), {
        statusCode: 401,
        responseBody: JSON.stringify({ error: { message: "Invalid key sk-live-0123456789abcdefgh" } }),
      }),
      { provider: "OpenAI", stage: "generation" },
    );
    expect(JSON.stringify(d)).not.toContain("0123456789abcdefgh");
  });

  it("reads the HTTP status through a retry wrapper", () => {
    const wrapped = Object.assign(new Error("Failed after 3 attempts"), {
      lastError: Object.assign(new Error("Rate limit"), { statusCode: 429, responseBody: '{"error":{"message":"slow down"}}' }),
    });
    const d = providerDiagnostic(wrapped, { provider: "OpenAI", stage: "generation" });
    expect(d.httpStatus).toBe(429);
    expect(classifyFailure(d)).toMatch(/rate-limiting/);
  });
});

describe("no hidden retries (MB-R3)", () => {
  let server: Server;
  let hits = 0;
  let base = "";
  beforeEach(async () => {
    hits = 0;
    server = createServer((req, res) => {
      hits += 1;
      req.resume();
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit reached" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const spec = () => ({
    providerId: "openai",
    kind: "openai-compat" as const,
    apiKey: "sk-test",
    baseURL: base,
    modelId: "m",
    protocol: "chat-completions" as const,
    headers: {},
  });

  it("a 429 is one request, and its status reaches the diagnostic", async () => {
    const error = await generate(spec(), { system: "s", prompt: "p", maxTokens: 16, temperature: 0 }).catch((e: unknown) => e);
    expect(hits).toBe(1);
    expect(providerDiagnostic(error, { provider: "OpenAI", stage: "generation" }).httpStatus).toBe(429);
  });

  it("the streamed path makes one request too", async () => {
    await generateStream(spec(), { system: "s", prompt: "p", maxTokens: 16, temperature: 0, onChunk: () => undefined }).catch(() => undefined);
    expect(hits).toBe(1);
  });
});
