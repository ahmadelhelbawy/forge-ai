// Voice probe (not a test): real Google Chrome, real Web Speech recognizer,
// synthesized speech fed as the microphone. Not a human at a physical mic.
//   WAV=/path/speech.wav BASE=http://localhost:3400 node scripts/probe-voice.mjs
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3400";
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${process.env.WAV}`],
});
const context = await browser.newContext({ permissions: ["microphone"] });
await context.grantPermissions(["microphone"], { origin: BASE });
const page = await context.newPage();
const posts = [];
page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/messages")) posts.push(r.url()); });
await page.goto(BASE);
await page.getByTestId("new-conversation").click();
const composer = page.getByRole("textbox", { name: "Message" });
await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Message"]').disabled);
const out = { hasApi: await page.evaluate(() => "webkitSpeechRecognition" in window || "SpeechRecognition" in window) };

// 1. record → transcription → editable text → no auto-send
await page.getByTestId("dictation-start").click();
await page.getByTestId("dictation-active").waitFor({ timeout: 5000 }).catch(() => undefined);
const t0 = Date.now();
let text = "";
while (Date.now() - t0 < 25000) {
  text = await composer.inputValue();
  const err = await page.getByTestId("dictation-error").textContent({ timeout: 200 }).catch(() => null);
  if (err) { out.error = err; break; }
  if (text.length > 20 && Date.now() - t0 > 8000) break;
  await page.waitForTimeout(500);
}
out.transcript = text;
out.transcriptSeconds = (Date.now() - t0) / 1000;
if (await page.getByTestId("dictation-done").isVisible().catch(() => false)) await page.getByTestId("dictation-done").click();
await page.waitForTimeout(1000);
out.editableAfter = await composer.isEditable();
await composer.fill(text + " Edited by hand.");
out.editedValue = await composer.inputValue();
out.postsAfterDictation = posts.length;

// 2. cancel: start again, cancel, the composer must not change
await composer.fill("kept text");
await page.getByTestId("dictation-start").click();
await page.waitForTimeout(4000);
out.duringSecond = await composer.inputValue();
await page.getByTestId("dictation-cancel").click().catch((e) => (out.cancelError = String(e).slice(0, 200)));
await page.waitForTimeout(1500);
out.afterCancel = await composer.inputValue();
out.startVisibleAfterCancel = await page.getByTestId("dictation-start").isVisible();
out.postsTotal = posts.length;
await page.screenshot({ path: new URL("../../evals/release-blockers/voice-after-cancel.png", import.meta.url).pathname });
console.log(JSON.stringify(out, null, 1));
await browser.close();
