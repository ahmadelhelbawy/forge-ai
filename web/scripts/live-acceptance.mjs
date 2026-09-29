// Live acceptance (pre-release audit, 2026-09-29): the core FORGE workflow in
// real Chromium against a real provider. Opt-in; never in CI; prints no key.
//
//   BASE=http://127.0.0.1:3400 MODEL="opencode-go|||qwen3.8-flash" \
//   OUT=evals/release-audit node web/scripts/live-acceptance.mjs
//
// The server must already be running on a COPY of a data directory that has
// a provider configured. Every step prints its wall-clock time.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:3400";
const MODEL = process.env.MODEL ?? "opencode-go|||qwen3.8-flash";
const OUT = process.env.OUT ?? "evals/release-audit";
const LONG = 6 * 60_000;
mkdirSync(join(OUT, "shots"), { recursive: true });

const results = [];
let failures = 0;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
async function step(name, fn) {
  if (ONLY && !ONLY.has(name.split(".")[0])) return;
  const started = Date.now();
  try {
    const note = await fn();
    const s = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name, ok: true, seconds: Number(s), note: note ?? null });
    console.log(`  ✓ ${name} (${s}s)${note ? ` — ${note}` : ""}`);
  } catch (error) {
    failures += 1;
    const s = ((Date.now() - started) / 1000).toFixed(1);
    const message = String(error?.message ?? error).split("\n").slice(0, 6).join(" | ");
    results.push({ name, ok: false, seconds: Number(s), note: message });
    console.log(`  ✗ ${name} (${s}s)\n      ${message}`);
    await page.screenshot({ path: join(OUT, "shots", `fail-${name.split(".")[0]}.png`) }).catch(() => undefined);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const api = async (path, init) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const idOf = () => new URL(page.url()).hash.replace(/^#c=/, "");
const composerIdle = () =>
  page.waitForFunction(() => !document.querySelector('textarea[aria-label="Message"]')?.disabled, null, { timeout: LONG });
const shot = (name) => page.screenshot({ path: join(OUT, "shots", `${name}.png`) });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  recordVideo: process.env.VIDEO ? { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } : undefined,
});
const page = await context.newPage();
const composer = page.getByRole("textbox", { name: "Message" });
let discoveryId = "";
let refineId = "";

