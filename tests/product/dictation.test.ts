/**
 * Voice → text (pre-release hardening). The engine turns speech into draft
 * text only: it never sends, and a cancel restores nothing but the draft.
 */
import { afterEach, describe, expect, it } from "vitest";

import { browserDictation, mergeDictation, type DictationError } from "../../web/lib/dictation";

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  aborted = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  say(results: Array<[string, boolean]>, resultIndex = 0) {
    this.onresult?.({ resultIndex, results: results.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) });
  }
}

const g = globalThis as unknown as { window?: unknown };
afterEach(() => {
  delete g.window;
});

function handlers() {
  const log = { text: [] as string[], end: [] as string[], errors: [] as DictationError[] };
  return {
    log,
    h: {
      onText: (t: string) => log.text.push(t),
      onEnd: (t: string) => log.end.push(t),
      onError: (e: DictationError) => log.errors.push(e),
    },
  };
}

describe("browser dictation", () => {
  it("reports unsupported when the browser has no recognizer", () => {
    g.window = {};
    expect(browserDictation.supported()).toBe(false);
    const { log, h } = handlers();
    browserDictation.start(h);
    expect(log.errors).toEqual(["unsupported"]);
  });

  it("streams final + interim text, and Done keeps the transcript", () => {
    g.window = { webkitSpeechRecognition: FakeRecognition };
    const { log, h } = handlers();
    const session = browserDictation.start(h, "en-US");
    const rec = FakeRecognition.last!;
    expect(rec.started && rec.continuous && rec.interimResults).toBe(true);
    rec.say([["build an agent", true], [" that triages", false]]);
    expect(log.text.at(-1)).toBe("build an agent that triages");
    // A recognizer may re-deliver earlier finals from index 0: no duplication.
    rec.say([["build an agent", true], ["that triages email", true]]);
    expect(log.text.at(-1)).toBe("build an agent that triages email");
    session.stop();
    expect(log.end).toEqual(["build an agent that triages email"]);
  });

  it("a session that recognised nothing says so instead of ending silently", () => {
    g.window = { webkitSpeechRecognition: FakeRecognition };
    const { log, h } = handlers();
    const session = browserDictation.start(h, "en-US");
    session.stop();
    expect(log.end).toEqual([]);
    expect(log.errors).toEqual(["no-result"]);
  });

  it("cancel reports nothing: no end, no error", () => {
    g.window = { SpeechRecognition: FakeRecognition };
    const { log, h } = handlers();
    const session = browserDictation.start(h);
    FakeRecognition.last!.say([["hello", true]]);
    session.cancel();
    expect(FakeRecognition.last!.aborted).toBe(true);
    expect(log.end).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  it("maps a permission denial to a named error, once", () => {
    g.window = { SpeechRecognition: FakeRecognition };
    const { log, h } = handlers();
    browserDictation.start(h);
    FakeRecognition.last!.onerror?.({ error: "not-allowed" });
    FakeRecognition.last!.onend?.();
    expect(log.errors).toEqual(["permission-denied"]);
    expect(log.end).toEqual([]);
  });

  it("appends to what the user already typed, never replacing it", () => {
    expect(mergeDictation("", "hello")).toBe("hello");
    expect(mergeDictation("Draft:", "hello")).toBe("Draft: hello");
    expect(mergeDictation("Line one\n", "hello")).toBe("Line one\nhello");
    expect(mergeDictation("keep me", "  ")).toBe("keep me");
  });
});
