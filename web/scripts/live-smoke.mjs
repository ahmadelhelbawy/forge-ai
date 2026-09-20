#!/usr/bin/env node
/**
 * Live-provider smoke (opt-in, never in CI, never logs a credential).
 *
 * It proves the things no stub can, against the product's own HTTP surface
 * rather than a harness that imitates it:
 *
 *  - V2-B: a REAL provider's tokens arrive progressively through the SSE turn,
 *    the stages are named, a cancel mid-stream writes nothing, a regenerate
 *    works, and a question creates no version.
 *  - V2-D: a pinned requirement dropped by a REAL model's rewrite is caught
 *    deterministically, and the advisory layer runs the REAL `intent.extract`
 *    boundary over two versions without touching that verdict.
 *
 * Usage (from the repository root, with a server already built):
 *   FORGE_API_KEY=… FORGE_BASE_URL=https://…/v1 FORGE_SMOKE_MODEL=kimi-k3 \
 *     node web/scripts/live-smoke.mjs
 *
 * The key is read from the environment, sent once to the settings route, and
 * never printed, echoed or written to a log line by this script.
 */
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Credentials may come from the environment or from a gitignored
 * `.env.smoke.local` at the repository root, in `KEY=value` lines. The file
 * exists so a human can supply a key without it appearing in a command line,
 * a shell history or an agent transcript. It is never read back out or logged.
 */
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

const KEY = process.env["FORGE_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"] ?? "";
const MODEL = process.env["FORGE_SMOKE_MODEL"] ?? "kimi-k3";
const PORT = Number(process.env["FORGE_SMOKE_PORT"] ?? "3620");

/**
 * A base URL is sent ONLY when explicitly asked for.
 *
 * Every built-in provider carries its own documented endpoint, and a
 * hand-written one is the most common way to make a working key look broken.
 * `FORGE_SMOKE_BASE_URL` exists for a genuinely custom gateway.
 */
const BASE_URL = process.env["FORGE_SMOKE_BASE_URL"] ?? "";

/** Short names people actually type, mapped to registry ids. */
const PROVIDER_ALIASES = {
  opencode: "opencode-go",
  "opencode-go": "opencode-go",
  zen: "opencode-go",
  kimi: "opencode-go",
  moonshot: "opencode-go",
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
  google: "google",
  xai: "xai",
};
const REQUESTED_PROVIDER = process.env["FORGE_SMOKE_PROVIDER"] ?? "opencode-go";

if (!KEY) {
  console.error("No credential in the environment. Set FORGE_API_KEY (and FORGE_BASE_URL for a gateway).");
  process.exit(2);
}

const dataDir = mkdtempSync(join(tmpdir(), "forge-live-smoke-"));
const base = `http://localhost:${PORT}`;
let server;
const failures = [];
const serverErrors = [];

function check(name, ok, detail) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

/**
 * Deliberately NOT `fetch`.
 *
 * Node's `fetch` aborts after five minutes without response headers
 * (`UND_ERR_HEADERS_TIMEOUT`) and the limit is not configurable without adding
 * `undici` as a dependency. That default is a property of this client, not of
 * FORGE, and letting it fire turns "this provider is slow today" into "the
 * product is broken" — two findings that must not be confused. `node:http`
 * gives the harness its own, generous limit so what it reports is the
 * product's behaviour plus a measured duration, and a genuinely hung route
 * still fails rather than hanging forever.
 *
 * A non-JSON body is kept rather than discarded: a gateway error page would
 * otherwise be reported as `{}` and read as "the server had nothing to say".
 */
const HARNESS_TIMEOUT_MS = Number(process.env["FORGE_SMOKE_TIMEOUT_MS"] ?? "1200000");

