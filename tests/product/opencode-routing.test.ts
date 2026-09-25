/**
 * OpenCode Go routing contract (default suite, offline).
 *
 * Three defects are locked out here:
 *
 *  1. A display name ("DeepSeek V4 Flash") reaching the API as a model id.
 *  2. Every model routed to /chat/completions, when OpenCode Go serves three
 *     protocols on three paths.
 *  3. A per-call random session id, when the docs require a STABLE one per
 *     conversation for routing and prompt caching.
 *
 * Protocol data is from https://dev.opencode.ai/docs/go/ — `GET /v1/models`
 * returns ids only, so it cannot be discovered at runtime.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { endpointFor } from "../../web/lib/ai-provider";
import { resolveCall, transportFor, UnsupportedModelError } from "../../web/lib/forge";
import { describeDiscovered, openCodeModel, openCodeModels } from "../../web/lib/opencode-models";
import { saveProvider } from "../../web/lib/providers";

const SAVED = { dir: process.env["FORGE_DATA_DIR"], secret: process.env["FORGE_APP_SECRET"] };

beforeEach(() => {
  process.env["FORGE_DATA_DIR"] = mkdtempSync(join(tmpdir(), "forge-routing-"));
  process.env["FORGE_APP_SECRET"] = "test-secret-at-least-16-chars";
  saveProvider("opencode-go", { apiKey: "test-key", enabled: true });
});

afterEach(() => {
  if (SAVED.dir === undefined) delete process.env["FORGE_DATA_DIR"];
  else process.env["FORGE_DATA_DIR"] = SAVED.dir;
  if (SAVED.secret === undefined) delete process.env["FORGE_APP_SECRET"];
  else process.env["FORGE_APP_SECRET"] = SAVED.secret;
});

describe("model identity", () => {
  it("never uses a display name as an API id", () => {
    for (const model of openCodeModels()) {
      expect(model.id).toBe(model.id.toLowerCase());
      expect(model.id).not.toContain(" ");
    }
  });

  it("resolves the documented id and keeps the display name for the UI only", () => {
    const call = resolveCall("opencode-go", "deepseek-v4-flash");
    expect(call.modelId).toBe("deepseek-v4-flash");
    expect(call.displayModel).toBe("DeepSeek V4 Flash");
    expect(transportFor(call, "s").modelId).toBe("deepseek-v4-flash");
  });

  /** The exact bug: a label pasted into the model field must not be routed. */
  it("refuses a display name supplied where an id belongs", () => {
    expect(() => resolveCall("opencode-go", "DeepSeek V4 Flash")).toThrow(UnsupportedModelError);
  });
});

describe("protocol routing", () => {
  it.each([
    ["kimi-k3", "chat-completions", "https://opencode.ai/zen/go/v1/chat/completions"],
    ["deepseek-v4-flash", "chat-completions", "https://opencode.ai/zen/go/v1/chat/completions"],
    ["gpt-5.6-luna", "responses", "https://opencode.ai/zen/go/v1/responses"],
    ["qwen3.8-flash", "anthropic-messages", "https://opencode.ai/zen/go/v1/messages"],
    ["minimax-m3", "anthropic-messages", "https://opencode.ai/zen/go/v1/messages"],
  ])("routes %s over %s to the documented path", (modelId, protocol, endpoint) => {
    const call = resolveCall("opencode-go", modelId);
    expect(call.protocol).toBe(protocol);
    expect(endpointFor(transportFor(call, "s"))).toBe(endpoint);
  });

  it("does not send every model to chat/completions", () => {
    const paths = new Set(
      openCodeModels().map((m) => endpointFor(transportFor(resolveCall("opencode-go", m.id), "s"))),
    );
    expect(paths.size).toBe(3);
  });

  /** Guessing a protocol produces a misleading 4xx; refusing is honest. */
  it("refuses an undocumented model rather than guessing its protocol", () => {
    expect(openCodeModel("omen-alpha")).toBeNull();
    expect(() => resolveCall("opencode-go", "omen-alpha")).toThrow(UnsupportedModelError);
  });

  it("marks undiscoverable protocols as unsupported instead of defaulting them", () => {
    const described = describeDiscovered(["kimi-k3", "omen-alpha"]);
    expect(described).toContainEqual({
      id: "kimi-k3",
      displayName: "Kimi K3",
      protocol: "chat-completions",
    });
    expect(described).toContainEqual({ id: "omen-alpha", displayName: "omen-alpha", protocol: null });
  });
});

