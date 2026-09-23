/**
 * Failure classification (default suite, offline).
 *
 * A billing failure is NOT an authentication failure. Reporting "invalid API
 * key" for an exhausted balance sends the user to re-issue a perfectly good
 * key — observed live against both OpenAI and Google, which return 429 with a
 * billing message.
 */
import { describe, expect, it } from "vitest";

import { classifyFailure, providerDiagnostic } from "../../web/lib/diagnostics";

/** Shaped like an AI SDK APICallError. */
function sdkError(statusCode: number, responseBody: string, message = "API call failed") {
  return Object.assign(new Error(message), { statusCode, responseBody, url: "https://x/v1/chat/completions" });
}

const diag = (error: unknown) =>
  providerDiagnostic(error, { provider: "OpenCode Go", stage: "connection test", model: "kimi-k3" });

describe("failure classification", () => {
  it("names billing exhaustion as billing, not authentication", () => {
    const message = classifyFailure(
      diag(sdkError(429, '{"error":{"message":"You have no credits remaining. Add credits to continue."}}')),
    );
    expect(message).toMatch(/billing/i);
    expect(message).not.toMatch(/invalid.*key|authentication/i);
  });

  it("names Google's prepayment message as billing", () => {
    const message = classifyFailure(
      diag(sdkError(429, '[{"error":{"code":429,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}]')),
    );
    expect(message).toMatch(/billing/i);
  });

  it("names a genuine 401 as authentication", () => {
    const message = classifyFailure(diag(sdkError(401, '{"error":{"message":"Invalid API key."}}')));
    expect(message).toMatch(/authentication/i);
    expect(message).not.toMatch(/billing/i);
  });

  /** Observed live: DeepSeek V4 Flash needs an account opt-in, not a new key. */
  it("names an entitlement refusal as an account setting, not a bad key", () => {
    const message = classifyFailure(
      diag(
        sdkError(
          403,
          '{"error":{"message":"The latest version of this model is only available hosted in China and requires explicit opt in: https://opencode.ai/workspace/x/go"}}',
        ),
      ),
    );
    expect(message).toMatch(/refused this model for your account/i);
    expect(message).toContain("requires explicit opt in");
    expect(message).not.toMatch(/API key was rejected/i);
  });

  it("names a 429 per-minute quota as rate limiting, not billing (the recorded defect)", () => {
    const message = classifyFailure(
      diag(sdkError(429, '{"error":{"message":"Rate limit exceeded: free-models-per-min quota. Retry shortly."}}')),
    );
    expect(message).toMatch(/rate-limit/i);
    expect(message).not.toMatch(/billing/i);
  });

  it("names a plain 429 as rate limiting when nothing mentions money", () => {
    const message = classifyFailure(diag(sdkError(429, '{"error":{"message":"Too many requests."}}')));
    expect(message).toMatch(/rate-limit/i);
  });

  it("names a rejected model as a model problem", () => {
    const message = classifyFailure(diag(sdkError(404, '{"error":{"message":"Model kimi-k3 is not supported"}}')));
    expect(message).toMatch(/kimi-k3/);
  });

  it("extracts the upstream explanation and status from an SDK error", () => {
    const d = diag(sdkError(429, '{"error":{"message":"You have no credits remaining."}}'));
    expect(d.httpStatus).toBe(429);
    expect(d.providerMessage).toBe("You have no credits remaining.");
    expect(d.endpoint).toBe("https://x/v1/chat/completions");
  });

  /** Array-wrapped envelopes (Google) must not hide the message. */
  it("reads an array-wrapped error envelope", () => {
    const d = diag(sdkError(429, '[{"error":{"message":"Your prepayment credits are depleted."}}]'));
    expect(d.providerMessage).toBe("Your prepayment credits are depleted.");
  });
});
