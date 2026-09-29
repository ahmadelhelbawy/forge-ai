/**
 * The REAL turn path — depsFor → buildDeps → generate / generateStream → the
 * AI SDK — against a local OpenAI-compatible server (pre-release audit,
 * 2026-09-29).
 *
 * Every other turn test injects a model stand-in, and the HTTP/browser suites
 * run with FORGE_CHAT_STUB, which replaces buildDeps wholesale. So nothing
 * automated exercised the prompt rendering, the streaming adapter, the wire
 * request or the finish-reason handling — the code where the 2026-09-26
 * release blockers were found. This does, with no key and no network: the
 * only socket is to a server this file starts on 127.0.0.1.
 */
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveProvider } from "../../web/lib/providers";
import { addPromptVersion, currentPrompt, newConversation, saveConversation } from "../../web/lib/store";
import { depsFor } from "../../web/lib/turn/http";
import { executeTurn } from "../../web/lib/turn/pipeline";

interface Seen {
  readonly authorization: string | undefined;
  readonly body: { model: string; stream?: boolean; messages: Array<{ role: string; content: string }> };
}

let server: Server;
let seen: Seen[] = [];
let generation: { text: string; finish: "stop" | "length" } = { text: "", finish: "stop" };
const saved: Record<string, string | undefined> = {};

async function readBody(req: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

function chunk(content: string | null, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: "c1",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-4o-mini",
    choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finish }],
  })}\n\n`;
}

beforeEach(async () => {
  for (const name of ["FORGE_DATA_DIR", "FORGE_APP_SECRET", "FORGE_CHAT_STUB", "OPENAI_API_KEY", "OPENAI_BASE_URL", "FORGE_API_KEY", "FORGE_BASE_URL"]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env["FORGE_DATA_DIR"] = join(mkdtempSync(join(tmpdir(), "forge-live-path-")), "data");
  process.env["FORGE_APP_SECRET"] = "live-path-secret-0123456789";
  seen = [];
  server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Seen["body"];
    seen.push({ authorization: req.headers["authorization"], body });
    const text = body.messages.map((m) => m.content).join("\n");
    const isClassify = text.includes("Classify the user's message");
    const answer = isClassify ? JSON.stringify({ action: "REVISE", versions: [] }) : generation.text;
    const finish = isClassify ? "stop" : generation.finish;
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Several deltas, so the streaming adapter has something to reassemble.
      for (let at = 0; at < answer.length; at += 40) res.write(chunk(answer.slice(at, at + 40), null));
      res.write(chunk(null, finish));
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: "gpt-4o-mini",
        choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: finish }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  saveProvider("openai", { apiKey: "sk-live-path-0123456789", baseURL: `http://127.0.0.1:${port}/v1` });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function conversation() {
  const convo = newConversation({ title: "live path", provider: "openai", model: "gpt-4o-mini", target: "claude-code" });
  addPromptVersion(convo, "Review pull requests. Never approve without tests.", "manual");
  saveConversation(convo);
  return convo;
}

describe("the real turn path over the wire", () => {
  it("classifies, streams a REVISE, and saves exactly the streamed prompt", async () => {
    const revised = "Review pull requests for correctness and security. Never approve without tests.";
    generation = { text: JSON.stringify({ reply: "Tightened the scope.", prompt: revised }), finish: "stop" };
    const convo = conversation();

    const deps = await depsFor(convo, currentPrompt(convo), false);
    const result = await executeTurn(convo, "Tighten this prompt.", deps);

    expect(result.failed).toBe(false);
    expect(result.action).toBe("REVISE");
    expect(currentPrompt(convo)).toBe(revised);
    expect(convo.promptVersions.map((v) => v.v)).toEqual([1, 2]);

    // What actually went over the wire.
    expect(seen).toHaveLength(2); // one classify, one generation — no retries
    for (const request of seen) {
      expect(request.authorization).toBe("Bearer sk-live-path-0123456789");
      expect(request.body.model).toBe("gpt-4o-mini");
    }
    const generationRequest = seen.find((s) => s.body.stream)!;
    expect(generationRequest).toBeDefined();
    const system = generationRequest.body.messages.find((m) => m.role === "system")!.content;
    const user = generationRequest.body.messages.find((m) => m.role === "user")!.content;
    expect(system.length).toBeGreaterThan(200);
    expect(`${system}\n${user}`).toContain("Never approve without tests.");
    expect(`${system}\n${user}`).toContain("Tighten this prompt.");
  });

  it("an output-limit stop mid-prompt saves nothing and names the limit (WS-R12a)", async () => {
    const full = JSON.stringify({ reply: "Rewrote it.", prompt: "Review pull requests carefully. ".repeat(40) });
    generation = { text: full.slice(0, Math.floor(full.length * 0.6)), finish: "length" };
    const convo = conversation();

    const result = await executeTurn(convo, "Rewrite the whole prompt.", await depsFor(convo, currentPrompt(convo), false));

    expect(result.failed).toBe(true);
    expect(String((result as { error?: unknown }).error)).toMatch(/reached its output limit .* nothing was saved/);
    expect(convo.promptVersions).toHaveLength(1);
    expect(convo.messages.at(-1)).toMatchObject({ role: "user", content: "Rewrite the whole prompt." });
  });
});