describe("session header", () => {
  it("sends the conversation id as a stable session, not a fresh uuid", () => {
    const call = resolveCall("opencode-go", "kimi-k3");
    const first = transportFor(call, "conversation-abc").headers["x-opencode-session"];
    const second = transportFor(call, "conversation-abc").headers["x-opencode-session"];
    expect(first).toBe("conversation-abc");
    expect(second).toBe(first);
  });

  it("gives a different conversation a different session", () => {
    const call = resolveCall("opencode-go", "kimi-k3");
    expect(transportFor(call, "convo-1").headers["x-opencode-session"]).not.toBe(
      transportFor(call, "convo-2").headers["x-opencode-session"],
    );
  });

  it("identifies FORGE by User-Agent", () => {
    const headers = transportFor(resolveCall("opencode-go", "kimi-k3"), "s").headers;
    expect(headers["user-agent"]).toMatch(/^forge\//);
  });
});

describe("unsaved form values", () => {
  it("uses an unsaved key and base URL over the stored ones", () => {
    const call = resolveCall("opencode-go", "kimi-k3", {
      apiKey: "typed-but-unsaved",
      baseURL: "https://opencode.ai/zen/go/v1",
    });
    expect(call.apiKey).toBe("typed-but-unsaved");
  });

  it("trims a pasted key before it reaches the wire", () => {
    expect(resolveCall("opencode-go", "kimi-k3", { apiKey: "  spaced-key\n" }).apiKey).toBe("spaced-key");
  });

  it("falls back to the stored key when nothing was typed", () => {
    expect(resolveCall("opencode-go", "kimi-k3", {}).apiKey).toBe("test-key");
  });
});

/**
 * Defect 4, found by the V2-E live acceptance run (2026-09-20).
 *
 * The routing above is only worth what its CALL SITES are worth. The turn
 * pipeline and the connection test both go through `resolveCall` +
 * `transportFor`, so they honour each model's documented protocol. Candidate
 * generation did not: it went through `getEffectiveProvider`, which picks a
 * transport from the PROVIDER's kind alone. OpenCode Go's kind is
 * `openai-compat`, so every candidate call landed on `/chat/completions` —
 * correct for the 17 chat-completions models, wrong for the 8
 * anthropic-messages and 4 responses models.
 *
 * It survived five live runs because every one of them used `kimi-k3`, which
 * IS chat-completions. `qwen3.8-flash` is anthropic-messages, and the gateway
 * answered the wrong path with `HTTP 503` and an empty body — three failed
 * archetypes, zero candidates, and a connection test that passed the whole
 * time. A connection test passing is not the feature working.
 */
describe("every path that calls a model honours the model's protocol", () => {
  const anthropicModel = "qwen3.8-flash";
  const chatModel = "kimi-k3";

  it("the fixture models still have the protocols this test depends on", () => {
    expect(openCodeModel(anthropicModel)?.protocol).toBe("anthropic-messages");
    expect(openCodeModel(chatModel)?.protocol).toBe("chat-completions");
  });

  it("candidate generation routes an anthropic-messages model to /messages, not /chat/completions", async () => {
    const { generateCandidates } = await import("../../web/lib/candidates");
    const { irForVersion } = await import("../../web/lib/preservation");
    const { addPromptVersion, newConversation, saveConversation } = await import("../../web/lib/store");

    const convo = newConversation({ title: "routing", target: "generic" });
    addPromptVersion(convo, "Build an agent.\n\nIt must use PostgreSQL.\n\nIt must never log credentials.", "model", {
      action: "CREATE",
      turnId: "t1",
    });
    saveConversation(convo);
    convo.provider = "opencode-go";
    convo.model = anthropicModel;

    // The prerequisite extraction is cached offline first, so the only calls
    // this test observes are the candidate calls themselves.
    process.env["FORGE_CHAT_STUB"] = "1";
    await irForVersion(convo, convo.currentV);

    const body = JSON.stringify({
      reply: "alt",
      prompt: "Build an agent.\n\nIt must use PostgreSQL.\n\nIt must never log credentials.\n\nAlternative body.",
    });
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    // A well-formed anthropic-messages reply, so the only thing that can fail
    // this test is the candidate calls choosing the wrong PATH.
    globalThis.fetch = (async (input: unknown) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: anthropicModel,
          content: [{ type: "text", text: body }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const stub = process.env["FORGE_CHAT_STUB"];
    delete process.env["FORGE_CHAT_STUB"];
    let thrown: unknown = null;
    try {
      await generateCandidates(convo, { count: 2, provider: "opencode-go", model: anthropicModel });
    } catch (error) {
      thrown = error;
    } finally {
      globalThis.fetch = realFetch;
      if (stub === undefined) delete process.env["FORGE_CHAT_STUB"];
      else process.env["FORGE_CHAT_STUB"] = stub;
    }

    expect(thrown).toBeNull();
    // Two alternatives were asked for, so two candidate calls must have gone
    // to the documented anthropic-messages path, and none to chat/completions.
    expect(urls.length).toBe(2);
    expect(urls.filter((u) => u.includes("/chat/completions"))).toEqual([]);
    expect(urls.every((u) => u.includes("/messages"))).toBe(true);
  });
});

/**
 * V2-R step 11: `irForVersion` is the last path that picked its transport from
 * the PROVIDER's kind instead of the MODEL's protocol.
 *
 * The defect was measured on a live run: `intent.extract` sent an OpenCode Go
 * `anthropic-messages` model to `/chat/completions` and got `HTTP 503` with an
 * empty body — three attempts, 183 seconds, no usable error. Counted rather
 * than estimated, it made **12 of the 29 documented OpenCode Go models**
 * unreachable through this path: the 8 that speak `anthropic-messages` and the
 * 4 that speak `responses`. The 17 `chat-completions` models worked by
 * coincidence.
 *
 * V2-E fixed it for candidates and recorded that it could not fix it here,
 * because `extractIntent` needs a core `ModelProvider` and core's
 * `AnthropicProvider` accepted no base URL — so no core transport could reach
 * that gateway path at all. V2-R's plan authorises the core change.
 */
describe("irForVersion honours the model's protocol (V2-R step 11)", () => {
  const anthropicModel = "qwen3.8-flash";
  const responsesModel = openCodeModels().find((m) => m.protocol === "responses")?.id;

  it("routes an anthropic-messages model to /messages, not /chat/completions", async () => {
    const { irForVersion } = await import("../../web/lib/preservation");
    const { addPromptVersion, newConversation, saveConversation } = await import("../../web/lib/store");

    const convo = newConversation({ title: "extract-routing", target: "generic" });
    addPromptVersion(convo, "Build an agent. It must use PostgreSQL.", "model", {
      action: "CREATE",
      turnId: "t1",
    });
    saveConversation(convo);
    convo.provider = "opencode-go";
    convo.model = anthropicModel;

    const draft = {
      objective: {
        statement: "Build an agent",
        kind: "feature",
        success_definition: "The agent runs",
        derived_from: "s1",
      },
      goals: [
        { id: "g1", statement: "Build an agent", priority: "must", acceptance: ["It runs"], derived_from: "s1" },
      ],
      constraints: [
        { id: "c1", kind: "architectural", hardness: "hard", statement: "It must use PostgreSQL", derived_from: "s1" },
      ],
      non_goals: [],
      scope: { include: ["**/*"], exclude: [], blast_radius: "module", derived_from: "s1" },
      required_capabilities: [],
      assumptions: [],
      open_questions: [],
      verification: [],
      deliverables: [{ id: "d1", kind: "code_change", description: "the agent", derived_from: "s1" }],
      risk: { level: "low", factors: [] },
    };

    const urls: string[] = [];
    const sent: Array<Record<string, string>> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      urls.push(String(input instanceof Request ? input.url : input));
      sent.push(Object.fromEntries(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).entries()));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: anthropicModel,
          content: [{ type: "text", text: JSON.stringify(draft) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const stub = process.env["FORGE_CHAT_STUB"];
    delete process.env["FORGE_CHAT_STUB"];
    let thrown: unknown = null;
    try {
      await irForVersion(convo, convo.currentV, { provider: "opencode-go", model: anthropicModel });
    } catch (error) {
      thrown = error;
    } finally {
      globalThis.fetch = realFetch;
      if (stub === undefined) delete process.env["FORGE_CHAT_STUB"];
      else process.env["FORGE_CHAT_STUB"] = stub;
    }

    expect(thrown).toBeNull();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => u.includes("/chat/completions"))).toEqual([]);
    // Exactly the gateway's path. `includes("/messages")` also accepted
    // `…/v1/v1/messages`, the 404 every live compile hit (hardening pass).
    expect(urls.every((u) => u === "https://opencode.ai/zen/go/v1/messages")).toBe(true);
    // And the session header the gateway requires on every call.
    expect(sent.every((h) => typeof h["x-opencode-session"] === "string" && h["x-opencode-session"].length > 0)).toBe(true);
  });

  /**
   * The four `responses` models. Core has no Responses-protocol provider, so
   * the honest outcome is a refusal that names the reason — not the old
   * behaviour of sending them to `/chat/completions` and reporting whatever
   * empty-bodied 503 came back. No silent fallbacks: a hard error beats a
   * plausible wrong answer.
   */
  it("refuses a responses-protocol model with a reason instead of mis-routing it", async () => {
    expect(responsesModel, "the model table no longer has a responses model").toBeDefined();
    const { getEffectiveProvider } = await import("../../web/lib/forge");
    expect(() => getEffectiveProvider("opencode-go", responsesModel!)).toThrow(/responses/i);
  });

  it("still routes a chat-completions model to /chat/completions", async () => {
    const { getEffectiveProvider } = await import("../../web/lib/forge");
    const resolved = getEffectiveProvider("opencode-go", "kimi-k3");
    expect(resolved.model).toBe("kimi-k3");
    expect(resolved.providerId).toBe("opencode-go");
  });
});
