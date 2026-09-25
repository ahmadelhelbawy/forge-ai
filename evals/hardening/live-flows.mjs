// Live acceptance for the pre-release hardening pass: flows B–F and J over
// real HTTP against a running FORGE with a real provider. Writes every
// generated prompt and the diagnostics to evals/hardening/out/ for review.
//
//   BASE=http://localhost:3300 node evals/hardening/live-flows.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3300";
const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body) });

async function conversation(title) {
  const r = await post("/api/conversations", { title });
  return r.body.id;
}

async function turn(id, body) {
  const started = Date.now();
  const r = await post(`/api/conversations/${id}/messages`, body);
  return { ...r, seconds: Math.round((Date.now() - started) / 1000) };
}

const EXISTING = `# Role
You are a code review assistant for a Python team.

## Task
Review pull requests and leave comments.

## Rules
- Point out bugs and style issues.
- Be concise.
- Never approve a PR that has failing tests.
- Flag any use of eval() or exec().

## Output
A list of comments with file and line.`;

const results = [];
function record(flow, data) {
  results.push({ flow, ...data });
  writeFileSync(new URL(`${flow}.json`, OUT), JSON.stringify(data, null, 2));
  console.log(`\n=== ${flow} ===\n${JSON.stringify(data.summary ?? data, null, 2)}`);
}

function codes(r) {
  return (r.body.diagnostics ?? []).map((d) => `${d.code}/${d.severity}`);
}

async function flowB() {
  const id = await conversation("B fast path strengthen");
  const first = await turn(id, { content: EXISTING });
  const detail = (await api(`/api/conversations/${id}`)).body;
  const gen = await turn(id, { generate: true, mode: "strengthen" });
  record("B", {
    summary: {
      intakeQuestions: detail.discovery?.questions?.length,
      flavor: detail.discovery?.flavor,
      firstSeconds: first.seconds,
      genStatus: gen.status,
      genSeconds: gen.seconds,
      promptChanged: gen.body.promptChanged,
      diagnostics: codes(gen),
      promptChars: gen.body.prompt?.length,
    },
    reply: gen.body.reply,
    prompt: gen.body.prompt,
    discoveryAfter: (await api(`/api/conversations/${id}`)).body.discovery,
  });
  return id;
}

async function flowC() {
  const id = await conversation("C direct");
  const r = await turn(id, { content: `Just strengthen this, no questions:\n\n${EXISTING}` });
  record("C", {
    summary: { status: r.status, seconds: r.seconds, promptChanged: r.body.promptChanged, action: r.body.action, diagnostics: codes(r) },
    reply: r.body.reply,
    prompt: r.body.prompt,
  });
}

async function flowD(kind) {
  const id = await conversation(`D ${kind}`);
  await patch(`/api/conversations/${id}`, { artifactKind: kind });
  const r = await turn(id, {
    content:
      "Generate now, no questions: a support-triage agent for a 5-person SaaS company. It reads inbound emails, tags them (bug, billing, how-to, feature request), drafts a reply for how-to questions, and escalates billing to a human. It must never promise refunds.",
  });
  record(`D-${kind}`, {
    summary: { status: r.status, seconds: r.seconds, promptChanged: r.body.promptChanged, action: r.body.action, diagnostics: codes(r) },
    reply: r.body.reply,
    prompt: r.body.prompt,
  });
  return id;
}

async function flowE() {
  const id = await conversation("E staged");
  await patch(`/api/conversations/${id}`, { outputShape: "staged", artifactKind: "builder" });
  const r = await turn(id, {
    content:
      "Generate now, no questions: instructions for a coding agent to build a CLI that syncs Notion pages to Markdown files, with tests, in TypeScript.",
  });
  const detail = (await api(`/api/conversations/${id}`)).body;
  record("E", {
    summary: {
      status: r.status,
      seconds: r.seconds,
      diagnostics: codes(r),
      stages: detail.stages?.stages?.map((s) => `${s.n}: ${s.title}`) ?? detail.stages,
    },
    prompt: r.body.prompt,
  });
}

async function flowF(id) {
  const r = await post(`/api/conversations/${id}/compile`, { targets: ["claude-code", "opencode", "openai-codex"] });
  const results = r.body.results ?? r.body;
  record("F", {
    summary: {
      status: r.status,
      targets: Array.isArray(results)
        ? results.map((x) => ({ target: x.target, ok: x.ok ?? !x.error, bytes: JSON.stringify(x).length }))
        : Object.keys(r.body),
    },
    body: r.body,
  });
}

async function flowJ() {
  // A model id the provider does not have: a real 4xx from the real provider.
  const id = await conversation("J failure");
  const r = await turn(id, { content: "Write a haiku prompt.", provider: "opencode-go", model: "no-such-model-xyz" });
  const detail = (await api(`/api/conversations/${id}`)).body;
  record("J", {
    summary: {
      status: r.status,
      error: r.body.error ?? r.body.message,
      messagesKept: detail.messages?.length,
      blankAssistant: (detail.messages ?? []).some((m) => m.role === "assistant" && !String(m.content).trim()),
    },
  });
}

const only = process.argv[2];
const run = async (name, fn) => {
  if (only && !only.split(",").includes(name)) return;
  try {
    return await fn();
  } catch (e) {
    record(name, { summary: { crashed: String(e) } });
  }
};

const bId = await run("B", flowB);
await run("C", flowC);
const agentId = await run("D", async () => {
  const a = await flowD("agent");
  await flowD("builder");
  return a;
});
await run("E", flowE);
if (agentId) await run("F", () => flowF(agentId));
else if (bId) await run("F", () => flowF(bId));
await run("J", flowJ);
writeFileSync(new URL("summary.json", OUT), JSON.stringify(results.map((r) => ({ flow: r.flow, ...r.summary })), null, 2));
