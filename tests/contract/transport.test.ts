/**
 * Transport header contract: gateways may require routing/session metadata.
 *
 * Proves, against a loopback stub (no external network): configured headers
 * are transmitted; a repair reuses the same session; session metadata cannot
 * affect the semantic hash; a plain provider sends no custom headers.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import { extractIntent } from "../../src/intent/extract.js";
import { semanticHash } from "../../src/ir/projection.js";
import type { DraftIR } from "../../src/ir/schema.js";
import { OpenAiCompatProvider } from "../../src/model/openai-compat.js";

interface SeenRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

async function stubGateway(
  replies: readonly string[],
): Promise<{ url: string; seen: SeenRequest[]; close: () => Promise<void> }> {
  const seen: SeenRequest[] = [];
  let n = 0;
  const server: Server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      seen.push({ headers: { ...req.headers }, body });
      const text = replies[Math.min(n, replies.length - 1)]!;
      n += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ model: "stub-gateway", choices: [{ message: { content: text } }] }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("loopback bind failed");
  return {
    url: `http://127.0.0.1:${address.port}`,
    seen,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

/** A gateway that rejects every call with a fixed status and body. */
async function rejectingGateway(
  status: number,
  body: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req: IncomingMessage, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("loopback bind failed");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

const minimalDraft = (): DraftIR => ({
  objective: {
    statement: "Fix the typo",
    kind: "review",
    success_definition: "Typo fixed",
    derived_from: "s1",
  },
  goals: [
    {
      id: "g1",
      statement: "Fix the typo",
      priority: "must",
      acceptance: ["Typo gone"],
      derived_from: "s1",
    },
  ],
  constraints: [],
  non_goals: [],
  scope: { include: ["README.md"], exclude: [], blast_radius: "file", derived_from: "s1" },
  required_capabilities: [],
  assumptions: [],
  open_questions: [],
  verification: [],
  deliverables: [{ id: "d1", kind: "doc", description: "Fixed typo", derived_from: "s1" }],
  risk: { level: "low", factors: [] },
});

const TEXT = "Fix the typo on line 3 of README.md without changing anything else.";

/** A gateway that answers 200 with `finish_reason: "length"`. */
async function truncatingGateway(
  content: string,
  reasoningTokens: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: "kimi-k3",
          choices: [{ message: { content }, finish_reason: "length" }],
          usage: { completion_tokens_details: { reasoning_tokens: reasoningTokens } },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("openai-compatible transport headers", () => {
  it("transmits configured headers and an identifying User-Agent", async () => {
    const gateway = await stubGateway(["hello"]);
    try {
      const provider = new OpenAiCompatProvider("test-key", gateway.url);
      await provider.complete({
        system: "s",
        user: "u",
        maxTokens: 8,
        temperature: 0,
        extraHeaders: { "x-opencode-session": "sess-1" },
      });
      expect(gateway.seen).toHaveLength(1);
      expect(gateway.seen[0]!.headers["x-opencode-session"]).toBe("sess-1");
      expect(gateway.seen[0]!.headers["user-agent"]).toMatch(/^forge\/\d+\.\d+\.\d+/);
    } finally {
      await gateway.close();
    }
  });

  it("sends no custom headers for an ordinary provider invocation", async () => {
    const gateway = await stubGateway(["hello"]);
    try {
      const provider = new OpenAiCompatProvider("test-key", gateway.url);
      await provider.complete({ system: "s", user: "u", maxTokens: 8, temperature: 0 });
      expect(gateway.seen[0]!.headers["x-opencode-session"]).toBeUndefined();
      expect(gateway.seen[0]!.headers["user-agent"]).toMatch(/^forge\//);
    } finally {
      await gateway.close();
    }
  });

  it("a repair attempt reuses the same session", async () => {
    const gateway = await stubGateway(["not json", JSON.stringify(minimalDraft())]);
    try {
      const provider = new OpenAiCompatProvider("test-key", gateway.url);
      const result = await extractIntent(TEXT, {
        provider,
        sessionHeaders: { "x-opencode-session": "sess-repair" },
      });
      expect(result.repairs).toBe(1);
      expect(gateway.seen).toHaveLength(2);
      expect(gateway.seen[0]!.headers["x-opencode-session"]).toBe("sess-repair");
      expect(gateway.seen[1]!.headers["x-opencode-session"]).toBe("sess-repair");
    } finally {
      await gateway.close();
    }
  });

  /**
   * A rejected call must carry machine-readable transport facts, not just a
   * prose message. The web layer renders these as an actionable diagnostic
   * ("HTTP status", "Provider message"); string-scraping a message is not a
   * contract and silently degrades to "Request failed".
   */
  it("carries structured transport detail when the gateway rejects the call", async () => {
    const gateway = await rejectingGateway(
      401,
      JSON.stringify({ type: "error", error: { type: "AuthError", message: "Invalid API key." } }),
    );
    try {
      const provider = new OpenAiCompatProvider("bad-key", gateway.url, "kimi-k3");
      await expect(
        provider.complete({ system: "s", user: "u", maxTokens: 8, temperature: 0 }),
      ).rejects.toMatchObject({
        name: "ProviderError",
        provider: "openai-compat",
        detail: {
          httpStatus: 401,
          providerMessage: "Invalid API key.",
          endpoint: `${gateway.url}/chat/completions`,
          model: "kimi-k3",
        },
      });
    } finally {
      await gateway.close();
    }
  });

  /**
   * "OpenAI-compatible" endpoints do not agree on an error shape. Reading only
   * `{error:{message}}` reported a bare "request rejected" for the others and
   * discarded the upstream's actual explanation.
   */
  it.each([
    ['{"error":{"message":"Quota exceeded for this model."}}', "Quota exceeded for this model."],
    ['{"error":"flat string rejection"}', "flat string rejection"],
    ['{"message":"top-level message"}', "top-level message"],
    ['{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"nested google shape"}}', "nested google shape"],
    ['{"error":[{"message":"first of many"}]}', "first of many"],
    ['{"detail":"fastapi style detail"}', "fastapi style detail"],
    // Google's OpenAI-compatible endpoint wraps the envelope in an array.
    ['[{"error":{"code":429,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}]', "Your prepayment credits are depleted."],
    // No recognised field: show the body rather than discarding it.
    ['{"code":429,"status":"RESOURCE_EXHAUSTED"}', '{"code":429,"status":"RESOURCE_EXHAUSTED"}'],
    ["", "(the endpoint returned an empty body)"],
  ])("extracts the upstream explanation from %s", async (body, expected) => {
    const gateway = await rejectingGateway(429, body);
    try {
      const provider = new OpenAiCompatProvider("k", gateway.url, "m");
      await expect(
        provider.complete({ system: "s", user: "u", maxTokens: 8, temperature: 0 }),
      ).rejects.toMatchObject({ detail: { httpStatus: 429, providerMessage: expected } });
    } finally {
      await gateway.close();
    }
  });

  /** A non-JSON error page (proxy/CDN HTML) must still yield status + endpoint. */
  it("carries transport detail when the rejection body is not JSON", async () => {
    const gateway = await rejectingGateway(502, "<html>Bad Gateway</html>");
    try {
      const provider = new OpenAiCompatProvider("k", gateway.url, "kimi-k3");
      await expect(
        provider.complete({ system: "s", user: "u", maxTokens: 8, temperature: 0 }),
      ).rejects.toMatchObject({
        name: "ProviderError",
        detail: { httpStatus: 502, endpoint: `${gateway.url}/chat/completions`, model: "kimi-k3" },
      });
    } finally {
      await gateway.close();
    }
  });

  /**
   * A reasoning model bills thinking against `max_tokens`, so a budget sized
   * for the answer produces a truncated — or empty — body with
   * `finish_reason: "length"`. Reporting that as "no message content" sent a
   * reader looking for a broken key; it is a budget, and the diagnostic says so
   * (INV-012). Found against Kimi K3 during V2-D's live smoke.
   */
  it.each([
    ["a truncated body", '{"objective":{"statement":"half an ans'],
    ["an empty body", ""],
  ])("names the token budget when the response was cut off — %s", async (_label, content) => {
    const gateway = await truncatingGateway(content, 3287);
    try {
      const provider = new OpenAiCompatProvider("k", gateway.url, "kimi-k3");
      await expect(
        provider.complete({ system: "s", user: "u", maxTokens: 4000, temperature: 0 }),
      ).rejects.toMatchObject({
        name: "ProviderError",
        message: expect.stringContaining("4000-token output budget"),
        detail: { model: "kimi-k3", httpStatus: 200 },
      });
      await expect(
        provider.complete({ system: "s", user: "u", maxTokens: 4000, temperature: 0 }),
      ).rejects.toMatchObject({ message: expect.stringContaining("3287 of them were reasoning tokens") });
    } finally {
      await gateway.close();
    }
  });

  it("session metadata cannot affect the TaskIR semantic hash", async () => {
    const gateway = await stubGateway([JSON.stringify(minimalDraft()), JSON.stringify(minimalDraft())]);
    try {
      const provider = new OpenAiCompatProvider("test-key", gateway.url);
      const withSession = await extractIntent(TEXT, {
        provider,
        sessionHeaders: { "x-opencode-session": "sess-a" },
      });
      const withoutSession = await extractIntent(TEXT, { provider });
      expect(semanticHash(withSession.ir)).toBe(semanticHash(withoutSession.ir));
      expect(withSession.record.promptHash).toBe(withoutSession.record.promptHash);
    } finally {
      await gateway.close();
    }
  });
});
