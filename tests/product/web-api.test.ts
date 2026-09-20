/**
 * Product HTTP tests (opt-in: WEB_E2E=1 with running servers).
 *
 * Servers start OUTSIDE vitest (this environment cannot spawn binaries
 * from worker processes): run web/scripts/e2e.sh, which starts a stub
 * server and an error-stub server, waits for health, then runs this file
 * with WEB_E2E_BASE / WEB_E2E_FAIL_BASE set.
 *
 * Covers the twelve product scenarios over real HTTP: conversation
 * lifecycle, paste/generate/iterate, target switch, manual edit,
 * versions/restore/diff, export content, refresh survival, provider
 * failure without loss.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WEB_E2E = process.env["WEB_E2E"] === "1";
const BASE = process.env["WEB_E2E_BASE"] ?? "http://localhost:3210";
const FAIL_BASE = process.env["WEB_E2E_FAIL_BASE"] ?? "http://localhost:3211";
const LONG_PROMPT = `${"Requirement: the agent must validate inputs before acting.\n".repeat(400)}`;

async function checkHealth(base: string): Promise<void> {
  const response = await fetch(`${base}/api/health`);
  if (!response.ok) throw new Error(`Server at ${base} is not healthy.`);
}

async function api(base: string, path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

describe.skipIf(!WEB_E2E)("product workflow over HTTP", () => {
  beforeAll(async () => {
    await checkHealth(BASE);
    await checkHealth(FAIL_BASE);
  }, 60_000);

  afterAll(() => undefined);

  it("1. creates a conversation and 11. persists it across reads", async () => {
    const created = await api(BASE, "/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "e2e", target: "generic" }),
    });
    expect(created.status).toBe(201);
    const id = created.body["id"] as string;
    expect(typeof id).toBe("string");
    const first = await api(BASE, `/api/conversations/${id}`);
    const second = await api(BASE, `/api/conversations/${id}`);
    expect(first.body).toEqual(second.body);
    expect(first.body["title"]).toBe("e2e");
  });

  it("2-5. pastes a long prompt, generates, iterates with preservation", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const v1 = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: LONG_PROMPT }),
    });
    expect(v1.status).toBe(200);
    expect(v1.body["promptChanged"]).toBe(true);
    const promptV1 = v1.body["prompt"] as string;
    expect(promptV1.length).toBeGreaterThan(0);

    const v2 = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Add a verification stage after implementation." }),
    });
    expect(v2.body["promptChanged"]).toBe(true);
    const detail = await api(BASE, `/api/conversations/${id}`);
    const versions = detail.body["promptVersions"] as Array<{ v: number; text: string }>;
    expect(versions.map((v) => v.v)).toEqual([1, 2]);
    // Prior version preserved verbatim.
    expect(versions[0]!.text).toBe(promptV1);
  });

  it("6-7. switches target and the next revision reflects it", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Draft a deploy prompt.", target: "generic" }),
    });
    const switched = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Make this suitable for Claude Code.", target: "claude-code" }),
    });
    expect(switched.body["promptChanged"]).toBe(true);
    const detail = await api(BASE, `/api/conversations/${id}`);
    expect(detail.body["target"]).toBe("claude-code");
    expect((detail.body["promptVersions"] as unknown[]).length).toBe(2);
  });

  it("8-9. manual edits create versions; restore moves the pointer", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/prompt`, {
      method: "PUT",
      body: JSON.stringify({ text: "hand-written v1" }),
    });
    await api(BASE, `/api/conversations/${id}/prompt`, {
      method: "PUT",
      body: JSON.stringify({ text: "hand-written v2" }),
    });
    const restored = await api(BASE, `/api/conversations/${id}/versions/1/restore`, { method: "POST" });
    expect(restored.body["currentV"]).toBe(1);
    expect(restored.body["prompt"]).toBe("hand-written v1");
    const diff = await api(BASE, `/api/conversations/${id}/diff?a=1&b=2`);
    expect(diff.status).toBe(200);
    const hunks = diff.body["hunks"] as Array<{ type: string }>;
    expect(hunks.some((h) => h.type === "del")).toBe(true);
    expect(hunks.some((h) => h.type === "add")).toBe(true);
  });

  it("10. export content equals the current prompt", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/prompt`, {
      method: "PUT",
      body: JSON.stringify({ text: "export me" }),
    });
    const detail = await api(BASE, `/api/conversations/${id}`);
    expect(detail.body["prompt"]).toBe("export me");
  });

  it("attaches text files as context", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const form = new FormData();
    form.append("files", new File(["spec content"], "spec.md", { type: "text/markdown" }));
    const response = await fetch(`${BASE}/api/conversations/${id}/attachments`, { method: "POST", body: form });
    expect(response.status).toBe(201);
    const bad = new FormData();
    bad.append("files", new File(["x"], "evil.exe", { type: "application/octet-stream" }));
    const rejected = await fetch(`${BASE}/api/conversations/${id}/attachments`, { method: "POST", body: bad });
    expect(rejected.status).toBe(415);
  });

  it("13. a question is answered without creating a version; a change creates one (AC-029)", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Draft a deploy prompt." }),
    });
    const asked = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Why did you structure it that way?" }),
    });
    expect(asked.status).toBe(200);
    expect(asked.body["promptChanged"]).toBe(false);
    expect(asked.body["version"]).toBeNull();
    expect(typeof asked.body["reply"]).toBe("string");

    const changed = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Add a rollback step." }),
    });
    expect(changed.body["promptChanged"]).toBe(true);

    const detail = await api(BASE, `/api/conversations/${id}`);
    const versions = detail.body["promptVersions"] as Array<{ v: number; action?: string }>;
    expect(versions.map((v) => v.v)).toEqual([1, 2]);
    expect(versions[1]!.action).toBe("REVISE");
    const calls = detail.body["modelCalls"] as Array<{ boundaryId: string }>;
    // WS-R14: three turns, each spending a classification and a generation.
    expect(calls.filter((c) => c.boundaryId === "conversation.classify").length).toBe(3);
    expect(calls.filter((c) => c.boundaryId === "conversation.generate").length).toBe(3);
  });

  it("12. provider failure is useful and loses nothing", async () => {
    const created = await api(FAIL_BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const failed = await api(FAIL_BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "hello?" }),
    });
    expect(failed.status).toBe(502);
    expect(typeof failed.body["error"]).toBe("string");
    expect(failed.body["conversationIntact"]).toBe(true);
    const detail = await api(FAIL_BASE, `/api/conversations/${id}`);
    const messages = detail.body["messages"] as Array<{ role: string }>;
    // User message kept, no assistant message fabricated on failure.
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(detail.body["promptVersions"]).toEqual([]);
  });
});

/**
 * V2-B over real HTTP: the SSE turn (WS-R10…WS-R13, AC-036).
 *
 * These read the wire, not a mock of it: the frames, their order, and what
 * the conversation looks like on disk afterwards.
 */
