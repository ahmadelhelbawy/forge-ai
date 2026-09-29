// Records the README demo: one real session against a real provider — idea →
// Discovery → Generate → pin → compile → package → verify → traceability.
// Nothing is scripted on the server side; every screen is what FORGE showed.
//
//   BASE=http://127.0.0.1:3400 MODEL="opencode-go|||qwen3.8-flash" OUT=docs/media \
//   node web/scripts/demo-record.mjs
//
// Writes the raw WebM and `segments.json`: the wall-clock span of every wait on
// the model, so the edit can shorten ONLY those spans and label them with their
// real duration (docs/media/README.md describes the edit).
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:3400";
const MODEL = process.env.MODEL ?? "opencode-go|||qwen3.8-flash";
const OUT = process.env.OUT ?? "docs/media";
const RAW = join(OUT, "raw");
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: RAW, size: { width: 1440, height: 900 } },
});
const t0 = Date.now();
const page = await context.newPage();
const now = () => (Date.now() - t0) / 1000;
const waits = [];
const hold = (ms) => page.waitForTimeout(ms);
const idle = () =>
  page.waitForFunction(() => !document.querySelector('textarea[aria-label="Message"]')?.disabled, null, { timeout: 8 * 60_000 });
async function modelWait(label, fn) {
  const start = now();
  await fn();
  waits.push({ label, start, end: now() });
}
const composer = page.getByRole("textbox", { name: "Message" });

try {
  await page.goto(BASE);
  await page.getByRole("button", { name: /^list$/i }).click({ timeout: 2000 }).catch(() => undefined);
  await page.getByRole("combobox", { name: "Model" }).selectOption(MODEL);
  await hold(1500);

  // 1. A vague idea.
  await page.getByTestId("new-conversation").click();
  await composer.click();
  await composer.pressSequentially(
    "I want a coding agent to add rate limiting to the login endpoint of our Express API. Not sure about the details.",
    { delay: 18 },
  );
  await hold(600);
  await composer.press("Enter");
  await modelWait("Discovery", async () => {
    await page.getByTestId("discovery-panel").waitFor({ timeout: 8 * 60_000 });
    await idle();
  });
  await hold(3500);

  // 2. Answer one question, then Generate.
  const option = page.getByTestId("discovery-option").first();
  if (await option.count()) {
    await option.click();
    await hold(800);
    await page.getByTestId("discovery-submit").click();
    await modelWait("Discovery", idle);
    await hold(2000);
  }
  await page.getByTestId("discovery-generate").click();
  await modelWait("Generating the prompt", async () => {
    await page.getByTestId("discovery-panel").waitFor({ state: "detached", timeout: 8 * 60_000 });
    await idle();
  });
  await page.getByTestId("studio-tab-prompt").click();
  await hold(4000);

  // 3. Pin a requirement.
  await page.getByTestId("studio-tab-requirements").click();
  await hold(800);
  // Pin a line the prompt actually contains: the ledger matches text, so a
  // paraphrase would (correctly) be reported missing.
  const id = new URL(page.url()).hash.replace(/^#c=/, "");
  const prompt = (await (await fetch(`${BASE}/api/conversations/${id}`)).json()).prompt ?? "";
  const line =
    prompt
      .split("\n")
      .map((l) => l.replace(/^[-*#>\s\d.]+/, "").replace(/[*`]/g, "").trim())
      .find((l) => /429|retry-after|limit/i.test(l) && l.length > 20 && l.length < 90) ??
    prompt.split("\n").map((l) => l.trim()).find((l) => l.length > 20 && l.length < 90) ??
    "";
  await page.getByTestId("pin-input").click();
  await page.getByTestId("pin-input").pressSequentially(line, { delay: 22 });
  await page.getByTestId("pin-submit").click();
  await hold(2500);

  // 4. Compile for Claude Code, then package the Execution Contract.
  await page.getByTestId("studio-tab-compile").click();
  await hold(1000);
  await page.getByTestId("compile-run").click();
  await modelWait("Extracting the Task IR", () =>
    page.getByTestId("compile-artifact").first().or(page.getByTestId("compile-refused")).waitFor({ timeout: 8 * 60_000 }),
  );
  await hold(2500);
  await page.getByTestId("package-run").click();
  await page.getByTestId("package-result").waitFor({ timeout: 60_000 });
  await page.getByTestId("package-result").scrollIntoViewIfNeeded();
  await hold(3000);

  // 5. Evidence from an external run → verdicts.
  const conversationId = new URL(page.url()).hash.replace(/^#c=/, "");
  const pkg = await (
    await fetch(`${BASE}/api/conversations/${conversationId}/package`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "claude-code" }),
    })
  ).json();
  const entries = JSON.parse(pkg.files.find((f) => f.path === "verification.json").content).entries;
  const runnable = entries.filter((e) => e.kind === "command" || e.kind === "test");
  const empty = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const record = (e, exit) => ({
    obligation_id: e.id, kind: e.kind, exit_code: exit, stdout_hash: empty, stderr_hash: empty,
    started_at: new Date().toISOString(), duration_ms: 1200, runner: "ci", repo_commit: null,
    package_semantic_id: pkg.semanticId,
  });
  const records = runnable.slice(0, 2).map((e, i) => record(e, i === 0 ? 0 : 1));
  await page.getByTestId("verify-evidence").fill(JSON.stringify({ records }, null, 2));
  await hold(1200);
  await page.getByTestId("verify-run").click();
  await page.getByTestId("verify-result").waitFor({ timeout: 60_000 });
  await page.getByTestId("verify-result").scrollIntoViewIfNeeded();
  await hold(4000);

  // 6. The traceability matrix.
  await page.getByTestId("matrix-build").click();
  await page.getByTestId("matrix").waitFor({ timeout: 60_000 });
  await page.getByTestId("matrix").scrollIntoViewIfNeeded();
  await hold(4500);
} finally {
  const duration = now();
  await context.close();
  await browser.close();
  const video = readdirSync(RAW).find((f) => f.endsWith(".webm"));
  if (video) renameSync(join(RAW, video), join(RAW, "forge-demo-raw.webm"));
  writeFileSync(join(RAW, "segments.json"), JSON.stringify({ model: MODEL, duration, waits }, null, 2));
  console.log(JSON.stringify({ duration, waits }, null, 2));
}