console.log(`live acceptance against ${BASE} with ${MODEL}`);
try {
  await page.goto(BASE);
  // A previous run may have left a custom model id selected.
  await page.getByRole("button", { name: /^list$/i }).click({ timeout: 3000 }).catch(() => undefined);
  await page.getByRole("combobox", { name: "Model" }).selectOption(MODEL);

  await step("1. Discovery: a vague idea gets questions, not a prompt", async () => {
    await page.getByTestId("new-conversation").click();
    await composer.fill(
      "I want a coding agent to add rate limiting to the login endpoint of our Express API. Not sure about the details.",
    );
    await composer.press("Enter");
    await page.getByTestId("discovery-panel").waitFor({ timeout: LONG });
    await composerIdle();
    discoveryId = idOf();
    const convo = (await api(`/api/conversations/${discoveryId}`)).body;
    assert(convo.promptVersions.length === 0, "discovery wrote a prompt");
    const open = convo.discoveryUnresolved?.length ?? 0;
    await shot("01-discovery");
    return `${open} open question(s), no version written`;
  });

  await step("2. Discovery: answering adapts it", async () => {
    const option = page.getByTestId("discovery-option").first();
    if (await option.count()) {
      await option.click();
      await page.getByTestId("discovery-submit").click();
    } else {
      await composer.fill("5 attempts per minute per IP, respond 429, keep it dependency-free.");
      await composer.press("Enter");
    }
    await composerIdle();
    const convo = (await api(`/api/conversations/${discoveryId}`)).body;
    assert(convo.promptVersions.length === 0, "an answer wrote a prompt");
    return `still no version; ${convo.discoveryUnresolved?.length ?? 0} open`;
  });

  await step("3. Generate finalises with open questions decided", async () => {
    await page.getByTestId("discovery-generate").click();
    await page.getByTestId("discovery-panel").waitFor({ state: "detached", timeout: LONG });
    await composerIdle();
    const convo = (await api(`/api/conversations/${discoveryId}`)).body;
    assert(convo.promptVersions.length === 1, `expected v1, have ${convo.promptVersions.length}`);
    await page.getByTestId("studio-tab-prompt").click();
    await shot("02-generated");
    return `v1, ${convo.prompt.length} chars`;
  });

  await step("4. Markdown export is the current version, byte for byte", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-markdown").click()]);
    const path = join(OUT, download.suggestedFilename());
    await download.saveAs(path);
    const { readFileSync } = await import("node:fs");
    const convo = (await api(`/api/conversations/${discoveryId}`)).body;
    assert(readFileSync(path, "utf8") === convo.prompt, "download differs from the current prompt");
    return download.suggestedFilename();
  });

  await step("5. Requirements: pin one; the ledger checks it", async () => {
    await page.getByTestId("studio-tab-requirements").click();
    const convo = (await api(`/api/conversations/${discoveryId}`)).body;
    const line = convo.prompt.split("\n").map((l) => l.replace(/^[-*#>\s\d.]+/, "").trim()).find((l) => l.length > 25 && l.length < 140);
    assert(line, "no line to pin");
    await page.getByTestId("pin-input").fill(line);
    await page.getByTestId("pin-submit").click();
    await page.getByTestId("ledger-entry").first().waitFor({ timeout: 20_000 });
    const ledger = (await api(`/api/conversations/${discoveryId}/ledger`)).body;
    assert(ledger.entries.length >= 1, "nothing pinned");
    await shot("03-requirements");
    return `pinned: "${line.slice(0, 60)}…"; missing now: ${ledger.check?.diagnostics?.length ?? 0}`;
  });

  await step("6. Compile for Claude Code (IR extraction is live)", async () => {
    await page.getByTestId("studio-tab-compile").click();
    const select = page.getByTestId("compile-target");
    if (await select.count()) await select.selectOption("claude-code").catch(() => undefined);
    await page.getByTestId("compile-run").click();
    await page.getByTestId("compile-artifact").first().or(page.getByTestId("compile-refused")).waitFor({ timeout: LONG });
    const refused = await page.getByTestId("compile-refused").count();
    await shot("04-compiled");
    return refused ? "REFUSED (see screenshot)" : `${await page.getByTestId("compile-artifact").count()} artifact(s)`;
  });

  let pkg = null;
  await step("7. Package: deterministic identity", async () => {
    await page.getByTestId("package-run").click();
    await page.getByTestId("package-result").waitFor({ timeout: LONG });
    const a = (await api(`/api/conversations/${discoveryId}/package`, { method: "POST", body: JSON.stringify({ target: "claude-code" }) })).body;
    const b = (await api(`/api/conversations/${discoveryId}/package`, { method: "POST", body: JSON.stringify({ target: "claude-code" }) })).body;
    assert(a && !a.refused, `package refused: ${JSON.stringify(a).slice(0, 200)}`);
    assert(a.semanticId === b.semanticId, "two builds of the same version differ");
    pkg = a;
    const dir = join(OUT, "package");
    for (const f of a.files) {
      mkdirSync(join(dir, f.path, ".."), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    await shot("05-package");
    return `${a.semanticId.slice(0, 19)}… stable across builds; ${a.files.length} files`;
  });

  await step("8. Verify: evidence → VERIFIED / FAILED / UNVERIFIED / REVIEW_REQUIRED", async () => {
    assert(pkg, "no package");
    const entries = JSON.parse(pkg.files.find((f) => f.path === "verification.json").content).entries;
    const runnable = entries.filter((e) => e.kind === "command" || e.kind === "test");
    const empty = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const record = (e, exit) => ({
      obligation_id: e.id, kind: e.kind, exit_code: exit, stdout_hash: empty, stderr_hash: empty,
      started_at: new Date().toISOString(), duration_ms: 10, runner: "live-acceptance", repo_commit: null,
      package_semantic_id: pkg.semanticId,
    });
    const records = [];
    if (runnable[0]) records.push(record(runnable[0], 0));
    if (runnable[1]) records.push(record(runnable[1], 1));
    const evidence = JSON.stringify({ records }, null, 2);
    writeFileSync(join(OUT, "evidence.json"), evidence);
    await page.getByTestId("verify-evidence").fill(evidence);
    await page.getByTestId("verify-run").click();
    await page.getByTestId("verify-result").waitFor({ timeout: LONG });
    const text = await page.getByTestId("verify-result").innerText();
    await shot("06-verify");
    const counts = ["VERIFIED", "FAILED", "UNVERIFIED", "REVIEW_REQUIRED"].map((k) => `${k} ${(text.match(new RegExp(`\\b${k}\\b`, "g")) ?? []).length}`);
    return `${entries.length} obligations (${runnable.length} runnable); shown: ${counts.join(", ")}`;
  });

  await step("9. Traceability matrix", async () => {
    await page.getByTestId("matrix-build").click();
    await page.getByTestId("matrix").waitFor({ timeout: LONG });
    const rows = await page.locator('[data-testid^="matrix-row-"]').count();
    await page.locator('[data-testid^="matrix-row-"]').first().focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("matrix-detail").waitFor({ timeout: 10_000 });
    await shot("07-traceability");
    return `${rows} requirement row(s); row opened from the keyboard`;
  });

  await step("10. Existing long prompt: Polish without an interview loop", async () => {
    const { readFileSync } = await import("node:fs");
    const long = readFileSync("evals/release-blockers/forge-prompt-v1.md", "utf8");
    await page.getByTestId("new-conversation").click();
    await page.waitForFunction((prev) => location.hash && location.hash !== `#c=${prev}`, discoveryId);
    refineId = idOf();
    await composer.fill(long);
    await composer.press("Enter");
    await composerIdle();
    const panel = page.getByTestId("discovery-panel");
    if (await panel.count()) {
      await page.getByTestId("mode-polish").click();
      await page.getByTestId("discovery-generate").click();
      await composerIdle();
    }
    const convo = (await api(`/api/conversations/${refineId}`)).body;
    assert(convo.promptVersions.length >= 1, "no version after Polish");
    await shot("08-polish");
    return `${long.length} chars in → v${convo.currentV} (${convo.prompt.length} chars), mode ${convo.promptVersions.at(-1).mode ?? "?"}`;
  });

  await step("11. Model switch: a model without a reasoning setting says so and still answers", async () => {
    const select = page.getByRole("combobox", { name: "Model" });
    const values = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
    const other = values.find((v) => v.startsWith("opencode-go|||kimi")) ?? values.find((v) => v !== MODEL && v.includes("|||"));
    await select.selectOption(other);
    await page.waitForTimeout(1500);
    const effort = page.getByTestId("reasoning-effort");
    const effortState = (await effort.isDisabled()) ? "effort disabled" : `effort: ${await effort.inputValue()}`;
    await composer.fill("In one sentence, what does this prompt ask for?");
    await composer.press("Enter");
    await composerIdle();
    const convo = (await api(`/api/conversations/${refineId}`)).body;
    assert(convo.messages.at(-1).role === "assistant", "no answer after the model switch");
    await select.selectOption(MODEL);
    return `${other}; ${effortState}; answered`;
  });

  await step("12. Error recovery: a model the provider rejects keeps the message and says why", async () => {
    // Its own conversation, so the assertions read only this turn.
    await page.getByTestId("new-conversation").click();
    await page.waitForTimeout(500);
    const select = page.getByRole("combobox", { name: "Model" });
    await select.selectOption("__custom");
    const custom = page.getByPlaceholder("Custom model ID");
    await custom.fill("forge-audit-no-such-model");
    await custom.blur();
    const alertText = async () =>
      (await page.getByRole("alert").allInnerTexts()).map((t) => t.trim()).find((t) => t.length > 0) ?? "";

    // 12a. A model FORGE cannot route (no documented protocol) is refused
    // before anything is sent; the typed message goes back to the composer.
    const probeA = "Error-recovery probe A: an unroutable model.";
    await composer.fill(probeA);
    await composer.press("Enter");
    await composerIdle();
    await page.waitForTimeout(500);
    const refusal = await alertText();
    assert(/not a documented/.test(refusal), `no routing refusal shown: ${refusal.slice(0, 120)}`);
    assert((await composer.inputValue()) === probeA, "the refused message did not come back to the composer");
    await shot("09-error-refused");
    await page.getByRole("button", { name: /dismiss/i }).first().click().catch(() => undefined);

    // 12b. A model the PROVIDER rejects: the message is kept, nothing is
    // written, the reason is shown, Retry is offered.
    await page.getByRole("button", { name: /^list$/i }).click();
    const values = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
    const router = values.find((v) => v.startsWith("openrouter|||"));
    assert(router, "no OpenRouter model to switch to");
    await select.selectOption(router);
    await select.selectOption("__custom");
    await custom.fill("forge-audit/no-such-model");
    await custom.blur();
    const probeB = "Error-recovery probe B: a model the provider rejects.";
    await composer.fill(probeB);
    await composer.press("Enter");
    await composerIdle();
    await page.waitForTimeout(500);
    const rejected = await alertText();
    assert(rejected.length > 0, "no error was shown");
    const convo = (await api(`/api/conversations/${idOf()}`)).body;
    assert(convo.messages.some((m) => m.content === probeB), "the user's message was lost");
    assert(convo.promptVersions.length === 0, "a failed turn wrote a version");
    assert(await page.getByTestId("turn-retry").count(), "Retry is not offered");
    await shot("09-error");
    await page.getByRole("button", { name: /^list$/i }).click().catch(() => undefined);
    await select.selectOption(MODEL).catch(() => undefined);
    return `refused: "${refusal.split("\n")[0].slice(0, 90)}"; rejected: "${rejected.replace(/\s+/g, " ").slice(0, 120)}"; message kept, no version, Retry offered`;
  });
} finally {
  await context.close();
  await browser.close();
  writeFileSync(join(OUT, ONLY ? `live-results-only-${[...ONLY].join("-")}.json` : "live-results.json"), JSON.stringify({ base: BASE, model: MODEL, discoveryId, refineId, results }, null, 2));
}

console.log(failures ? `\n${failures} live step(s) failed` : "\nall live steps passed");
process.exit(failures ? 1 : 0);
