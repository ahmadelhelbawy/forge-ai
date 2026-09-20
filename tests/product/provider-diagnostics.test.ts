/**
 * Provider failure diagnostics (default suite, offline).
 *
 * Two defects are covered here, both observed from the browser:
 *
 *  1. A failing connection test rendered as "Request failed (502)." because
 *     the typed client only read `body.error`, while the route replied with
 *     `body.message`. The real, already-correct explanation was discarded.
 *  2. A failure told the user nothing actionable — no endpoint, no HTTP
 *     status, no upstream message.
 *
 * Credentials must never appear in a diagnostic, including through a base URL
 * that carries them in a query string.
 */
import { describe, expect, it } from "vitest";

import { errorTextFromBody } from "../../web/lib/api";
import { formatDiagnostic, providerDiagnostic } from "../../web/lib/diagnostics";

describe("error text extraction from an API response body", () => {
  it("prefers an explicit error field", () => {
    expect(errorTextFromBody({ error: "Unknown provider." }, 404)).toBe("Unknown provider.");
  });

  /** The regression: routes that reply with `message` must not be swallowed. */
  it("falls back to a message field rather than the bare status", () => {
    expect(errorTextFromBody({ ok: false, message: "Authentication failed — invalid API key." }, 502)).toBe(
      "Authentication failed — invalid API key.",
    );
  });

  it("prefers the fuller diagnostic when the route supplies one", () => {
    const body = {
      ok: false,
      message: "Authentication failed — invalid API key.",
      diagnostic: "Provider: OpenCode Go\nHTTP status: 401",
    };
    expect(errorTextFromBody(body, 502)).toBe("Provider: OpenCode Go\nHTTP status: 401");
  });

  it("states the status only when the body explains nothing", () => {
    expect(errorTextFromBody({}, 502)).toBe("Request failed (502).");
    expect(errorTextFromBody(null, 500)).toBe("Request failed (500).");
  });

  it("ignores non-string error and message fields", () => {
    expect(errorTextFromBody({ error: { nested: true }, message: 42 }, 400)).toBe("Request failed (400).");
  });
});

describe("provider diagnostics", () => {
  const providerError = (detail: Record<string, unknown>, message = "[openai-compat] HTTP 401: Invalid API key.") =>
    Object.assign(new Error(message), { name: "ProviderError", detail });

  it("reports provider, stage, endpoint, model, status and upstream message", () => {
    const diagnostic = providerDiagnostic(
      providerError({
        endpoint: "https://opencode.ai/zen/go/v1/chat/completions",
        httpStatus: 401,
        providerMessage: "Invalid API key.",
        model: "kimi-k3",
      }),
      { provider: "OpenCode Go", stage: "connection test", model: "kimi-k3" },
    );
    expect(diagnostic).toMatchObject({
      provider: "OpenCode Go",
      stage: "connection test",
      endpoint: "https://opencode.ai/zen/go/v1/chat/completions",
      model: "kimi-k3",
      httpStatus: 401,
      providerMessage: "Invalid API key.",
    });
    const text = formatDiagnostic(diagnostic);
    expect(text).toContain("Provider: OpenCode Go");
    expect(text).toContain("Stage: connection test");
    expect(text).toContain("Endpoint: https://opencode.ai/zen/go/v1/chat/completions");
    expect(text).toContain("Model (API id): kimi-k3");
    expect(text).toContain("HTTP status: 401");
    expect(text).toContain("Provider message: Invalid API key.");
  });

  /** A credential in the base URL must never reach the browser or a log. */
  it("strips query strings from the endpoint so a key in the URL cannot leak", () => {
    const diagnostic = providerDiagnostic(
      providerError({ endpoint: "https://gw.example/v1/chat/completions?api_key=sk-secret-value" }),
      { provider: "Custom", stage: "connection test", model: "m" },
    );
    expect(diagnostic.endpoint).toBe("https://gw.example/v1/chat/completions");
    expect(formatDiagnostic(diagnostic)).not.toContain("sk-secret-value");
  });

  /** A non-provider error still yields a usable block rather than nothing. */
  it("degrades to provider, stage and message for a plain error", () => {
    const diagnostic = providerDiagnostic(new Error("boom"), {
      provider: "OpenCode Go",
      stage: "chat",
      model: "kimi-k3",
    });
    expect(diagnostic.httpStatus).toBeUndefined();
    const text = formatDiagnostic(diagnostic);
    expect(text).toContain("Provider: OpenCode Go");
    expect(text).toContain("Stage: chat");
    expect(text).toContain("boom");
  });

  it("omits lines it has no fact for", () => {
    const text = formatDiagnostic(
      providerDiagnostic(new Error("boom"), { provider: "P", stage: "chat", model: "m" }),
    );
    expect(text).not.toContain("HTTP status:");
    expect(text).not.toContain("Endpoint:");
  });
});
