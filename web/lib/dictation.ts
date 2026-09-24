/**
 * Voice → text for the composer. Not a voice agent: speech becomes editable
 * text in the message box, and nothing is sent until the user presses Send.
 *
 * The engine is an interface so the transport can change without touching
 * the composer. The one shipped engine is the browser's own speech
 * recognition (Web Speech API): FORGE receives text only — it never records,
 * uploads or stores audio. Where the browser has no recognizer (Firefox,
 * some embedded browsers) the microphone button says so instead of failing.
 * Note for the user, shown in the UI: Chromium-based browsers send the audio
 * to their vendor's speech service to recognise it.
 */

export type DictationError =
  | "unsupported"
  | "permission-denied"
  | "no-microphone"
  | "no-speech"
  | "network"
  | "failed";

export interface DictationHandlers {
  /** The whole transcript so far: final text plus the current interim guess. */
  onText(text: string): void;
  /** Recognition ended on its own or after stop(); `text` is the final transcript. */
  onEnd(text: string): void;
  onError(error: DictationError, detail?: string): void;
}

export interface DictationSession {
  /** Finish and keep what was heard. */
  stop(): void;
  /** Finish and discard what was heard. */
  cancel(): void;
}

export interface DictationEngine {
  readonly name: string;
  supported(): boolean;
  start(handlers: DictationHandlers, lang?: string): DictationSession;
}

/** Plain-language text for each failure, in the interface's voice. */
export const DICTATION_MESSAGES: Record<DictationError, string> = {
  unsupported: "This browser has no speech recognition. Use Chrome, Edge or Safari, or type instead.",
  "permission-denied": "Microphone access is blocked. Allow it in the browser's site settings, then try again.",
  "no-microphone": "No microphone was found. Connect one and try again.",
  "no-speech": "No speech was heard. Try again a little closer to the microphone.",
  network: "The browser's speech service could not be reached. Check your connection, or type instead.",
  failed: "Dictation stopped unexpectedly. Try again, or type instead.",
};

// The Web Speech API is not in TypeScript's DOM lib; this is the part used.
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  // Read through globalThis: the root typecheck has no DOM lib, and on the
  // server there is simply no window.
  const w = (globalThis as { window?: { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } })
    .window;
  if (!w) return null;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function mapError(code: string): DictationError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "audio-capture":
      return "no-microphone";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    default:
      return "failed";
  }
}

export const browserDictation: DictationEngine = {
  name: "browser speech recognition",
  supported: () => recognitionCtor() !== null,
  start(handlers, lang) {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      handlers.onError("unsupported");
      return { stop() {}, cancel() {} };
    }
    const rec = new Ctor();
    rec.lang = lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = "";
    let interim = "";
    let cancelled = false;
    let failed = false;
    const join = () => [finalText, interim].map((s) => s.trim()).filter(Boolean).join(" ");
    rec.onresult = (e) => {
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i]!;
        if (r.isFinal) finalText = `${finalText} ${r[0].transcript}`.trim();
        else interim += r[0].transcript;
      }
      if (!cancelled) handlers.onText(join());
    };
    rec.onerror = (e) => {
      // "aborted" is our own cancel; everything else is reported once.
      if (e.error === "aborted" || cancelled) return;
      failed = true;
      handlers.onError(mapError(e.error), e.message);
    };
    rec.onend = () => {
      if (cancelled || failed) return;
      // An interim guess at the moment of stopping is kept: it is what the user saw.
      handlers.onEnd(join());
    };
    try {
      rec.start();
    } catch (error) {
      failed = true;
      handlers.onError("failed", error instanceof Error ? error.message : String(error));
    }
    return {
      stop: () => rec.stop(),
      cancel: () => {
        cancelled = true;
        rec.abort();
      },
    };
  },
};

/**
 * Where dictated text goes in an existing draft: appended after what the user
 * already typed, never replacing it.
 */
export function mergeDictation(before: string, spoken: string): string {
  const said = spoken.trim();
  if (!said) return before;
  if (!before.trim()) return said;
  const kept = before.replace(/[ \t]+$/, "");
  return `${kept}${kept.endsWith("\n") ? "" : " "}${said}`;
}
