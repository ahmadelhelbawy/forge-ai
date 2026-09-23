#!/usr/bin/env node
/**
 * Product Sprint 2 — live-provider acceptance (opt-in, never in CI).
 *
 * Drives a RUNNING FORGE server's own HTTP routes against the provider already
 * configured in its data directory, and writes what came back to
 * `evals/sprint2/live/`. Nothing here is a mock and nothing here reads or prints
 * a credential: the server holds the keys; this script only names a provider
 * and a model.
 *
 *   FORGE_URL=http://localhost:3001 node evals/sprint2/live-acceptance.mjs [step…]
 *
 * Steps: paste, modes, direct, kinds, staged, compile, verify, reasoning, failure.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env["FORGE_URL"] ?? "http://localhost:3001";
const FAST = { provider: "opencode-go", model: process.env["FORGE_FAST_MODEL"] ?? "kimi-k3" };
const OUT = join(process.cwd(), "evals", "sprint2", "live");
mkdirSync(OUT, { recursive: true });

const PASTED = `You are a senior code reviewer for a TypeScript monorepo.

## Rules
- Never approve a change that deletes a test.
- Cite a file path and line number for every finding.
- Flag any new dependency and say why it is needed.

## Output format
A markdown list of findings, most severe first, then a one-line verdict.
Keep the whole review under 400 words and do not restate the diff.

## Context
The repository uses strict TypeScript, pnpm workspaces and vitest.`;

async function call(method, path, body) {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, ms: Date.now() - started, json };
}

const results = [];
function check(step, name, ok, detail = "") {
  results.push({ step, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${step}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function save(name, value) {
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

async function create(extra = {}) {
  const { json } = await call("POST", "/api/conversations", { title: "sprint2", target: "claude-code", ...FAST, ...extra });
  return json.id;
}
const turn = (id, body) => call("POST", `/api/conversations/${id}/messages`, { ...FAST, ...body });
const get = async (id) => (await call("GET", `/api/conversations/${id}`)).json;
const callsOf = (convo, turnId) =>
  convo.turnEvents.filter((e) => e.turnId === turnId && e.kind === "model_call").map((e) => e.boundaryId);
const codes = (t) => (t.json.diagnostics ?? []).map((d) => d.code);

const steps = {
  async paste() {
    const id = await create();
    const t = await turn(id, { content: `Can you improve this prompt?\n\n${PASTED}` });
    const c = await get(id);
    save("paste-refine", { status: t.status, ms: t.ms, action: t.json.action, reply: t.json.reply, discovery: c.discovery, calls: callsOf(c, t.json.turnId) });
    check("paste", "a pasted prompt opens refine discovery", t.json.action === "DISCOVER" && c.discovery?.flavor === "refine", `${t.ms}ms`);
    check("paste", "no classification call", !callsOf(c, t.json.turnId).includes("conversation.classify"), callsOf(c, t.json.turnId).join(","));
    check("paste", "at most two questions", (c.discovery?.questions.length ?? 9) <= 2, `${c.discovery?.questions.length} asked`);
    check("paste", "no version written", c.promptVersions.length === 0);
    return id;
  },

  async modes(id) {
    id ??= await steps.paste();
    await call("POST", `/api/conversations/${id}/ledger`, { text: "Never approve a change that deletes a test" });
    const out = {};
    for (const mode of ["polish", "strengthen", "rebuild"]) {
      const t = await turn(id, { generate: true, mode });
      const v = t.json.version;
      out[mode] = { status: t.status, ms: t.ms, v: v?.v, recordedMode: v?.mode, chars: v?.text.length, preservation: t.json.preservation, diagnostics: codes(t), text: v?.text };
      check("modes", `${mode} writes a version recording the mode`, v?.mode === mode, `v${v?.v}, ${v?.text.length} chars, ${t.ms}ms`);
      check("modes", `${mode} keeps the pinned requirement (Layer 1)`, !codes(t).includes("FORGE-W005"), codes(t).join(",") || "no findings");
    }
    const lengths = ["polish", "strengthen", "rebuild"].map((m) => out[m].chars);
    save("modes", out);
    check("modes", "the three modes produced three distinct texts", new Set(["polish", "strengthen", "rebuild"].map((m) => out[m].text)).size === 3, `lengths ${lengths.join("/")}`);
    return id;
  },

  async direct() {
    const id = await create();
    const t = await turn(id, { content: `Just improve it and compile this for Codex.\n\n${PASTED}` });
    const c = await get(id);
    save("direct", { status: t.status, ms: t.ms, action: t.json.action, target: c.target, reply: t.json.reply, diagnostics: t.json.diagnostics, version: t.json.version, calls: callsOf(c, t.json.turnId) });
    check("direct", "'just improve it' writes directly", t.json.action === "CREATE" && t.json.version !== null, `${t.ms}ms`);
    check("direct", "no classification call", !callsOf(c, t.json.turnId).includes("conversation.classify"));
    check("direct", "W012 names the assumed choices", codes(t).includes("FORGE-W012"));
    check("direct", "the named target was applied", c.target === "openai-codex", c.target);
  },

  async kinds() {
    const idea = "an agent that triages new GitHub issues for a small open-source project: labels them, spots duplicates and asks reporters for a reproduction";
    const out = {};
    for (const kind of ["agent", "builder"]) {
      const id = await create();
      await call("PATCH", `/api/conversations/${id}`, { artifactKind: kind });
      const t = await turn(id, { generate: true, content: `Write the prompt for ${idea}.` });
      out[kind] = { status: t.status, ms: t.ms, text: t.json.version?.text, reply: t.json.reply };
    }
    save("kinds", out);
    const agent = out.agent.text ?? "";
    const builder = out.builder.text ?? "";
    check("kinds", "agent kind writes the agent's own prompt", /\byou are\b/i.test(agent.slice(0, 400)), agent.slice(0, 80).replace(/\n/g, " "));
    check("kinds", "builder kind writes build instructions", /\b(build|implement|tests?|repository|files?)\b/i.test(builder) && builder !== agent, builder.slice(0, 80).replace(/\n/g, " "));
  },

  async staged() {
    const id = await create();
    await call("PATCH", `/api/conversations/${id}`, { outputShape: "staged", artifactKind: "builder" });
    await call("POST", `/api/conversations/${id}/ledger`, { text: "zero downtime" });
    const t = await turn(id, {
      generate: true,
      content: "Write the prompt: migrate a Django app from PostgreSQL 12 to 16 with zero downtime, including a rollback plan and verification.",
    });
    const c = await get(id);
    save("staged", { status: t.status, ms: t.ms, diagnostics: t.json.diagnostics, stages: c.stages, text: t.json.version?.text });
    check("staged", "the version parses as ordered stages", c.stages?.ok === true, c.stages?.ok ? `${c.stages.stages.length} stages` : c.stages?.reason);
    const carry = c.stages?.ok ? c.stages.carry.find((x) => x.text === "zero downtime") : null;
    check("staged", "the pinned requirement is carried by named stages", Boolean(carry && carry.stages.length > 0), carry ? `stages ${carry.stages.join(",")}` : "none");
    check("staged", "no W013", !codes(t).includes("FORGE-W013"));
  },

  async compile(id) {
    id ??= await steps.modes();
    const t = await call("POST", `/api/conversations/${id}/compile`, { targets: ["claude-code", "openai-codex", "kiro"] });
    save("compile-multi", {
      status: t.status,
      ms: t.ms,
      results: (t.json.results ?? []).map((r) => ({ target: r.target, extracted: r.extracted, refused: r.refused, semanticHash: r.semanticHash, artifacts: r.artifacts.map((a) => ({ path: a.path, contentHash: a.contentHash, bytes: a.bytes })), diagnostics: r.diagnostics.map((d) => d.code) })),
    });
    const results = t.json.results ?? [];
    check("compile", "three targets compiled", results.length === 3, `${t.ms}ms`);
    check("compile", "at most one IR extraction", results.filter((r) => r.extracted).length <= 1);
    check("compile", "one semantic hash, per-target artifacts", new Set(results.map((r) => r.semanticHash)).size === 1 && new Set(results.map((r) => r.artifacts.map((a) => a.path).join())).size >= 2);
    const single = await call("POST", `/api/conversations/${id}/compile`, { target: "openai-codex" });
    const multiCodex = results.find((r) => r.target === "openai-codex");
    check("compile", "multi-target codex output equals a single-target compile", JSON.stringify(single.json.artifacts?.map((a) => a.contentHash)) === JSON.stringify(multiCodex?.artifacts.map((a) => a.contentHash)));
    return id;
  },

  async verify(id) {
    id ??= await steps.compile();
    const pkg = await call("POST", `/api/conversations/${id}/package`, { target: "claude-code" });
    const verification = JSON.parse(pkg.json.files.find((f) => f.path === "verification.json").content);
    const obligations = verification.entries ?? [];
    const evidence = {
      records: obligations
        .filter((o) => o.kind === "command" || o.kind === "test")
        .map((o) => ({
          obligation_id: o.id,
          kind: o.kind,
          exit_code: 0,
          stdout_hash: null,
          stderr_hash: null,
          started_at: "2026-09-23T00:00:00Z",
          duration_ms: 1,
          runner: "sprint2-live",
          repo_commit: null,
          package_semantic_id: pkg.json.semanticId,
        })),
    };
    const v = await call("POST", `/api/conversations/${id}/verify`, { target: "claude-code", evidence: JSON.stringify(evidence) });
    const reloaded = await get(id);
    save("package-verify", { package: { semanticId: pkg.json.semanticId, files: pkg.json.files.map((f) => f.path) }, obligations, verify: { status: v.status, error: v.json.error, verdicts: v.json.verdicts, evidenceKept: v.json.evidenceKept }, persisted: reloaded.verifications });
    check("verify", "the package builds", pkg.status === 200, `${pkg.json.files?.length} files`);
    check("verify", "every obligation gets one verdict", v.status === 200 && (v.json.verdicts ?? []).length === obligations.length, `${obligations.length} obligations`);
    check("verify", "the verification persists across a reload", reloaded.verifications?.length >= 1);
    const trace = await call("POST", `/api/conversations/${id}/traceability`, { target: "claude-code" });
    check("verify", "the traceability matrix still builds", trace.status === 200, `${trace.json.rows?.length ?? 0} rows`);
  },

  async reasoning() {
    const or = await call("GET", "/api/settings/reasoning?provider=openrouter&model=nvidia/nemotron-3-ultra-550b-a55b:free");
    const qwen = await call("GET", "/api/settings/reasoning?provider=opencode-go&model=qwen3.8-flash");
    const luna = await call("GET", "/api/settings/reasoning?provider=opencode-go&model=gpt-5.6-luna");
    check("reasoning", "OpenRouter support is discovered", or.json.supported === true && or.json.source === "discovered");
    check("reasoning", "an undocumented model is unsupported, with a reason", qwen.json.supported === false && Boolean(qwen.json.reason), qwen.json.reason);
    check("reasoning", "a declared Responses model is supported", luna.json.supported === true && luna.json.wire === "openai-responses");

    // Free upstreams are often overloaded; try a few models that OpenRouter
    // itself lists as accepting `reasoning`, and record which one answered.
    const candidates = (process.env["FORGE_REASONING_MODELS"] ?? "nvidia/nemotron-3-super-120b-a12b:free,z-ai/glm-5.2:free,nvidia/nemotron-3-ultra-550b-a55b:free").split(",");
    let id;
    let t;
    let model;
    const attempts = [];
    for (model of candidates) {
      id = await create({ provider: "openrouter", model });
      t = await call("POST", `/api/conversations/${id}/messages`, {
        provider: "openrouter",
        model,
        reasoningEffort: "low",
        content: "In two sentences: what makes a good code-review prompt?",
      });
      attempts.push({ model, status: t.status, error: t.json.error ?? null });
      if (t.status === 200) break;
    }
    const c = await get(id);
    const events = c.turnEvents.filter((e) => e.kind === "model_call");
    save("reasoning", { availability: { openrouter: or.json, qwen: qwen.json, luna: luna.json }, attempts, model, turn: { status: t.status, ms: t.ms, action: t.json.action, reply: t.json.reply, error: t.json.error }, modelCallEvents: events });
    check("reasoning", "a turn with effort on a supported model succeeds", t.status === 200, `${t.status} ${t.ms}ms ${t.json.error ?? ""}`);
    check("reasoning", "the effort is recorded on the model-call events", events.length > 0 && events.every((e) => e.reasoningEffort === "low"));

    const refused = await create({ provider: "opencode-go", model: "qwen3.8-flash" });
    const r = await call("POST", `/api/conversations/${refused}/messages`, { provider: "opencode-go", model: "qwen3.8-flash", reasoningEffort: "high", content: "hello" });
    const rc = await get(refused);
    save("reasoning-refused", { status: r.status, error: r.json.error, messages: rc.messages.length, modelCalls: rc.modelCalls.length });
    check("reasoning", "an effort for an unsupported model is refused before any call", r.status === 400 && rc.modelCalls.length === 0, r.json.error);
  },

  async failure() {
    const id = await create({ provider: "openrouter", model: "no-such-vendor/no-such-model" });
    const t = await call("POST", `/api/conversations/${id}/messages`, { provider: "openrouter", model: "no-such-vendor/no-such-model", content: "hello" });
    const c = await get(id);
    save("provider-failure", { status: t.status, error: t.json.error, messages: c.messages.map((m) => m.role), versions: c.promptVersions.length });
    check("failure", "a provider failure is reported, not blank", t.status >= 400 && Boolean(t.json.error), `${t.status}: ${(t.json.error ?? "").slice(0, 120)}`);
    check("failure", "the conversation is intact, nothing written", c.promptVersions.length === 0 && c.messages.every((m) => m.role === "user"));
  },
};

const wanted = process.argv.slice(2);
const order = wanted.length > 0 ? wanted : ["paste", "modes", "direct", "kinds", "staged", "compile", "verify", "reasoning", "failure"];
let shared;
for (const name of order) {
  try {
    const needsId = ["modes", "compile", "verify"].includes(name);
    const value = await steps[name](needsId ? shared : undefined);
    if (typeof value === "string") shared = value;
  } catch (error) {
    check(name, "step threw", false, error instanceof Error ? error.message : String(error));
  }
}
save(`summary${wanted.length ? `-${wanted.join("-")}` : ""}`, results);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