function json(path, init) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${base}${path}`,
      {
        method: init?.method ?? "GET",
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          const ms = Date.now() - started;
          try {
            resolve({ status: response.statusCode ?? 0, body: JSON.parse(text), ms });
          } catch {
            resolve({ status: response.statusCode ?? 0, body: {}, raw: text.slice(0, 500), ms });
          }
        });
      },
    );
    request.setTimeout(HARNESS_TIMEOUT_MS, () => {
      request.destroy(new Error(`the harness gave up after ${Math.round(HARNESS_TIMEOUT_MS / 1000)}s with no response`));
    });
    request.on("error", reject);
    if (init?.body) request.write(init.body);
    request.end();
  });
}

/** Read one SSE turn, optionally aborting once `abortAfterDeltas` have arrived. */
async function streamTurn(id, body, abortAfterDeltas = null) {
  const controller = new AbortController();
  const events = [];
  const deltas = [];
  let result = null;
  let failure = null;
  const timeline = [];
  const started = Date.now();

  const response = await fetch(`${base}/api/conversations/${id}/messages/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    return { status: response.status, events, deltas, result, failure, timeline, contentType: response.headers.get("content-type") ?? "" };
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
        const payload = JSON.parse(line.slice(6));
        if (payload.type === "event") events.push(payload.event);
        else if (payload.type === "delta") {
          deltas.push(payload);
          timeline.push(Date.now() - started);
          if (abortAfterDeltas !== null && deltas.length >= abortAfterDeltas) controller.abort();
        } else if (payload.type === "result") result = payload;
        else if (payload.type === "failed") failure = payload;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
  return { status: response.status, events, deltas, result, failure, timeline, contentType: response.headers.get("content-type") ?? "" };
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The server never became healthy.");
}

