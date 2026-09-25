// Browser acceptance: the critical user flows in a real Chromium against the
// real server (offline stub model). Run by web/scripts/e2e.sh after the HTTP
// suite, or by hand:
//
//   BASE=http://localhost:3210 FAIL_BASE=http://localhost:3211 node web/scripts/browser-acceptance.mjs
//
// Covers what the HTTP suite cannot see: what the user is shown.
//   1. Discovery → Generate with open questions finalises: the interview
//      closes, the prompt becomes the main state, W010 is a quiet note.
//   2. Reload reopens the same conversation.
//   3. Voice → text: transcript lands in the editable draft, never sent;
//      cancel restores; a permission denial is explained.
//   4. A provider failure keeps the message and says why.
//   5. A phone-width viewport has no horizontal scroll.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3210";
const FAIL_BASE = process.env.FAIL_BASE ?? "http://localhost:3211";

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    if (globalThis.__page) {
      // What the page was waiting on: the slowest API calls, so a timeout
      // names its cause instead of only its symptom.
      const slow = await globalThis.__page
        .evaluate(() =>
          performance
            .getEntriesByType("resource")
            .filter((e) => e.name.includes("/api/"))
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 5)
            .map((e) => `${Math.round(e.duration)}ms ${e.name.replace(location.origin, "")}`),
        )
        .catch(() => []);
      if (slow.length > 0) console.log(`      slowest API calls: ${slow.join(" | ")}`);
    }
    if (process.env.SHOTS && globalThis.__page) {
      await globalThis.__page.screenshot({ path: `${process.env.SHOTS}/${name.split(".")[0]}.png` }).catch(() => undefined);
    }
    console.log(`  ✗ ${name}\n      ${String(error?.message ?? error).split("\n").slice(0, 12).join("\n      ")}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// A scripted recognizer standing in for the browser's: the test drives what
// is "heard". `window.__speech.say(text, final)` and `.fail(code)`.
const FAKE_SPEECH = `
  (() => {
    class FakeRecognition {
      constructor() { window.__speech.rec = this; this.onresult = null; this.onerror = null; this.onend = null; }
      start() { window.__speech.started = true; if (window.__speech.denied) setTimeout(() => { this.onerror?.({ error: "not-allowed" }); this.onend?.(); }, 10); }
      stop() { setTimeout(() => this.onend?.(), 10); }
      abort() { this.onerror?.({ error: "aborted" }); this.onend?.(); }
    }
    window.__speech = {
      rec: null, started: false, denied: false, finals: [],
      say(text, final) {
        const r = window.__speech.rec;
        if (final) window.__speech.finals.push(text);
        const results = window.__speech.finals.map((t) => ({ isFinal: true, 0: { transcript: t } }));
        if (!final) results.push({ isFinal: false, 0: { transcript: text } });
        r.onresult?.({ resultIndex: 0, results });
      },
    };
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
  })();
`;

// The stub servers answer with a stand-in model, but the workspace still
// needs a provider and model chosen, exactly as a real user does.
for (const base of [BASE, FAIL_BASE]) {
  const put = (path, body) =>
    fetch(`${base}${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await put("/api/settings/providers/openai", { apiKey: "stub-key", enabled: true });
  await put("/api/settings/default-model", { provider: "openai", model: "gpt-4o-mini" });
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(FAKE_SPEECH);
  const page = await context.newPage();
  globalThis.__page = page;
  const composer = page.getByRole("textbox", { name: "Message" });

  console.log("browser acceptance");

  await check("1. Discovery → Generate with open questions finalises cleanly", async () => {
    await page.goto(BASE);
    await page.getByTestId("new-conversation").click();
    await composer.fill("I want an AI agent for my bakery but I'm not sure what it should do.");
    await composer.press("Enter");
    await page.getByTestId("discovery-panel").waitFor({ timeout: 30_000 });
    // The Studio follows the work: the brief while there is no prompt.
    await page.getByTestId("discovery-brief").waitFor();
    await page.getByTestId("discovery-generate").click();
    await page.getByTestId("discovery-panel").waitFor({ state: "detached", timeout: 30_000 });
    await page.getByTestId("studio-tab-prompt").and(page.locator("[aria-selected=true]")).waitFor({ timeout: 30_000 });
    const w010 = page.locator('[data-testid=turn-diagnostic][data-code="FORGE-W010"]');
    await w010.waitFor();
    assert((await w010.getAttribute("data-severity")) === "info", "W010 is not info");
    const amber = await page.locator('[data-testid=turn-diagnostic][data-severity=warning], [data-testid=turn-diagnostic][data-severity=error]').count();
    assert(amber === 0, `${amber} warning/error diagnostic(s) shown after a clean generate`);
    assert((await composer.getAttribute("placeholder"))?.startsWith("Ask for a change"), "composer still reads as an interview");
    await page.getByTestId("studio-tab-brief").click();
    await page.getByTestId("brief-decided").waitFor();
    await page.getByTestId("studio-tab-prompt").click();
  });

  await check("2. Reload reopens the same conversation", async () => {
    const before = page.url();
    assert(/#c=/.test(before), `URL does not name the conversation: ${before}`);
    await page.reload();
    await page.getByTestId("studio-tab-prompt").waitFor();
    await page.getByText("Stub reply to:", { exact: false }).first().waitFor({ timeout: 10_000 });
    assert(page.url() === before, "a different conversation opened after reload");
  });

  await check("3a. Voice: transcript fills the editable draft and is never sent", async () => {
    const messagesBefore = await page.locator("main").getByText("Stub reply to:", { exact: false }).count();
    await composer.fill("Also:");
    await page.getByTestId("dictation-start").click();
    await page.getByTestId("dictation-active").waitFor();
    await page.evaluate(() => window.__speech.say("make it friendlier", true));
    await page.evaluate(() => window.__speech.say("and shorter", false));
    await page.waitForFunction(
      () => document.querySelector('textarea[aria-label="Message"]')?.value === "Also: make it friendlier and shorter",
      null,
      { timeout: 5000 },
    );
    assert(await page.getByRole("button", { name: "Send" }).isDisabled(), "Send is enabled while listening");
    await page.getByTestId("dictation-done").click();
    await page.getByTestId("dictation-start").waitFor();
    assert(await composer.isEditable(), "draft is not editable after dictation");
    await composer.press("End");
    await composer.pressSequentially("!");
    assert((await composer.inputValue()) === "Also: make it friendlier and shorter!", "draft did not stay editable");
    await page.waitForTimeout(500);
    const messagesAfter = await page.locator("main").getByText("Stub reply to:", { exact: false }).count();
    assert(messagesAfter === messagesBefore, "the transcript was sent without the user pressing Send");
  });

  await check("3b. Voice: cancel restores the draft; Esc cancels", async () => {
    await composer.fill("keep this");
    await page.getByTestId("dictation-start").click();
    await page.evaluate(() => {
      window.__speech.finals = [];
      window.__speech.say("discard me", true);
    });
    await page.getByTestId("dictation-cancel").click();
    assert((await composer.inputValue()) === "keep this", `after cancel: ${await composer.inputValue()}`);
    await page.getByTestId("dictation-start").click();
    await page.evaluate(() => window.__speech.say("and me", true));
    await page.keyboard.press("Escape");
    assert((await composer.inputValue()) === "keep this", `after Esc: ${await composer.inputValue()}`);
  });

  await check("3c. Voice: a denied microphone is explained, the draft untouched", async () => {
    await page.evaluate(() => {
      window.__speech.denied = true;
    });
    await page.getByTestId("dictation-start").click();
    const error = page.getByTestId("dictation-error");
    await error.waitFor();
    assert(/Microphone access is blocked/.test(await error.innerText()), "no permission message");
    assert((await composer.inputValue()) === "keep this", "draft changed on denial");
  });

  await check("4. A provider failure keeps the message and says why", async () => {
    const failing = await context.newPage();
    await failing.goto(FAIL_BASE);
    await failing.getByTestId("new-conversation").click();
    const box = failing.getByRole("textbox", { name: "Message" });
    await box.fill("Write a prompt for summarising meeting notes.");
    await box.press("Enter");
    await failing.getByRole("alert").filter({ hasText: /Stub provider failure|failed|error/i }).first().waitFor({ timeout: 20_000 });
    await failing.getByText("Write a prompt for summarising meeting notes.").first().waitFor();
    const blank = await failing.evaluate(() =>
      [...document.querySelectorAll("main [data-role=assistant], main .assistant")].some((n) => !n.textContent.trim()),
    );
    assert(!blank, "a blank assistant message is shown");
    await failing.close();
  });

  await check("5. Phone width: no horizontal scroll", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 0, `page scrolls horizontally by ${overflow}px`);
  });
} finally {
  await browser.close();
}

if (failures > 0) {
  console.log(`\n${failures} browser check(s) failed`);
  process.exit(1);
}
console.log("\nall browser checks passed");
