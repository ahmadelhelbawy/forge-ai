#!/usr/bin/env node
/**
 * V2-E live acceptance smoke — the ONE outstanding gate.
 *
 * plan.md records every other V2-E gate as passed. What was never obtained is
 * a single clean live run in which ALL THREE requested candidates complete on
 * the concurrent implementation, together with live evidence for concurrency,
 * preservation, non-promotion, provenance, comparison, merge and a REAL
 * server restart on the same data directory.
 *
 * This harness drives the product's own HTTP surface. It asserts nothing about
 * the model's choices, only about FORGE's contract. It never prints the key.
 *
 * It deliberately does NOT weaken any product validation: a malformed
 * candidate is still expected to be dropped with FORGE-W003, and this script
 * reports that as a FAILED GATE rather than lowering the bar to 2 of 3.
 */
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function loadKeyFile() {
  const path = join(process.cwd(), ".env.smoke.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at === -1) continue;
    const name = trimmed.slice(0, at).trim();
    const value = trimmed.slice(at + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[name]) process.env[name] = value;
  }
}
loadKeyFile();

const KEY = process.env["FORGE_API_KEY"] ?? "";
const MODEL = process.env["FORGE_SMOKE_MODEL"] ?? "kimi-k3";
const REQUESTED_PROVIDER = process.env["FORGE_SMOKE_PROVIDER"] ?? "opencode";
const PORT = Number(process.env["FORGE_SMOKE_PORT"] ?? "3621");
const PROVIDER_ALIASES = { opencode: "opencode-go", "opencode-go": "opencode-go", zen: "opencode-go", kimi: "opencode-go" };

// Persistent for the length of the run, and NOT inside the repository.
//
// The restart gate kills the server and starts a second one on the SAME data
// directory, so this cannot be a directory the run deletes between the two —
// which is exactly what `live-smoke.mjs` does and why it cannot prove restart
// persistence. It is kept afterwards, and its path printed, so a failed run
// can be inspected.
const dataDir = process.env["FORGE_ACCEPT_DATA_DIR"] ?? mkdtempSync(join(tmpdir(), "forge-v2e-acceptance-"));
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const SERVER = "web/.next/standalone/web/server.js";
const base = `http://localhost:${PORT}`;
let server = null;
const failures = [];
const serverErrors = [];

function check(name, ok, detail) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

const HARNESS_TIMEOUT_MS = Number(process.env["FORGE_SMOKE_TIMEOUT_MS"] ?? "1200000");

function json(path, init) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${base}${path}`,
      { method: init?.method ?? "GET", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (c) => { text += c; });
        response.on("end", () => {
          const ms = Date.now() - started;
          try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(text), ms }); }
          catch { resolve({ status: response.statusCode ?? 0, body: {}, raw: text.slice(0, 800), ms }); }
        });
      },
    );
    req.setTimeout(HARNESS_TIMEOUT_MS, () => {
      req.destroy(new Error(`harness gave up after ${Math.round(HARNESS_TIMEOUT_MS / 1000)}s`));
    });
    req.on("error", reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
}

async function streamTurn(id, body) {
  const events = [];
  const deltas = [];
  let result = null;
  let failure = null;
  const response = await fetch(`${base}/api/conversations/${id}/messages/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) return { status: response.status, events, deltas, result, failure };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
      const payload = JSON.parse(line.slice(6));
      if (payload.type === "event") events.push(payload.event);
      else if (payload.type === "delta") deltas.push(payload);
      else if (payload.type === "result") result = payload;
      else if (payload.type === "failed") failure = payload;
    }
  }
  return { status: response.status, events, deltas, result, failure };
}

function startServer() {
  const env = { ...process.env, PORT: String(PORT), FORGE_DATA_DIR: dataDir, FORGE_CHAT_STUB: "" };
  delete env["FORGE_BASE_URL"];
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", (chunk) => {
    serverErrors.push(String(chunk));
    if (serverErrors.length > 200) serverErrors.shift();
  });
  return child;
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The server never became healthy.");
}

async function stopServer(child) {
  if (!child) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000);
  });
}