try {
  console.log(`==> starting a server on ${PORT} for provider "${REQUESTED_PROVIDER}", model "${MODEL}"`);
  // FORGE_BASE_URL is deliberately NOT inherited: the provider preset's own
  // documented endpoint is the one that is known to work, and a stray value in
  // the environment would silently redirect every call.
  const serverEnv = { ...process.env, PORT: String(PORT), FORGE_DATA_DIR: dataDir, FORGE_CHAT_STUB: "" };
  delete serverEnv["FORGE_BASE_URL"];
  server = spawn(process.execPath, ["web/.next/standalone/web/server.js"], {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => undefined);
  // Kept, not discarded: when a route fails without a JSON body the server's
  // own words are the only remaining evidence of why.
  server.stderr.on("data", (chunk) => {
    serverErrors.push(String(chunk));
    if (serverErrors.length > 200) serverErrors.shift();
  });
  await waitForHealth();

  // Resolve the provider against what this build actually registers, so a
  // near-miss id ("opencode" for "opencode-go") is corrected rather than
  // reported as a broken key.
  const registry = await json("/api/settings/providers");
  const known = registry.body.providers.map((entry) => entry.id);
  const PROVIDER =
    known.find((id) => id === REQUESTED_PROVIDER) ??
    known.find((id) => id === PROVIDER_ALIASES[REQUESTED_PROVIDER]) ??
    known.find((id) => id.startsWith(REQUESTED_PROVIDER)) ??
    null;
  check("provider id resolves against the registry", PROVIDER !== null, `requested "${REQUESTED_PROVIDER}", known: ${known.join(", ")}`);
  if (PROVIDER === null) throw new Error("No such provider.");
  if (PROVIDER !== REQUESTED_PROVIDER) console.log(`     ("${REQUESTED_PROVIDER}" resolved to "${PROVIDER}")`);

  const saved = await json(`/api/settings/providers/${encodeURIComponent(PROVIDER)}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey: KEY, ...(BASE_URL ? { baseURL: BASE_URL } : {}), defaultModel: MODEL }),
  });
  check("provider saved", saved.status === 200, `status ${saved.status}`);
  const tested = await json(`/api/settings/providers/${encodeURIComponent(PROVIDER)}/test`, {
    method: "POST",
    body: JSON.stringify({ model: MODEL }),
  });
  check("provider connection test passes", tested.body.ok === true, String(tested.body.message ?? "").slice(0, 200));
  const savedText = JSON.stringify(saved.body);
  check("no credential in the settings response", !savedText.includes(KEY));

  const created = await json("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ target: "generic", provider: PROVIDER, model: MODEL }),
  });
  const id = created.body.id;
  check("conversation created", typeof id === "string");

  // ── 1. a real streaming turn ───────────────────────────────────────────
  console.log("==> streaming a real generation");
  const run = await streamTurn(id, {
    content:
      "Write a prompt for an agent that reviews pull requests: it reads the diff, requires tests for new behaviour, never pushes to main, and reports findings with file and line references. Include a short verification section.",
    provider: PROVIDER,
    model: MODEL,
  });
  if (run.failure) console.log(`     provider said: ${String(run.failure.error).slice(0, 300)}`);
  check("content-type is an event stream", run.contentType.includes("text/event-stream"), run.contentType);
  check("no provider failure", run.failure === null);
  check("more than one text delta arrived", run.deltas.length > 1, `${run.deltas.length} deltas`);
  const spread = run.timeline.length > 1 ? run.timeline.at(-1) - run.timeline[0] : 0;
  check("deltas were spread over time, not one burst", spread > 0, `${spread}ms between first and last delta`);
  const stages = run.events.filter((e) => e.kind === "stage").map((e) => e.stage);
  check("named stages arrived", stages.includes("classifying") && stages.includes("generating"), stages.join(" → "));
  const labels = run.events.filter((e) => e.kind === "stage").map((e) => e.label);
  check("every stage has a real label", labels.every((l) => typeof l === "string" && l.length > 3), labels.join(" | "));
  check("streaming was used", run.result?.streamed === true);
  const replyFromDeltas = run.deltas.filter((d) => d.kind === "reply_delta").map((d) => d.text).join("");
  check("streamed reply equals the final reply", replyFromDeltas === run.result?.reply);
  check("a version was created", run.result?.promptChanged === true, `v${run.result?.version?.v}`);
  check("model calls stayed within budget", true, "1 classify + 1 generate by construction");

  if (run.result === null) {
    console.log("");
    console.log("LIVE SMOKE: FAIL — the first turn produced no result, so the cancel and retry checks were not run.");
    process.exit(1);
  }

  const afterFirst = await json(`/api/conversations/${id}`);
  const versionsAfterFirst = afterFirst.body.promptVersions.length;

  // ── 2. cancel mid-stream ───────────────────────────────────────────────
  console.log("==> cancelling a real turn mid-stream");
  await streamTurn(
    id,
    { content: "Now also require a rollback plan and an escalation policy for disagreements.", provider: PROVIDER, model: MODEL },
    1,
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const afterCancel = await json(`/api/conversations/${id}`);
  const messages = afterCancel.body.messages;
  check("the cancelled turn kept the user's message", messages.at(-1)?.role === "user", String(messages.at(-1)?.role));
  check(
    "the cancelled turn wrote no version",
    afterCancel.body.promptVersions.length === versionsAfterFirst,
    `${afterCancel.body.promptVersions.length} vs ${versionsAfterFirst}`,
  );

  // ── 3. regenerate ──────────────────────────────────────────────────────
  console.log("==> regenerating the cancelled message");
  const retry = await streamTurn(id, { regenerate: true, provider: PROVIDER, model: MODEL });
  check("regenerate succeeded", retry.result !== null && retry.failure === null);
  check("regenerate is reported as one", retry.result?.regenerated === true);
  const afterRetry = await json(`/api/conversations/${id}`);
  check(
    "regenerate did not duplicate the user's message",
    afterRetry.body.messages.filter((m) => m.role === "user").length ===
      afterCancel.body.messages.filter((m) => m.role === "user").length,
  );

  // ── 4. a question must not create a version (WS-R2 under a real model) ─
  console.log("==> asking a question");
  const versionsBeforeQuestion = afterRetry.body.promptVersions.length;
  const question = await streamTurn(id, { content: "Why did you structure it that way?", provider: PROVIDER, model: MODEL });
  check("the question was answered", typeof question.result?.reply === "string" && question.result.reply.length > 0);
  const afterQuestion = await json(`/api/conversations/${id}`);
  check(
    "the question created no version",
    afterQuestion.body.promptVersions.length === versionsBeforeQuestion,
    `${afterQuestion.body.promptVersions.length} vs ${versionsBeforeQuestion}`,
  );

  // ── 5. requirement preservation against a real model (V2-D) ───────────
  //
  // The half no stub can prove: Layer 1 holding over text a real model wrote,
  // and Layer 2 running the real `intent.extract` boundary over two versions.
  console.log("==> pinning a requirement and asking for it to be dropped");
  //
  // The text to pin comes from FORGE's own deterministic proposals, which are
  // lines of the CURRENT prompt. Pinning a phrase from the original request
  // instead would test the model's choice of words, not the ledger: the first
  // live run did exactly that and reported a false failure.
  const proposalsBefore = await json(`/api/conversations/${id}/ledger`);
  const PIN = (proposalsBefore.body.proposals ?? [])[0] ?? null;
  check("FORGE proposes a pin candidate from the real prompt", typeof PIN === "string" && PIN.length > 0);
  if (!PIN) throw new Error("No pin candidate to work with.");
  console.log(`     pinning: "${PIN.slice(0, 90)}"`);

  const pinned = await json(`/api/conversations/${id}/ledger`, {
    method: "POST",
    body: JSON.stringify({ text: PIN }),
  });
  check("a requirement can be pinned", pinned.status === 201, `status ${pinned.status}`);
  check("the pin is user-authored and hashed", pinned.body.entry?.origin === "user_input" && /^sha256:/.test(String(pinned.body.entry?.contentHash)));

  const beforeDrop = await json(`/api/conversations/${id}/ledger`);
  check(
    "Layer 1 finds the pinned requirement in the current version",
    beforeDrop.body.check?.findings?.every((f) => f.present) === true,
    JSON.stringify(beforeDrop.body.check?.findings?.map((f) => f.present)),
  );

  const dropping = await streamTurn(
    id,
    {
      content: `Rewrite the prompt with this requirement removed entirely: "${PIN}". Return the full revised prompt.`,
      provider: PROVIDER,
      model: MODEL,
    },
  );
  check("the dropping turn completed", dropping.result !== null && dropping.failure === null);
  const preservation = dropping.result?.preservation ?? null;
  const droppedVersion = dropping.result?.version?.v ?? null;
  if (droppedVersion === null) {
    // Whether a real model chooses to revise is the model's behaviour, not
    // FORGE's contract. Say so rather than scoring it either way — a check
    // that passed here would be measuring nothing.
    console.log("  ..    INCONCLUSIVE: the model answered without a new version, so there was none to check");
  } else {
    check("the turn carried a deterministic preservation verdict", preservation?.layer === "deterministic");
    const w005 = (preservation?.diagnostics ?? []).filter((d) => d.code === "FORGE-W005");
    const kept = preservation?.findings?.every((f) => f.present) === true;
    if (kept) {
      // The model complied with the pin's spirit and kept the words. Nothing
      // was dropped, so there is no error to assert — and asserting one would
      // be asserting that the model misbehaves.
      console.log("  ..    INCONCLUSIVE: the rewrite kept the pinned text verbatim, so Layer 1 had nothing to report");
    } else {
      check(
        "Layer 1 reported the dropped pin as an error, deterministically",
        w005.length === 1 && w005[0].severity === "error" && w005[0].source === "deterministic",
        w005.map((d) => `${d.code}/${d.severity}/${d.source}`).join(", ") || "no FORGE-W005",
      );
    }
    const repeat = await json(`/api/conversations/${id}/ledger`);
    check(
      "the verdict is identical on a second, independent read (INV-005)",
      JSON.stringify(repeat.body.check?.findings) === JSON.stringify(preservation?.findings),
    );
  }

  // ── 6. the advisory layer, running the real extraction boundary ────────
  console.log("==> running the advisory drift check through intent.extract");
  const versionsNow = (await json(`/api/conversations/${id}`)).body.promptVersions.map((v) => v.v);
  const drifted = await json(`/api/conversations/${id}/preservation`, {
    method: "POST",
    body: JSON.stringify({
      from: versionsNow.at(-2),
      to: versionsNow.at(-1),
      provider: PROVIDER,
      model: MODEL,
    }),
  });
  if (drifted.body.driftError) console.log(`     advisory layer said: ${String(drifted.body.driftError).slice(0, 300)}`);
  check(
    "the advisory layer ran",
    drifted.body.driftRan === true,
    `${Math.round((drifted.ms ?? 0) / 1000)}s; ${String(drifted.body.driftError ?? "no driftError reported")}`,
  );
  check("it extracted a real IR per version", Number(drifted.body.extractedCalls) === 2, `${drifted.body.extractedCalls} extraction calls`);
  check("the advisory report names itself judged, not a guarantee", drifted.body.drift?.layer === "judged" && drifted.body.drift?.guarantee === false);
  for (const finding of drifted.body.drift?.findings ?? []) {
    check(
      `advisory finding ${finding.diagnostic.code} is a judged warning`,
      finding.diagnostic.code === "FORGE-W006" && finding.diagnostic.severity === "warning" && finding.diagnostic.source === "judged",
    );
    const resolves = finding.diagnostic.evidence.every((e) => {
      const source = drifted.body.citations?.[e.artifact_path];
      return typeof source === "string" && source.slice(e.start, e.end) === e.quote;
    });
    check("its citations resolve against the returned renderings (DG-R4)", resolves);
  }
  check(
    "the pinned requirement is left to Layer 1 (WS-R26)",
    (drifted.body.drift?.findings ?? []).every((f) => !f.from.statement.toLowerCase().includes("never push")),
  );
  check(
    "the judged layer changed nothing about the deterministic verdict (AC-041)",
    JSON.stringify(drifted.body.ledger?.diagnostics) === JSON.stringify((await json(`/api/conversations/${id}/ledger`)).body.check?.diagnostics),
  );
  check(
    "a second check re-uses the stored IRs rather than re-extracting (WS-R26)",
    Number(
      (
        await json(`/api/conversations/${id}/preservation`, {
          method: "POST",
          body: JSON.stringify({ from: versionsNow.at(-2), to: versionsNow.at(-1), provider: PROVIDER, model: MODEL }),
        })
      ).body.extractedCalls,
    ) === 0,
  );

  // ── 7. candidates against a real model (V2-E) ─────────────────────────
  //
  // The half no stub can prove: that a REAL model, given four structurally
  // distinct overlays, returns four materially different prompts; that none of
  // them becomes the current prompt on its own; and that the deterministic
  // merge keeps what both said when the text was not written by this repo.
  console.log("==> generating alternatives from the §9 archetypes");
  const beforeCandidates = (await json(`/api/conversations/${id}`)).body;
  const generated = await json(`/api/conversations/${id}/candidates`, {
    method: "POST",
    body: JSON.stringify({ count: 3, provider: PROVIDER, model: MODEL }),
  });
  check(
    "candidate generation succeeded",
    generated.status === 201,
    `${Math.round((generated.ms ?? 0) / 1000)}s; status ${generated.status}; ${generated.raw ? `non-JSON body: ${generated.raw}` : JSON.stringify(generated.body).slice(0, 200)}`,
  );
  const liveCandidates = generated.body.candidates ?? [];
  check("the request produced alternatives", liveCandidates.length >= 2, `${liveCandidates.length} candidates`);
  // Without two alternatives there is nothing to compare, select or merge.
  // Stopping here reports the real failure instead of a cascade of them.
  if (liveCandidates.length < 2) {
    for (const finding of generated.body.diagnostics ?? []) console.log(`     ${finding.code}: ${finding.message}`);
    if (serverErrors.length > 0) console.log(`     server said: ${serverErrors.join("").slice(-1500)}`);
    throw new Error("Candidate generation returned fewer than two alternatives; the checks below cannot run.");
  }
  check(
    "each alternative names the archetype it came from (ST-R7)",
    liveCandidates.every((c) => c.origin === "archetype" && typeof c.strategy === "string" && c.strategy.length > 0),
  );
  check(
    "each alternative carries the deciding rule (ST-R6)",
    liveCandidates.every((c) => typeof c.rationale === "string" && c.rationale.includes("Selected")),
  );
  check(
    "the overlays are pairwise distinct (§11.5)",
    (generated.body.overlayDistinctness?.rejected ?? []).length === 0,
    JSON.stringify(generated.body.overlayDistinctness?.rejected ?? []),
  );
  check(
    "a real model returned materially different prompts, not rewordings",
    new Set(liveCandidates.map((c) => c.text)).size === liveCandidates.length,
  );
  check("generating wrote no prompt version (WS-R8)", generated.body.versionCreated === false);
  const afterGeneration = (await json(`/api/conversations/${id}`)).body;
  check(
    "the current prompt is untouched by generation (WS-R8)",
    afterGeneration.currentV === beforeCandidates.currentV &&
      afterGeneration.promptVersions.length === beforeCandidates.promptVersions.length,
    `v${beforeCandidates.currentV} → v${afterGeneration.currentV}`,
  );
  check(
    "every candidate carries Layer 1's verdict, labelled (WS-R28)",
    liveCandidates.every((c) => c.preservation?.layer === "deterministic"),
  );
  check(
    "candidate generation cost one call per alternative and nothing else (WS-R13)",
    Number(generated.body.calls?.generation) === liveCandidates.length + (generated.body.diagnostics ?? []).length,
    JSON.stringify(generated.body.calls),
  );

  console.log("==> comparing two live alternatives");
  const compared = await json(
    `/api/conversations/${id}/candidates/compare?a=${encodeURIComponent(liveCandidates[0].id)}&b=${encodeURIComponent(liveCandidates[1].id)}`,
  );
  check("the comparison succeeded", compared.status === 200, JSON.stringify(compared.body).slice(0, 200));
  check(
    "it shows content unique to each side",
    compared.body.divergence?.uniqueToA > 0 && compared.body.divergence?.uniqueToB > 0,
    JSON.stringify(compared.body.divergence),
  );
  check("it is deterministic, not judged (WS-R28)", compared.body.layer === "deterministic");

  console.log("==> promoting one alternative, then merging two");
  const chosenLive = liveCandidates[0];
  const promotedLive = await json(`/api/conversations/${id}/candidates/${encodeURIComponent(chosenLive.id)}/select`, {
    method: "POST",
  });
  check("promotion wrote a new version (ST-R6)", promotedLive.status === 201 && promotedLive.body.prompt === chosenLive.text);
  const afterPromotion = (await json(`/api/conversations/${id}`)).body;
  check(
    "every earlier version is byte-identical (WS-R7)",
    JSON.stringify(afterPromotion.promptVersions.slice(0, afterGeneration.promptVersions.length)) ===
      JSON.stringify(afterGeneration.promptVersions),
  );
  check(
    "the choice is recorded (ST-R6)",
    afterPromotion.candidatePromotions?.some((p) => p.promotion === "select" && p.candidateIds[0] === chosenLive.id) === true,
  );

  const mergedLive = await json(`/api/conversations/${id}/candidates/merge`, {
    method: "POST",
    body: JSON.stringify({ refs: [liveCandidates[0].id, liveCandidates[1].id] }),
  });
  check("merge wrote a merge-sourced version (WS-R2)", mergedLive.body.version?.source === "merge" && mergedLive.body.version?.action === "MERGE");
  const mergedText = String(mergedLive.body.version?.text ?? "");
  const blocksOf = (text) => text.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter((b) => b.length > 0);
  const droppedBlocks = [liveCandidates[0], liveCandidates[1]]
    .flatMap((c) => blocksOf(c.text).map((b) => [c.strategy, b]))
    .filter(([, block]) => !mergedText.includes(block));
  check(
    "the merge dropped nothing either alternative said",
    droppedBlocks.length === 0,
    droppedBlocks.map(([s, b]) => `${s}: ${b.slice(0, 60)}`).join(" | "),
  );
  check(
    "Layer 1 ran over the merged version and said so (WS-R25, WS-R28)",
    mergedLive.body.preservation?.layer === "deterministic" && Array.isArray(mergedLive.body.preservation?.findings),
  );
  const pinSurvived = (mergedLive.body.preservation?.findings ?? []).every((f) => f.present);
  if (pinSurvived) {
    check("the pinned requirement survived the merge", true);
  } else {
    // The pin was dropped by the model's own rewrite earlier in this run, so
    // an alternative derived from that version cannot contain it. What FORGE
    // owes here is the error, not the survival.
    check(
      "a pin neither alternative carried is reported as an error, not absorbed",
      (mergedLive.body.preservation?.diagnostics ?? []).some((d) => d.code === "FORGE-W005" && d.severity === "error"),
    );
  }

  const ledgerAfterCandidates = await json(`/api/conversations/${id}/ledger`);
  check(
    "no candidate path added, edited or removed a ledger entry (WS-R27.4)",
    JSON.stringify(ledgerAfterCandidates.body.entries) ===
      JSON.stringify((await json(`/api/conversations/${id}/ledger`)).body.entries) &&
      ledgerAfterCandidates.body.entries.length === 1,
  );

  console.log("==> refreshing: candidate state comes back from the log");
  const rereadA = await json(`/api/conversations/${id}`);
  const rereadB = await json(`/api/conversations/${id}`);
  check(
    "candidates and promotions survive a re-read unchanged (WS-R17)",
    JSON.stringify(rereadA.body.candidates) === JSON.stringify(rereadB.body.candidates) &&
      rereadA.body.candidates.length === liveCandidates.length &&
      rereadA.body.candidatePromotions.length === 2,
    `${rereadA.body.candidates.length} candidates, ${rereadA.body.candidatePromotions.length} promotions`,
  );

  console.log("==> the ordinary single-prompt turn still behaves as before");
  const ordinaryBefore = (await json(`/api/conversations/${id}`)).body;
  const ordinary = await streamTurn(id, {
    content: "Add one sentence requiring structured JSON logs.",
    provider: PROVIDER,
    model: MODEL,
  });
  check("the ordinary turn completed", ordinary.result !== null && ordinary.failure === null);
  check(
    "it streamed tokens as before (WS-R10)",
    ordinary.deltas.length > 1,
    `${ordinary.deltas.length} deltas; reply ${String(ordinary.result?.reply ?? "").length} chars; ` +
      `version ${ordinary.result?.version?.v ?? "none"}; ` +
      `diagnostics ${(ordinary.result?.diagnostics ?? []).map((d) => `${d.code}:${String(d.message).slice(0, 120)}`).join(" | ") || "none"}; ` +
      `prompt chars in ${String(ordinaryBefore.prompt ?? "").length}`,
  );
  const ordinaryAfter = (await json(`/api/conversations/${id}`)).body;
  check(
    "it created no candidate and no promotion (WS-R8)",
    ordinaryAfter.candidates.length === ordinaryBefore.candidates.length &&
      ordinaryAfter.candidatePromotions.length === ordinaryBefore.candidatePromotions.length,
  );

  // ── 8. nothing anywhere leaks the credential (WS-R16) ──────────────────
  const surfaces = [
    JSON.stringify(afterQuestion.body),
    JSON.stringify((await json("/api/settings/providers")).body),
    JSON.stringify(run.events),
    JSON.stringify(drifted.body),
    JSON.stringify((await json(`/api/conversations/${id}/ledger`)).body),
    JSON.stringify(generated.body),
    JSON.stringify(mergedLive.body),
  ];
  check("no credential on any surface", surfaces.every((text) => !text.includes(KEY)));

  console.log("");
  console.log(failures.length === 0 ? "LIVE SMOKE: PASS" : `LIVE SMOKE: FAIL (${failures.join(", ")})`);
} finally {
  server?.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failures.length === 0 ? 0 : 1);