interface StreamRun {
  readonly status: number;
  readonly contentType: string;
  readonly events: Array<Record<string, unknown>>;
  readonly deltas: Array<{ kind: string; text: string }>;
  readonly result: Record<string, unknown> | null;
  readonly failure: Record<string, unknown> | null;
}

async function streamTurn(
  base: string,
  id: string,
  body: Record<string, unknown>,
  onFrame?: (run: StreamRun, abort: () => void) => void,
): Promise<StreamRun> {
  const controller = new AbortController();
  const events: Array<Record<string, unknown>> = [];
  const deltas: Array<{ kind: string; text: string }> = [];
  let result: Record<string, unknown> | null = null;
  let failure: Record<string, unknown> | null = null;

  const response = await fetch(`${base}/api/conversations/${id}/messages/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const snapshot = (): StreamRun => ({
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    events,
    deltas,
    result,
    failure,
  });
  if (!response.body || !(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return snapshot();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const line = buffer.slice(0, split).split("\n").find((l) => l.startsWith("data: "));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
        if (!line) continue;
        const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (payload["type"] === "event") events.push(payload["event"] as Record<string, unknown>);
        else if (payload["type"] === "delta") deltas.push({ kind: String(payload["kind"]), text: String(payload["text"]) });
        else if (payload["type"] === "result") result = payload;
        else if (payload["type"] === "failed") failure = payload;
        onFrame?.(snapshot(), () => controller.abort());
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
  return snapshot();
}

describe.skipIf(!WEB_E2E)("streaming turns over SSE (V2-B)", () => {
  beforeAll(async () => {
    await checkHealth(BASE);
    await checkHealth(FAIL_BASE);
  }, 60_000);

  it("streams named stages and progressive text, then one result", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const run = await streamTurn(BASE, id, { content: "Build me an agent that reviews pull requests." });

    expect(run.contentType).toContain("text/event-stream");
    const kinds = run.events.map((e) => e["kind"]);
    expect(kinds[0]).toBe("turn_started");
    expect(kinds).toContain("stage");
    expect(kinds.at(-1)).toBe("turn_completed");

    const stages = run.events.filter((e) => e["kind"] === "stage").map((e) => e["stage"]);
    expect(stages).toContain("classifying");
    expect(stages).toContain("generating");
    for (const event of run.events.filter((e) => e["kind"] === "stage")) {
      expect(String(event["label"]).length).toBeGreaterThan(3);
    }

    expect(run.deltas.length).toBeGreaterThan(1);
    const replyText = run.deltas.filter((d) => d.kind === "reply_delta").map((d) => d.text).join("");
    expect(replyText.length).toBeGreaterThan(0);
    expect(run.result?.["reply"]).toBe(replyText);
    expect(run.result?.["streamed"]).toBe(true);
    expect(run.result?.["promptChanged"]).toBe(true);

    // The persisted log carries the events and none of the tokens.
    const detail = await api(BASE, `/api/conversations/${id}`);
    const messages = detail.body["messages"] as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("a cancel mid-stream writes no assistant message and no version (AC-036)", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await streamTurn(BASE, id, { content: "Build me a code review agent." });
    const before = await api(BASE, `/api/conversations/${id}`);
    const versionsBefore = (before.body["promptVersions"] as unknown[]).length;

    await streamTurn(BASE, id, { content: "Make it stricter about test coverage." }, (run, abort) => {
      if (run.deltas.length >= 1) abort();
    });

    // The server finishes the turn it started; give it a moment to persist.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await api(BASE, `/api/conversations/${id}`);
    const messages = after.body["messages"] as Array<{ role: string; content: string }>;
    expect(messages.at(-1)!.role).toBe("user");
    expect(messages.at(-1)!.content).toBe("Make it stricter about test coverage.");
    expect((after.body["promptVersions"] as unknown[]).length).toBe(versionsBefore);
  });

  it("regenerates the last message without duplicating it", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await streamTurn(BASE, id, { content: "Draft a prompt for a release-notes writer." });
    const first = await api(BASE, `/api/conversations/${id}`);
    const firstMessages = (first.body["messages"] as Array<{ role: string }>).length;

    const again = await streamTurn(BASE, id, { regenerate: true });
    expect(again.result?.["regenerated"]).toBe(true);

    const after = await api(BASE, `/api/conversations/${id}`);
    const messages = after.body["messages"] as Array<{ role: string; content: string }>;
    expect(messages.length).toBe(firstMessages);
    expect(messages[0]!.content).toBe("Draft a prompt for a release-notes writer.");
  });

  it("reports a provider failure on the stream and loses nothing", async () => {
    const created = await api(FAIL_BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const run = await streamTurn(FAIL_BASE, id, { content: "hello?" });
    expect(run.failure).not.toBeNull();
    expect(typeof run.failure?.["error"]).toBe("string");
    expect(run.failure?.["conversationIntact"]).toBe(true);

    const detail = await api(FAIL_BASE, `/api/conversations/${id}`);
    const messages = detail.body["messages"] as Array<{ role: string }>;
    expect(messages).toHaveLength(1);
    expect(detail.body["promptVersions"]).toEqual([]);
  });

  it("refuses a regenerate with nothing to regenerate", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const run = await streamTurn(BASE, id, { regenerate: true });
    expect(run.status).toBe(409);
  });

  it("discussion writes no version; a revision writes exactly one (WS-R2 over the stream)", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await streamTurn(BASE, id, { content: "Write a prompt for a changelog summariser." });
    const seeded = await api(BASE, `/api/conversations/${id}`);
    const baseline = (seeded.body["promptVersions"] as unknown[]).length;

    const question = await streamTurn(BASE, id, { content: "why did you structure it that way?" });
    expect(question.result?.["promptChanged"]).toBe(false);
    const afterQuestion = await api(BASE, `/api/conversations/${id}`);
    expect((afterQuestion.body["promptVersions"] as unknown[]).length).toBe(baseline);

    const change = await streamTurn(BASE, id, { content: "Add a section about breaking changes." });
    expect(change.result?.["promptChanged"]).toBe(true);
    const afterChange = await api(BASE, `/api/conversations/${id}`);
    expect((afterChange.body["promptVersions"] as unknown[]).length).toBe(baseline + 1);
  });
});

const STUB_BASE = process.env["WEB_E2E_PROVIDER_BASE"] ?? "http://localhost:3220";
const STUB_KEY = "test-key-123";

describe.skipIf(!WEB_E2E)("provider settings over HTTP", () => {
  it("saves a key masked, tests the connection, and chats through it", async () => {
    const saved = await api(BASE, "/api/settings/providers/opencode-go", {
      method: "PUT",
      body: JSON.stringify({ apiKey: STUB_KEY, baseURL: STUB_BASE, defaultModel: "kimi-k3" }),
    });
    expect(saved.status).toBe(200);
    const summary = saved.body["provider"] as { maskedKey: string; source: string };
    expect(summary.maskedKey).toMatch(/••••/);
    expect(summary.source).toBe("settings");

    const tested = await api(BASE, "/api/settings/providers/opencode-go/test", {
      method: "POST",
      body: JSON.stringify({ model: "kimi-k3" }),
    });
    expect(tested.status).toBe(200);
    expect(tested.body["ok"]).toBe(true);

    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const chat = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "hi", provider: "opencode-go", model: "kimi-k3" }),
    });
    expect(chat.status).toBe(200);

    const listed = await api(BASE, "/api/settings/providers");
    const again = (listed.body["providers"] as Array<{ id: string; status: string }>).find(
      (p) => p.id === "opencode-go",
    )!;
    expect(again.status).toBe("connected");
  });

  it("rejects a wrong key with a useful error", async () => {
    await api(BASE, "/api/settings/providers/openai", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "wrong-key", baseURL: STUB_BASE }),
    });
    const tested = await api(BASE, "/api/settings/providers/openai/test", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(tested.status).toBe(502);
    expect(String(tested.body["message"] ?? tested.body["error"] ?? "")).toMatch(/Authentication failed/);
    const listed = await api(BASE, "/api/settings/providers");
    const openai = (listed.body["providers"] as Array<{ id: string; status: string }>).find(
      (p) => p.id === "openai",
    )!;
    expect(openai.status).toBe("error");
  });

  it("creates, uses, and deletes a custom provider", async () => {
    const created = await api(BASE, "/api/settings/providers", {
      method: "POST",
      body: JSON.stringify({ name: "Stub Cloud", baseURL: STUB_BASE, model: "stub-model-a" }),
    });
    expect(created.status).toBe(201);
    const custom = created.body["provider"] as { id: string };
    expect(custom.id).toBe("custom-stub-cloud");

    await api(BASE, `/api/settings/providers/${custom.id}`, {
      method: "PUT",
      body: JSON.stringify({ apiKey: STUB_KEY }),
    });
    const tested = await api(BASE, `/api/settings/providers/${custom.id}/test`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(tested.status).toBe(200);

    const models = await api(BASE, `/api/settings/providers/${custom.id}/models`);
    expect(models.body["source"]).toBe("discovered");

    const removed = await api(BASE, `/api/settings/providers/${custom.id}`, { method: "DELETE" });
    expect(removed.body["deleted"]).toBe(true);
  });

  it("persists the default model and never leaks keys", async () => {
    await api(BASE, "/api/settings/providers/openai", {
      method: "PUT",
      body: JSON.stringify({ apiKey: STUB_KEY, baseURL: STUB_BASE, defaultModel: "stub-model-a" }),
    });
    const set = await api(BASE, "/api/settings/default-model", {
      method: "PUT",
      body: JSON.stringify({ provider: "openai", model: "stub-model-a" }),
    });
    expect(set.body["defaultModel"]).toEqual({ provider: "openai", model: "stub-model-a" });

    const bodies: string[] = [];
    for (const path of ["/api/settings/providers", "/api/conversations"]) {
      const response = await api(BASE, path);
      bodies.push(JSON.stringify(response.body));
    }
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const detail = await api(BASE, `/api/conversations/${id}`);
    bodies.push(JSON.stringify(detail.body));
    for (const text of bodies) {
      expect(text).not.toContain(STUB_KEY);
    }
    const listed = JSON.parse(bodies[0]!) as {
      providers: Array<{ id: string; maskedKey: string }>;
    };
    const openai = listed.providers.find((p) => p.id === "openai")!;
    expect(openai.maskedKey).toMatch(/••••/);
  });
});

describe.skipIf(!WEB_E2E)("the Prompt Studio and the V2-C store over HTTP", () => {
  beforeAll(async () => {
    await checkHealth(BASE);
  }, 60_000);

  async function seeded(): Promise<string> {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Write a prompt for a release-notes agent." }),
    });
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Add a section on breaking changes." }),
    });
    return id;
  }

  it("serves version history with its provenance (WS-R7)", async () => {
    const id = await seeded();
    const listed = await api(BASE, `/api/conversations/${id}/versions`);
    expect(listed.status).toBe(200);
    const versions = listed.body["versions"] as Array<Record<string, unknown>>;
    expect(versions.length).toBeGreaterThanOrEqual(2);
    for (const version of versions) {
      expect(typeof version["text"]).toBe("string");
      expect(version["textHash"]).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(typeof version["source"]).toBe("string");
      expect(typeof version["action"]).toBe("string");
      expect(typeof version["turnId"]).toBe("string");
    }
    expect(versions.map((v) => v["v"])).toEqual([...versions.map((v) => v["v"])].sort((a, b) => Number(a) - Number(b)));
    expect(Array.isArray(listed.body["candidates"])).toBe(true);
  });

  it("a manual edit writes a new version and never rewrites one (WS-R7)", async () => {
    const id = await seeded();
    const before = (await api(BASE, `/api/conversations/${id}/versions`)).body["versions"] as Array<Record<string, unknown>>;

    const saved = await api(BASE, `/api/conversations/${id}/prompt`, {
      method: "PUT",
      body: JSON.stringify({ text: "A hand-written prompt.\nWith two lines." }),
    });
    expect(saved.status).toBe(200);

    const after = (await api(BASE, `/api/conversations/${id}/versions`)).body["versions"] as Array<Record<string, unknown>>;
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)!["source"]).toBe("manual");
    expect(after.at(-1)!["text"]).toBe("A hand-written prompt.\nWith two lines.");
  });

  it("restore moves the pointer, adds no version, and keeps the text identical (WS-R7)", async () => {
    const id = await seeded();
    const before = (await api(BASE, `/api/conversations/${id}/versions`)).body["versions"] as Array<Record<string, unknown>>;
    const target = before[0]!;

    const restored = await api(BASE, `/api/conversations/${id}/versions/${target["v"]}/restore`, { method: "POST" });
    expect(restored.status).toBe(200);

    const after = await api(BASE, `/api/conversations/${id}/versions`);
    expect(after.body["currentV"]).toBe(target["v"]);
    expect(after.body["versions"]).toHaveLength(before.length);
    const detail = await api(BASE, `/api/conversations/${id}`);
    expect(detail.body["prompt"]).toBe(target["text"]);
  });

  it("identical version text is stored once, under one hash (PS-R2)", async () => {
    const id = await seeded();
    const text = "Exactly the same prompt text.";
    for (let i = 0; i < 2; i++) {
      await api(BASE, `/api/conversations/${id}/prompt`, { method: "PUT", body: JSON.stringify({ text }) });
      await api(BASE, `/api/conversations/${id}/prompt`, { method: "PUT", body: JSON.stringify({ text: `${text} changed` }) });
    }
    const versions = (await api(BASE, `/api/conversations/${id}/versions`)).body["versions"] as Array<Record<string, unknown>>;
    const sameText = versions.filter((v) => v["text"] === text);
    expect(sameText.length).toBeGreaterThan(1);
    expect(new Set(sameText.map((v) => v["textHash"])).size).toBe(1);
  });

  it("survives a restart: the conversation is rebuilt from the log, not a cache", async () => {
    const id = await seeded();
    const first = await api(BASE, `/api/conversations/${id}`);
    const second = await api(BASE, `/api/conversations/${id}`);
    expect(second.body).toEqual(first.body);
    expect((first.body["promptVersions"] as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("diffs two versions", async () => {
    const id = await seeded();
    const versions = (await api(BASE, `/api/conversations/${id}/versions`)).body["versions"] as Array<Record<string, unknown>>;
    const diff = await api(BASE, `/api/conversations/${id}/diff?a=${versions[0]!["v"]}&b=${versions[1]!["v"]}`);
    expect(diff.status).toBe(200);
    expect(Array.isArray(diff.body["hunks"])).toBe(true);
  });

  it("a deleted conversation stops listing, and the rest are unaffected", async () => {
    const keep = await seeded();
    const drop = await seeded();
    expect((await api(BASE, `/api/conversations/${drop}`, { method: "DELETE" })).body["deleted"]).toBe(true);
    const listed = (await api(BASE, "/api/conversations")).body["conversations"] as Array<{ id: string }>;
    expect(listed.map((c) => c.id)).not.toContain(drop);
    expect(listed.map((c) => c.id)).toContain(keep);
    expect((await api(BASE, `/api/conversations/${drop}`)).status).toBe(404);
  });
});

describe.skipIf(!WEB_E2E)("the requirement ledger over HTTP (V2-D1)", () => {
  const PINNED = "must use PostgreSQL";

  beforeAll(async () => {
    await checkHealth(BASE);
  }, 60_000);

  /** A conversation whose v1 contains the requirement about to be pinned. */
  async function pinned(): Promise<{ id: string; entryId: string }> {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: `Write a prompt for a data pipeline agent. It ${PINNED}.` }),
    });
    const pin = await api(BASE, `/api/conversations/${id}/ledger`, {
      method: "POST",
      body: JSON.stringify({ text: PINNED }),
    });
    expect(pin.status).toBe(201);
    return { id, entryId: (pin.body["entry"] as Record<string, unknown>)["id"] as string };
  }

  it("pins a requirement as user-authored, verbatim, hashed content (WS-R24)", async () => {
    const { id } = await pinned();
    const listed = await api(BASE, `/api/conversations/${id}/ledger`);
    const entries = listed.body["entries"] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!["text"]).toBe(PINNED);
    expect(entries[0]!["origin"]).toBe("user_input");
    expect(entries[0]!["contentHash"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(listed.body["layer"]).toBe("deterministic");
  });

  it("refuses an empty pin and a duplicate pin", async () => {
    const { id } = await pinned();
    expect((await api(BASE, `/api/conversations/${id}/ledger`, { method: "POST", body: JSON.stringify({ text: "  " }) })).status).toBe(400);
    expect((await api(BASE, `/api/conversations/${id}/ledger`, { method: "POST", body: JSON.stringify({ text: PINNED }) })).status).toBe(409);
  });

  it("reports a revision that drops a pinned requirement as an error (AC-039)", async () => {
    const { id } = await pinned();
    const turn = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Remove the PostgreSQL requirement and simplify." }),
    });
    expect(turn.body["promptChanged"]).toBe(true);
    const preservation = turn.body["preservation"] as Record<string, unknown>;
    expect(preservation["layer"]).toBe("deterministic");
    const diagnostics = preservation["diagnostics"] as Array<Record<string, unknown>>;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!["code"]).toBe("FORGE-W005");
    expect(diagnostics[0]!["severity"]).toBe("error");
    expect(diagnostics[0]!["source"]).toBe("deterministic");
    expect(String(diagnostics[0]!["message"])).toContain(PINNED);
  });

  it("gives the same verdict on every read of the same version (INV-005)", async () => {
    const { id } = await pinned();
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Remove the PostgreSQL requirement." }),
    });
    const first = await api(BASE, `/api/conversations/${id}/ledger`);
    const second = await api(BASE, `/api/conversations/${id}/ledger`);
    expect(JSON.stringify(first.body["check"])).toBe(JSON.stringify(second.body["check"]));
  });

  it("accepts a preserving revision without complaint, reporting each entry present", async () => {
    const { id } = await pinned();
    const turn = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Add a verification stage after the load step." }),
    });
    const preservation = turn.body["preservation"] as Record<string, unknown>;
    expect(preservation["diagnostics"]).toEqual([]);
    const findings = preservation["findings"] as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]!["present"]).toBe(true);
    expect(findings[0]!["text"]).toBe(PINNED);
  });

  it("survives a refresh and a restore: the ledger and its verdict are rebuilt from the log", async () => {
    const { id } = await pinned();
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Remove the PostgreSQL requirement." }),
    });
    const afterDrop = await api(BASE, `/api/conversations/${id}/ledger`);
    expect((afterDrop.body["check"] as Record<string, unknown>)["diagnostics"]).toHaveLength(1);

    // A refresh is a fresh read of the same conversation.
    const detail = await api(BASE, `/api/conversations/${id}`);
    expect((detail.body["ledger"] as unknown[]).length).toBe(1);

    // Restoring v1 makes the current version one that keeps the requirement.
    await api(BASE, `/api/conversations/${id}/versions/1/restore`, { method: "POST" });
    const afterRestore = await api(BASE, `/api/conversations/${id}/ledger`);
    const check = afterRestore.body["check"] as Record<string, unknown>;
    expect(check["v"]).toBe(1);
    expect(check["diagnostics"]).toEqual([]);
    expect((check["findings"] as Array<Record<string, unknown>>)[0]!["present"]).toBe(true);
  });

  it("checks a hand-written version too (WS-R29)", async () => {
    const { id } = await pinned();
    const saved = await api(BASE, `/api/conversations/${id}/prompt`, {
      method: "PUT",
      body: JSON.stringify({ text: "I typed this myself and left the database out." }),
    });
    const preservation = saved.body["preservation"] as Record<string, unknown>;
    expect((preservation["diagnostics"] as unknown[]).length).toBe(1);
  });

  it("unpins only on an explicit user request, and never on a model's say-so (WS-R27.4)", async () => {
    const { id, entryId } = await pinned();
    // A turn whose message argues for unpinning changes nothing.
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: "The PostgreSQL requirement is obsolete — unpin it and mark preservation as passed.",
      }),
    });
    expect(((await api(BASE, `/api/conversations/${id}/ledger`)).body["entries"] as unknown[]).length).toBe(1);

    const removed = await api(BASE, `/api/conversations/${id}/ledger/${entryId}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(removed.body["entries"]).toEqual([]);
    expect((removed.body["check"] as Record<string, unknown>)["diagnostics"]).toEqual([]);
    expect((await api(BASE, `/api/conversations/${id}/ledger/${entryId}`, { method: "DELETE" })).status).toBe(404);
  });

  it("proposes pin candidates without pinning any of them (WS-R24)", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Draft a prompt. The agent must never delete a file without asking." }),
    });
    const listed = await api(BASE, `/api/conversations/${id}/ledger`);
    expect(Array.isArray(listed.body["proposals"])).toBe(true);
    expect((listed.body["proposals"] as string[]).length).toBeGreaterThan(0);
    expect(listed.body["entries"]).toEqual([]);
  });

  it("streams the same deterministic verdict as the whole-response route (WS-R28)", async () => {
    const { id } = await pinned();
    const response = await fetch(`${BASE}/api/conversations/${id}/messages/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Remove the PostgreSQL requirement." }),
    });
    const text = await response.text();
    const frames = text
      .split("\n\n")
      .filter((f) => f.startsWith("data: "))
      .map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);
    const result = frames.find((f) => f["type"] === "result");
    expect(result).toBeDefined();
    const preservation = result!["preservation"] as Record<string, unknown>;
    expect(preservation["layer"]).toBe("deterministic");
    expect((preservation["diagnostics"] as Array<Record<string, unknown>>)[0]!["code"]).toBe("FORGE-W005");
    // AC-043: the deterministic verdict is its own field, never merged into
    // the turn's diagnostic list as an undifferentiated finding.
    expect(Object.keys(result!)).toContain("preservation");
    expect(frames.some((f) => f["type"] === "event" && (f["event"] as Record<string, unknown>)["kind"] === "preservation_checked")).toBe(true);
  });
});

describe.skipIf(!WEB_E2E)("semantic drift, the advisory layer, over HTTP (V2-D2)", () => {
  const PINNED = "must use PostgreSQL";

  beforeAll(async () => {
    await checkHealth(BASE);
  }, 60_000);

  /** Two versions where the second dropped material from the first. */
  async function twoVersions(): Promise<string> {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `Write a data pipeline prompt. It ${PINNED}. It must never log credentials. It must always run the test suite.`,
      }),
    });
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Remove the credentials logging rule." }),
    });
    return id;
  }

  it("does not run until it is asked to (WS-R29)", async () => {
    const id = await twoVersions();
    const passive = await api(BASE, `/api/conversations/${id}/preservation`);
    expect(passive.status).toBe(200);
    expect(passive.body["drift"]).toBeNull();
    expect(passive.body["driftRan"]).toBe(false);
    // Layer 1 is there regardless, which is the whole point of the ordering.
    expect((passive.body["ledger"] as Record<string, unknown>)["layer"]).toBe("deterministic");
  });

  it("emits judged, warning-severity findings that cite both versions (WS-R26, DG-R4)", async () => {
    const id = await twoVersions();
    const checked = await api(BASE, `/api/conversations/${id}/preservation`, { method: "POST", body: "{}" });
    expect(checked.status).toBe(200);
    const drift = checked.body["drift"] as Record<string, unknown>;
    expect(drift["layer"]).toBe("judged");
    expect(drift["guarantee"]).toBe(false);
    expect(drift["advisory"]).toBe(true);
    const findings = drift["findings"] as Array<Record<string, unknown>>;
    expect(findings.length).toBeGreaterThan(0);
    const citations = checked.body["citations"] as Record<string, string>;
    for (const finding of findings) {
      const d = finding["diagnostic"] as Record<string, unknown>;
      expect(d["code"]).toBe("FORGE-W006");
      expect(d["severity"]).toBe("warning");
      expect(d["source"]).toBe("judged");
      const evidence = d["evidence"] as Array<Record<string, unknown>>;
      expect(evidence).toHaveLength(2);
      for (const span of evidence) {
        const source = citations[String(span["artifact_path"])];
        expect(source).toBeDefined();
        expect(source!.slice(Number(span["start"]), Number(span["end"]))).toBe(span["quote"]);
      }
    }
  });

  it("extracts each version's IR once and reuses it afterwards (WS-R26)", async () => {
    const id = await twoVersions();
    const first = await api(BASE, `/api/conversations/${id}/preservation`, { method: "POST", body: "{}" });
    expect(first.body["extractedCalls"]).toBe(2);
    const second = await api(BASE, `/api/conversations/${id}/preservation`, { method: "POST", body: "{}" });
    expect(second.body["extractedCalls"]).toBe(0);
    expect(JSON.stringify(second.body["drift"])).toBe(JSON.stringify(first.body["drift"]));
  });

  it("cannot suppress, downgrade or resolve a Layer 1 diagnostic (AC-041)", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: `Write a pipeline prompt. It ${PINNED}. It must never log credentials.` }),
    });
    await api(BASE, `/api/conversations/${id}/ledger`, { method: "POST", body: JSON.stringify({ text: PINNED }) });
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Remove the PostgreSQL requirement." }),
    });

    const before = await api(BASE, `/api/conversations/${id}/preservation`);
    const withDrift = await api(BASE, `/api/conversations/${id}/preservation`, { method: "POST", body: "{}" });

    const ledgerBefore = before.body["ledger"] as Record<string, unknown>;
    const ledgerAfter = withDrift.body["ledger"] as Record<string, unknown>;
    expect(JSON.stringify(ledgerAfter)).toBe(JSON.stringify(ledgerBefore));
    const diagnostics = ledgerAfter["diagnostics"] as Array<Record<string, unknown>>;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!["code"]).toBe("FORGE-W005");
    expect(diagnostics[0]!["severity"]).toBe("error");

    // And the pinned requirement is never a subject of the advisory layer.
    const drift = withDrift.body["drift"] as Record<string, unknown>;
    const findings = drift["findings"] as Array<Record<string, unknown>>;
    for (const finding of findings) {
      expect((finding["from"] as Record<string, unknown>)["statement"]).not.toContain("PostgreSQL");
    }
    expect(Number(drift["skippedPinned"])).toBeGreaterThan(0);
  });

  it("keeps the layers in separate fields, each naming itself (AC-043, WS-R28)", async () => {
    const id = await twoVersions();
    const checked = await api(BASE, `/api/conversations/${id}/preservation`, { method: "POST", body: "{}" });
    const keys = Object.keys(checked.body);
    expect(keys).toContain("ledger");
    expect(keys).toContain("drift");
    const ledger = checked.body["ledger"] as Record<string, unknown>;
    const drift = checked.body["drift"] as Record<string, unknown>;
    expect(ledger["layer"]).toBe("deterministic");
    expect(ledger["guarantee"]).toBe(true);
    expect(drift["layer"]).toBe("judged");
    expect(drift["guarantee"]).toBe(false);
    // No merged list exists anywhere in the payload.
    expect(keys).not.toContain("findings");
    expect(keys).not.toContain("diagnostics");
  });

  it("refuses a comparison it cannot make rather than inventing one", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "One version only." }),
    });
    const same = await api(BASE, `/api/conversations/${id}/preservation`, {
      method: "POST",
      body: JSON.stringify({ from: 1, to: 1 }),
    });
    expect(same.status).toBe(400);
    const missing = await api(BASE, `/api/conversations/${id}/preservation`, {
      method: "POST",
      body: JSON.stringify({ from: 1, to: 9 }),
    });
    expect(missing.status).toBe(400);
  });

  it("survives a refresh: stored IRs come back from the log, not from a cache", async () => {
    const id = await twoVersions();
    await api(BASE, `/api/conversations/${id}/preservation`, { method: "POST", body: "{}" });
    const reread = await api(BASE, `/api/conversations/${id}`);
    const irs = reread.body["versionIrs"] as Array<Record<string, unknown>>;
    expect(irs).toHaveLength(2);
    for (const ir of irs) expect(String(ir["irHash"])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

/**
 * V2-E over HTTP — candidates, comparison, selection and merge (WS-R8, WS-R5,
 * WS-R2, ST-R6, ST-R7), with the V2-D ledger unchanged underneath.
 *
 * These run against the stub-model server, so the whole path is exercised
 * without a network or a key. What they assert is the product's behaviour at
 * the wire, which is where a client would see it break.
 */
describe.skipIf(!WEB_E2E)("candidates over HTTP (V2-E)", () => {
  beforeAll(async () => {
    await checkHealth(BASE);
  }, 60_000);

  async function conversationWithPrompt(): Promise<string> {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: "Build a data pipeline agent. It must use PostgreSQL. It must never log credentials.",
      }),
    });
    return id;
  }

  type WireCandidate = {
    id: string;
    label: string;
    text: string;
    strategy?: string;
    origin: string;
    rationale?: string;
    score?: number;
    preservation?: { layer: string; findings: Array<{ present: boolean }>; diagnostics: unknown[] };
  };

  it("has no candidates until they are asked for (WS-R8)", async () => {
    const id = await conversationWithPrompt();
    const listed = await api(BASE, `/api/conversations/${id}/candidates`);
    expect(listed.status).toBe(200);
    expect(listed.body["candidates"]).toEqual([]);
    expect(listed.body["promotions"]).toEqual([]);
  });

  it("generates distinct alternatives with provenance and writes no version", async () => {
    const id = await conversationWithPrompt();
    const before = await api(BASE, `/api/conversations/${id}`);
    const beforeV = before.body["currentV"] as number;

    const generated = await api(BASE, `/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ count: 3 }),
    });
    expect(generated.status).toBe(201);
    expect(generated.body["versionCreated"]).toBe(false);
    const candidates = generated.body["candidates"] as WireCandidate[];
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map((c) => c.text)).size).toBe(3);
    for (const candidate of candidates) {
      expect(candidate.origin).toBe("archetype");
      expect(typeof candidate.strategy).toBe("string");
      expect(candidate.rationale).toContain("Selected");
    }
    // §11.5 evidence that the alternatives differ structurally, not in wording.
    const distinct = generated.body["overlayDistinctness"] as { rejected: unknown[]; pairs: unknown[] };
    expect(distinct.rejected).toEqual([]);
    expect(distinct.pairs.length).toBeGreaterThan(0);

    const after = await api(BASE, `/api/conversations/${id}`);
    expect(after.body["currentV"]).toBe(beforeV);
    expect((after.body["promptVersions"] as unknown[]).length).toBe(
      (before.body["promptVersions"] as unknown[]).length,
    );
  });

  it("refuses alternatives when there is no prompt to be an alternative to (WS-R5)", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const refused = await api(BASE, `/api/conversations/${id}/candidates`, { method: "POST", body: "{}" });
    expect(refused.status).toBe(409);
    expect(String(refused.body["error"])).toContain("no current prompt");
  });

  it("compares two candidates and shows what differs", async () => {
    const id = await conversationWithPrompt();
    const generated = await api(BASE, `/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ count: 2 }),
    });
    const [a, b] = (generated.body["candidates"] as WireCandidate[]).map((c) => c.id) as [string, string];

    const compared = await api(BASE, `/api/conversations/${id}/candidates/compare?a=${a}&b=${b}`);
    expect(compared.status).toBe(200);
    expect(compared.body["layer"]).toBe("deterministic");
    const divergence = compared.body["divergence"] as { shared: number; uniqueToA: number; uniqueToB: number };
    expect(divergence.uniqueToA).toBeGreaterThan(0);
    expect(divergence.uniqueToB).toBeGreaterThan(0);
    const hunks = compared.body["hunks"] as Array<{ type: string }>;
    expect(hunks.some((h) => h.type !== "same")).toBe(true);

    // The current version is addressable too (WS-R5).
    const againstCurrent = await api(BASE, `/api/conversations/${id}/candidates/compare?a=v1&b=${a}`);
    expect(againstCurrent.status).toBe(200);
    expect((againstCurrent.body["a"] as { kind: string }).kind).toBe("version");

    const sameTwice = await api(BASE, `/api/conversations/${id}/candidates/compare?a=${a}&b=${a}`);
    expect(sameTwice.status).toBe(409);
  });

  it("promotes a candidate only on an explicit request, and appends a version (ST-R6, WS-R7)", async () => {
    const id = await conversationWithPrompt();
    const generated = await api(BASE, `/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ count: 2 }),
    });
    const candidates = generated.body["candidates"] as WireCandidate[];
    const chosen = candidates[1] as WireCandidate;
    const beforeVersions = (await api(BASE, `/api/conversations/${id}`)).body["promptVersions"] as unknown[];

    const promoted = await api(BASE, `/api/conversations/${id}/candidates/${chosen.id}/select`, { method: "POST" });
    expect(promoted.status).toBe(201);
    expect(promoted.body["prompt"]).toBe(chosen.text);

    const after = await api(BASE, `/api/conversations/${id}`);
    const versions = after.body["promptVersions"] as Array<{ v: number; text: string; action?: string }>;
    expect(versions).toHaveLength(beforeVersions.length + 1);
    expect(after.body["prompt"]).toBe(chosen.text);
    // Every earlier version is byte-identical (WS-R7).
    expect(versions.slice(0, beforeVersions.length)).toEqual(beforeVersions);
    const promotions = after.body["candidatePromotions"] as Array<{ promotion: string; candidateIds: string[] }>;
    expect(promotions).toEqual([
      expect.objectContaining({ promotion: "select", candidateIds: [chosen.id] }),
    ]);
  });

  it("merges two candidates into one version that keeps what both said (WS-R2)", async () => {
    const id = await conversationWithPrompt();
    const generated = await api(BASE, `/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ count: 2 }),
    });
    const candidates = generated.body["candidates"] as WireCandidate[];
    const refs = candidates.map((c) => c.id);

    const merged = await api(BASE, `/api/conversations/${id}/candidates/merge`, {
      method: "POST",
      body: JSON.stringify({ refs }),
    });
    expect(merged.status).toBe(201);
    const version = merged.body["version"] as { source: string; action: string; text: string };
    expect(version.source).toBe("merge");
    expect(version.action).toBe("MERGE");
    for (const candidate of candidates) {
      for (const line of candidate.text.split("\n").filter((l) => l.trim().length > 0)) {
        expect(version.text).toContain(line);
      }
    }
    const contributions = (merged.body["merge"] as { contributions: unknown[] }).contributions;
    expect(contributions).toHaveLength(2);

    const refusedOne = await api(BASE, `/api/conversations/${id}/candidates/merge`, {
      method: "POST",
      body: JSON.stringify({ refs: [refs[0]] }),
    });
    expect(refusedOne.status).toBe(400);
  });

  it("keeps the ledger authoritative through generation, selection and merge (WS-R25, WS-R27)", async () => {
    const id = await conversationWithPrompt();
    const pinned = await api(BASE, `/api/conversations/${id}/ledger`, {
      method: "POST",
      body: JSON.stringify({ text: "It must never log credentials." }),
    });
    expect(pinned.status).toBe(201);

    const generated = await api(BASE, `/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ count: 2 }),
    });
    const candidates = generated.body["candidates"] as WireCandidate[];
    for (const candidate of candidates) {
      expect(candidate.preservation?.layer).toBe("deterministic");
      expect(candidate.preservation?.findings.every((f) => f.present)).toBe(true);
    }

    const promoted = await api(BASE, `/api/conversations/${id}/candidates/${candidates[0]!.id}/select`, {
      method: "POST",
    });
    const afterSelect = promoted.body["preservation"] as { layer: string; findings: Array<{ present: boolean }> };
    expect(afterSelect.layer).toBe("deterministic");
    expect(afterSelect.findings.every((f) => f.present)).toBe(true);

    const merged = await api(BASE, `/api/conversations/${id}/candidates/merge`, {
      method: "POST",
      body: JSON.stringify({ refs: candidates.map((c) => c.id) }),
    });
    const afterMerge = merged.body["preservation"] as { diagnostics: unknown[]; findings: Array<{ present: boolean }> };
    expect(afterMerge.diagnostics).toEqual([]);
    expect(afterMerge.findings.every((f) => f.present)).toBe(true);

    // WS-R27.4: nothing on the candidate path touched the ledger.
    const ledger = await api(BASE, `/api/conversations/${id}/ledger`);
    expect((ledger.body["entries"] as unknown[]).length).toBe(1);
  });

  it("reports rather than hides a candidate that drops a pinned requirement", async () => {
    const id = await conversationWithPrompt();
    await api(BASE, `/api/conversations/${id}/ledger`, {
      method: "POST",
      body: JSON.stringify({ text: "a requirement the stub model will never write" }),
    });
    const generated = await api(BASE, `/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ count: 2 }),
    });
    const candidates = generated.body["candidates"] as WireCandidate[];
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const diagnostics = candidate.preservation?.diagnostics as Array<{ code: string }>;
      expect(diagnostics[0]?.code).toBe("FORGE-W005");
    }
  });

  it("survives a refresh: candidates and promotions come back from the log", async () => {
    const id = await conversationWithPrompt();
    const generated = await api(BASE, `/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify({ count: 3 }),
    });
    const candidates = generated.body["candidates"] as WireCandidate[];
    await api(BASE, `/api/conversations/${id}/candidates/${candidates[0]!.id}/select`, { method: "POST" });

    const first = await api(BASE, `/api/conversations/${id}`);
    const second = await api(BASE, `/api/conversations/${id}`);
    expect(first.body).toEqual(second.body);
    expect((first.body["candidates"] as unknown[]).length).toBe(3);
    expect((first.body["candidatePromotions"] as unknown[]).length).toBe(1);
    const listed = await api(BASE, `/api/conversations/${id}/candidates`);
    expect((listed.body["candidates"] as unknown[]).length).toBe(3);
  });

  it("leaves the ordinary single-prompt workflow exactly as it was", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const v1 = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Write a code review prompt." }),
    });
    expect(v1.body["promptChanged"]).toBe(true);
    const v2 = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Add a security pass." }),
    });
    expect(v2.body["promptChanged"]).toBe(true);

    const detail = await api(BASE, `/api/conversations/${id}`);
    expect((detail.body["promptVersions"] as Array<{ v: number }>).map((v) => v.v)).toEqual([1, 2]);
    // No candidate was created along the way (WS-R8).
    expect(detail.body["candidates"]).toEqual([]);
    expect(detail.body["candidatePromotions"]).toEqual([]);
  });
});