try {
  console.log(`==> V2-E acceptance: server on ${PORT}, provider "${REQUESTED_PROVIDER}", model "${MODEL}"`);
  console.log(`    data dir: ${dataDir}`);
  server = startServer();
  await waitForHealth();

  const registry = await json("/api/settings/providers");
  const known = registry.body.providers.map((e) => e.id);
  const PROVIDER =
    known.find((id) => id === REQUESTED_PROVIDER) ??
    known.find((id) => id === PROVIDER_ALIASES[REQUESTED_PROVIDER]) ??
    known.find((id) => id.startsWith(REQUESTED_PROVIDER)) ?? null;
  check("provider id resolves against the registry", PROVIDER !== null, `requested "${REQUESTED_PROVIDER}", known: ${known.join(", ")}`);
  if (!PROVIDER) throw new Error("No such provider.");
  if (PROVIDER !== REQUESTED_PROVIDER) console.log(`     ("${REQUESTED_PROVIDER}" resolved to "${PROVIDER}")`);

  const saved = await json(`/api/settings/providers/${encodeURIComponent(PROVIDER)}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey: KEY, defaultModel: MODEL }),
  });
  check("provider saved", saved.status === 200, `status ${saved.status}`);
  check("no credential in the settings response (WS-R16)", !JSON.stringify(saved.body).includes(KEY));
  const tested = await json(`/api/settings/providers/${encodeURIComponent(PROVIDER)}/test`, {
    method: "POST", body: JSON.stringify({ model: MODEL }),
  });
  check("provider connection test passes", tested.body.ok === true, String(tested.body.message ?? "").slice(0, 200));

  const created = await json("/api/conversations", {
    method: "POST", body: JSON.stringify({ target: "generic", provider: PROVIDER, model: MODEL }),
  });
  const id = created.body.id;
  check("conversation created", typeof id === "string");
  console.log(`     conversation ${id}`);

  // ── 1. a real base prompt to branch from ──────────────────────────────
  console.log("==> creating the base prompt with a real turn");
  //
  // Retried, and ONLY here. Creating the base prompt is a PREREQUISITE of the
  // gate, not part of it: when this model's classifier returns non-JSON, FORGE
  // correctly degrades the turn to DISCUSS (FORGE-W001, WS-R4) and then
  // correctly blocks the write (FORGE-W004, WS-R2) — both invariants holding,
  // and no base prompt to branch from. Retrying the prerequisite is not
  // retrying the gate; the candidate assertions below still get exactly one
  // attempt.
  let baseTurn = null;
  let baseV = null;
  for (let attempt = 1; attempt <= 3 && baseV === null; attempt++) {
    baseTurn = await streamTurn(id, {
      content:
        "Write a prompt for an agent that reviews Python pull requests. It must read the full diff before judging, run the test suite, and never approve a PR with failing tests.",
      provider: PROVIDER, model: MODEL,
    });
    baseV = baseTurn.result?.version?.v ?? null;
    if (baseV === null) {
      const why = (baseTurn.result?.diagnostics ?? []).map((d) => d.code).join(",") || (baseTurn.failure ? "transport" : "no version");
      console.log(`     attempt ${attempt}: no version (${why})${attempt < 3 ? " — retrying the prerequisite" : ""}`);
    }
  }
  check("the base turn completed", baseTurn?.result !== null && baseTurn?.failure === null,
    baseTurn?.failure ? JSON.stringify(baseTurn.failure).slice(0, 300) : "");
  check("it wrote a prompt version", baseV !== null, `v${baseV}`);
  if (baseV === null) throw new Error("No base prompt; the candidate gates cannot run.");

  // ── 2. pin a requirement from FORGE's own proposals ───────────────────
  console.log("==> pinning a requirement");
  const proposals = await json(`/api/conversations/${id}/ledger`);
  const PIN = (proposals.body.proposals ?? [])[0] ?? null;
  check("FORGE proposes a pin candidate from the real prompt", typeof PIN === "string" && PIN.length > 0);
  if (!PIN) throw new Error("No pin candidate.");
  console.log(`     pinning: "${PIN.slice(0, 100)}"`);
  const pinned = await json(`/api/conversations/${id}/ledger`, { method: "POST", body: JSON.stringify({ text: PIN }) });
  check("a requirement can be pinned", pinned.status === 201, `status ${pinned.status}`);
  const ledgerBefore = await json(`/api/conversations/${id}/ledger`);

  // ── 3. THE OUTSTANDING GATE: three candidates, all complete ───────────
  console.log("==> generating 3 alternatives from the §9 archetypes (the outstanding gate)");
  const before = (await json(`/api/conversations/${id}`)).body;
  const wallStart = Date.now();
  const generated = await json(`/api/conversations/${id}/candidates`, {
    method: "POST", body: JSON.stringify({ count: 3, provider: PROVIDER, model: MODEL }),
  });
  const candidateWallMs = Date.now() - wallStart;
  check("candidate generation succeeded", generated.status === 201,
    `${Math.round(candidateWallMs / 1000)}s; status ${generated.status}; ${generated.raw ? `non-JSON: ${generated.raw}` : JSON.stringify(generated.body).slice(0, 300)}`);
  const cands = generated.body.candidates ?? [];
  const diags = generated.body.diagnostics ?? [];

  // THE gate. Not lowered to >= 2.
  check("ALL THREE requested candidates completed (the outstanding V2-E gate)", cands.length === 3,
    `${cands.length}/3 candidates; diagnostics: ${diags.map((d) => `${d.code}:${String(d.message).slice(0, 160)}`).join(" | ") || "none"}`);
  for (const d of diags) console.log(`     dropped: ${d.code} — ${String(d.message).slice(0, 300)}`);
  if (cands.length < 2) {
    if (serverErrors.length) console.log(`     server said: ${serverErrors.join("").slice(-1500)}`);
    throw new Error(`Only ${cands.length} candidate(s); the downstream gates cannot run.`);
  }

  // ── 4. concurrency, measured ──────────────────────────────────────────
  console.log("==> concurrency evidence");
  const convoAfter = (await json(`/api/conversations/${id}`)).body;
  const callRecords = (convoAfter.modelCalls ?? []).filter((r) => r.boundaryId === "conversation.candidate");
  const latencies = callRecords.map((r) => r.latencyMs);
  const sequentialSum = latencies.reduce((a, b) => a + b, 0);
  const slowest = latencies.length ? Math.max(...latencies) : 0;
  console.log(`     candidate-phase wall: ${(candidateWallMs / 1000).toFixed(1)}s`);
  console.log(`     per-call latencies:   ${latencies.map((m) => (m / 1000).toFixed(1) + "s").join(", ") || "(no records exposed)"}`);
  console.log(`     sequential would be:  ${(sequentialSum / 1000).toFixed(1)}s   slowest single: ${(slowest / 1000).toFixed(1)}s`);
  if (latencies.length >= 2) {
    check("the candidate calls genuinely overlapped (wall < sequential sum)",
      candidateWallMs < sequentialSum * 0.9,
      `wall ${(candidateWallMs / 1000).toFixed(1)}s vs sequential ${(sequentialSum / 1000).toFixed(1)}s`);
    check("the phase took about as long as its slowest single call",
      candidateWallMs < slowest * 1.6 + 5000,
      `wall ${(candidateWallMs / 1000).toFixed(1)}s vs slowest ${(slowest / 1000).toFixed(1)}s`);
  } else {
    console.log("  ..    INCONCLUSIVE: model call records not exposed on this surface; see run log below");
  }

  // ── 5. the contract around the candidates ─────────────────────────────
  console.log("==> candidate contract");
  check("each alternative names the archetype it came from (ST-R7)",
    cands.every((c) => c.origin === "archetype" && typeof c.strategy === "string" && c.strategy.length > 0),
    cands.map((c) => `${c.strategy}/${c.origin}`).join(", "));
  check("each alternative carries the deciding rule (ST-R6)",
    cands.every((c) => typeof c.rationale === "string" && c.rationale.includes("Selected")));
  check("the overlays are pairwise distinct (§11.5)",
    (generated.body.overlayDistinctness?.rejected ?? []).length === 0,
    JSON.stringify(generated.body.overlayDistinctness?.rejected ?? []));
  check("a real model returned materially different prompts, not rewordings (FORGE-W007)",
    new Set(cands.map((c) => c.text)).size === cands.length);
  check("generating wrote no prompt version (WS-R8)", generated.body.versionCreated === false);
  const afterGen = (await json(`/api/conversations/${id}`)).body;
  check("the current prompt is untouched by generation (WS-R8)",
    afterGen.currentV === before.currentV && afterGen.promptVersions.length === before.promptVersions.length,
    `v${before.currentV} → v${afterGen.currentV}`);
  check("every candidate carries Layer 1's verdict, labelled (WS-R28)",
    cands.every((c) => c.preservation?.layer === "deterministic"));
  check("the pinned requirement survives verbatim in every candidate (WS-R24)",
    cands.every((c) => c.text.includes(PIN)),
    cands.map((c) => `${c.strategy}:${c.text.includes(PIN) ? "present" : "MISSING"}`).join(", "));
  check("no candidate Layer 1 finding names a version (the 2026-09-19 fix)",
    cands.every((c) => (c.preservation?.diagnostics ?? []).every((d) =>
      (d.evidence ?? []).every((e) => e.label !== "dropped_in_version"))),
    JSON.stringify(cands.flatMap((c) => (c.preservation?.diagnostics ?? []).flatMap((d) => (d.evidence ?? []).map((e) => e.label)))));
  check("generation cost one call per alternative and nothing else (WS-R13)",
    Number(generated.body.calls?.generation) === cands.length + diags.length,
    JSON.stringify(generated.body.calls));
  check("the ledger is byte-identical after generating (WS-R27)",
    JSON.stringify((await json(`/api/conversations/${id}/ledger`)).body.entries) === JSON.stringify(ledgerBefore.body.entries));

  // ── 6. comparison ─────────────────────────────────────────────────────
  console.log("==> comparing two live alternatives");
  const compared = await json(`/api/conversations/${id}/candidates/compare?a=${encodeURIComponent(cands[0].id)}&b=${encodeURIComponent(cands[1].id)}`);
  check("the comparison succeeded", compared.status === 200, JSON.stringify(compared.body).slice(0, 200));
  check("it shows content unique to each side",
    compared.body.divergence?.uniqueToA > 0 && compared.body.divergence?.uniqueToB > 0,
    JSON.stringify(compared.body.divergence));
  check("it is deterministic, not judged (WS-R28)", compared.body.layer === "deterministic");

  // ── 7. promotion and merge ────────────────────────────────────────────
  console.log("==> promoting one alternative, then merging two");
  const beforePromote = (await json(`/api/conversations/${id}`)).body;
  const promoted = await json(`/api/conversations/${id}/candidates/${encodeURIComponent(cands[0].id)}/select`, {
    method: "POST", body: JSON.stringify({}),
  });
  check("promotion succeeded", promoted.status === 201, `status ${promoted.status} ${JSON.stringify(promoted.body).slice(0, 200)}`);
  const afterPromote = (await json(`/api/conversations/${id}`)).body;
  check("promotion wrote exactly one new version (WS-R7)",
    afterPromote.promptVersions.length === beforePromote.promptVersions.length + 1,
    `${beforePromote.promptVersions.length} → ${afterPromote.promptVersions.length}`);
  check("promotion left every earlier version byte-identical (WS-R17)",
    JSON.stringify(afterPromote.promptVersions.slice(0, beforePromote.promptVersions.length)) ===
      JSON.stringify(beforePromote.promptVersions));
  check("the choice was recorded (ST-R6)", afterPromote.candidatePromotions.length === 1,
    JSON.stringify(afterPromote.candidatePromotions).slice(0, 250));

  const merged = await json(`/api/conversations/${id}/candidates/merge`, {
    method: "POST", body: JSON.stringify({ refs: [cands[1].id, cands[cands.length - 1].id] }),
  });
  check("merge succeeded", merged.status === 201,
    `status ${merged.status} ${JSON.stringify(merged.body).slice(0, 300)}`);
  const mergedText = merged.body.version?.text ?? merged.body.prompt ?? "";
  const blocksOf = (t) => t.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const srcA = blocksOf(cands[1].text);
  const srcB = blocksOf(cands[cands.length - 1].text);
  const mergedBlocks = new Set(blocksOf(mergedText));
  const missing = [...srcA, ...srcB].filter((b) => !mergedBlocks.has(b));
  check("the merge dropped nothing either alternative said (deterministic union)",
    missing.length === 0, `${missing.length} missing block(s)` + (missing.length ? `: ${missing[0].slice(0, 120)}` : ""));
  check("the merge kept the pinned requirement", mergedText.includes(PIN));
  check("the merge action is MERGE", merged.body.version?.action === "MERGE", String(merged.body.version?.action));
  check("the merge reports its per-source contributions", Object.keys(merged.body.merge?.contributions ?? {}).length >= 2, JSON.stringify(merged.body.merge?.contributions));
  check("the ledger is still byte-identical after promote+merge (WS-R27)",
    JSON.stringify((await json(`/api/conversations/${id}/ledger`)).body.entries) === JSON.stringify(ledgerBefore.body.entries));

  // ── 8. truthful provider/model metadata ───────────────────────────────
  console.log("==> provider/model metadata truthfulness");
  const finalConvo = (await json(`/api/conversations/${id}`)).body;
  check("the conversation reports the provider actually used", finalConvo.provider === PROVIDER, String(finalConvo.provider));
  check("the conversation reports the model actually used", finalConvo.model === MODEL, String(finalConvo.model));
  const candRecords = (finalConvo.modelCalls ?? []).filter((r) => r.boundaryId === "conversation.candidate");
  check("every candidate call record names the real provider and model, none replayed",
    candRecords.length > 0 && candRecords.every((r) => r.provider === PROVIDER && r.model === MODEL && r.replayed === false),
    `${candRecords.length} records`);
  check("no credential on any surface (WS-R16)",
    [JSON.stringify(finalConvo), JSON.stringify(generated.body), JSON.stringify(merged.body),
     JSON.stringify((await json("/api/settings/providers")).body)].every((t) => !t.includes(KEY)));

  // snapshot for the restart comparison
  const snapshotBefore = JSON.stringify({
    candidates: finalConvo.candidates,
    promotions: finalConvo.candidatePromotions,
    versions: finalConvo.promptVersions,
    currentV: finalConvo.currentV,
    ledger: (await json(`/api/conversations/${id}/ledger`)).body.entries,
  });

  // ── 9. REAL restart on the same data directory ────────────────────────
  console.log("==> restarting the server on the same data directory");
  await stopServer(server);
  server = null;
  await new Promise((r) => setTimeout(r, 1500));
  server = startServer();
  await waitForHealth();
  const reread = (await json(`/api/conversations/${id}`)).body;
  const snapshotAfter = JSON.stringify({
    candidates: reread.candidates,
    promotions: reread.candidatePromotions,
    versions: reread.promptVersions,
    currentV: reread.currentV,
    ledger: (await json(`/api/conversations/${id}/ledger`)).body.entries,
  });
  check("candidates, promotions, versions and ledger survive a REAL restart unchanged (WS-R17)",
    snapshotBefore === snapshotAfter,
    `${reread.candidates?.length ?? 0} candidates, ${reread.candidatePromotions?.length ?? 0} promotions, v${reread.currentV}`);
  check("every candidate's provenance survived the restart (ST-R7)",
    (reread.candidates ?? []).every((c) => c.origin === "archetype" && c.strategy && c.rationale));

  // ── 10. index is derivable (AC-032) ───────────────────────────────────
  console.log("==> rebuilding the derivable index from the append-only log (AC-032)");
  const indexPath = join(dataDir, "index.sqlite");
  let digestBefore = null, digestAfter = null;
  if (existsSync(indexPath)) {
    const { createHash } = await import("node:crypto");
    digestBefore = createHash("sha256").update(readFileSync(indexPath)).digest("hex");
    await stopServer(server); server = null;
    rmSync(indexPath, { force: true });
    server = startServer();
    await waitForHealth();
    await json(`/api/conversations/${id}`);
    await new Promise((r) => setTimeout(r, 1000));
    digestAfter = createHash("sha256").update(readFileSync(indexPath)).digest("hex");
    check("deleting and rebuilding the index reproduces it byte for byte (AC-032)",
      digestBefore === digestAfter, `${String(digestBefore).slice(0, 12)}… vs ${String(digestAfter).slice(0, 12)}…`);
  } else {
    console.log("  ..    index.sqlite not found at the expected path; skipped");
  }

  console.log("");
  console.log(failures.length === 0 ? "V2-E LIVE ACCEPTANCE: PASS" : `V2-E LIVE ACCEPTANCE: FAIL (${failures.join(" | ")})`);
} catch (error) {
  console.log("");
  console.log(`V2-E LIVE ACCEPTANCE: ABORTED — ${error?.message ?? error}`);
  if (serverErrors.length) console.log(`server said: ${serverErrors.join("").slice(-2000)}`);
  failures.push("aborted");
} finally {
  await stopServer(server);
  console.log(`(data directory kept for inspection: ${dataDir})`);
}
process.exit(failures.length === 0 ? 0 : 1);