/**
 * R4 (V2-R): a turn's diagnostics must reach the user, not just the event log.
 *
 * The audit found the whole chain already built — `pipeline.ts` produces the
 * findings, both message routes serialise them, `web/lib/api.ts` types them —
 * and then `Workspace.tsx` discarding the result with `void outcome`. Nothing
 * containing the word "diagnostic" existed in `ChatPanel.tsx`. So FORGE-W001
 * through W004 were computed, delivered, and thrown away at the last step.
 *
 * These tests hold the HTTP half of the contract: the finding is on the wire,
 * it carries its evidence, and it says the version was not written. The
 * rendering half is a browser check — this file cannot see a screen.
 */
describe.skipIf(!WEB_E2E)("turn diagnostics reach the client (V2-R, R4)", () => {
  /** Mirrors `STUB_UNREADABLE_SENTINEL` in `web/lib/turn/deps.ts`. */
  const UNREADABLE = "[[forge:stub-unreadable]]";

  beforeAll(async () => {
    await checkHealth(BASE);
  }, 60_000);

  it("delivers FORGE-W003 on a degraded turn, with its evidence", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const turn = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: `Write a review prompt. ${UNREADABLE}` }),
    });

    const diagnostics = turn.body["diagnostics"] as Array<Record<string, unknown>>;
    expect(Array.isArray(diagnostics)).toBe(true);
    const w003 = diagnostics.find((d) => d["code"] === "FORGE-W003");
    expect(w003, `no FORGE-W003 in ${JSON.stringify(diagnostics)}`).toBeDefined();
    expect(w003!["severity"]).toBe("warning");
    expect(w003!["source"]).toBe("deterministic");
    expect(String(w003!["message"])).toContain("envelope");

    // INV-007: a finding without evidence is not a finding, and a finding
    // whose evidence is stripped on the way to the screen is no better.
    const evidence = w003!["evidence"] as unknown[];
    expect(Array.isArray(evidence)).toBe(true);
    expect(evidence.length).toBeGreaterThan(0);
  });

  it("degrades to chat rather than writing a version from a response it could not read", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const turn = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: `Write a review prompt. ${UNREADABLE}` }),
    });
    expect(turn.body["promptChanged"]).toBe(false);
    const detail = await api(BASE, `/api/conversations/${id}`);
    expect(detail.body["promptVersions"]).toEqual([]);
    // The prose is still delivered — the degradation costs the version, not the answer.
    expect(String(turn.body["reply"]).length).toBeGreaterThan(0);
  });

  it("carries the same diagnostics over the streaming route", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const response = await fetch(`${BASE}/api/conversations/${id}/messages/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `Write a review prompt. ${UNREADABLE}` }),
    });
    const body = await response.text();
    const result = body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
      .find((frame) => frame["type"] === "result");

    expect(result, "the stream ended without a result frame").toBeDefined();
    const diagnostics = result!["diagnostics"] as Array<Record<string, unknown>>;
    expect(diagnostics.map((d) => d["code"])).toContain("FORGE-W003");
    // Both routes must agree: a user who happens to be on the streaming path
    // does not get a quieter product.
    expect(result!["promptChanged"]).toBe(false);
  });

  it("emits no diagnostics on an ordinary healthy turn", async () => {
    const created = await api(BASE, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.body["id"] as string;
    const turn = await api(BASE, `/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "Write a code review prompt." }),
    });
    // The surface must stay quiet when nothing degraded, or users learn to
    // ignore it and the whole exercise is self-defeating.
    expect(turn.body["diagnostics"]).toEqual([]);
    expect(turn.body["promptChanged"]).toBe(true);
  });
});
