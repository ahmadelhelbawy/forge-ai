import { Check, Mic, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  browserDictation,
  DICTATION_MESSAGES,
  mergeDictation,
  type DictationEngine,
  type DictationError,
  type DictationSession,
} from "@/lib/dictation";

/**
 * Dictate into the composer. The transcript is written into the draft as it
 * is heard, stays editable, and is never sent: the user presses Send.
 *
 * States: idle → listening → (Done keeps the text | Cancel restores the draft
 * as it was before recording). Escape cancels. A failure is shown beside the
 * button and never touches the draft.
 */
export function MicButton({
  draft,
  onDraft,
  disabled,
  engine = browserDictation,
  onListening,
}: {
  draft: string;
  onDraft: (text: string) => void;
  disabled: boolean;
  engine?: DictationEngine;
  onListening?: (listening: boolean) => void;
}): React.JSX.Element {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const session = useRef<DictationSession | null>(null);
  const before = useRef("");

  useEffect(() => setSupported(engine.supported()), [engine]);
  useEffect(() => onListening?.(listening), [listening, onListening]);
  // Leaving the page (or the conversation) mid-recording releases the microphone.
  useEffect(() => () => session.current?.cancel(), []);

  const finish = useCallback(() => {
    session.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || listening) return;
    setError(null);
    before.current = draft;
    setListening(true);
    session.current = engine.start({
      onText: (text) => onDraft(mergeDictation(before.current, text)),
      onEnd: (text) => {
        onDraft(mergeDictation(before.current, text));
        finish();
      },
      onError: (e) => {
        // Whatever was already heard stays in the draft, editable.
        setError(e);
        finish();
      },
    });
  }, [disabled, listening, draft, engine, onDraft, finish]);

  const stop = useCallback(() => session.current?.stop(), []);
  const cancel = useCallback(() => {
    session.current?.cancel();
    onDraft(before.current);
    finish();
  }, [onDraft, finish]);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, cancel]);

  if (listening) {
    return (
      <div className="flex shrink-0 items-center gap-1" data-testid="dictation-active" role="group" aria-label="Dictation">
        <span className="flex items-center gap-1.5 rounded-md border border-rose-800/60 bg-rose-950/30 px-2 py-1 text-[11.5px] text-rose-200" role="status">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-50 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
          </span>
          Listening
        </span>
        <button
          type="button"
          onClick={stop}
          data-testid="dictation-done"
          title="Stop and keep the text. Nothing is sent until you press Send."
          aria-label="Stop dictation and keep the text"
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-slate-200 hover:bg-white/[0.06]"
        >
          <Check size={13} /> Done
        </button>
        <button
          type="button"
          onClick={cancel}
          data-testid="dictation-cancel"
          title="Stop and discard what was dictated (Esc)"
          aria-label="Cancel dictation"
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  const unsupported = supported === false;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => (unsupported ? setError("unsupported") : start())}
        disabled={disabled}
        data-testid="dictation-start"
        aria-label="Dictate a message"
        title={
          unsupported
            ? DICTATION_MESSAGES.unsupported
            : "Dictate — speech becomes text you can edit before sending. Your browser does the recognition; FORGE stores no audio."
        }
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
          unsupported ? "text-slate-600" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
        }`}
      >
        <Mic size={15} />
      </button>
      {error ? (
        <span role="alert" data-testid="dictation-error" className="flex max-w-[22rem] items-center gap-1 text-[11.5px] leading-snug text-amber-300/90">
          {DICTATION_MESSAGES[error]}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-amber-300/70 hover:text-amber-200"
          >
            <X size={11} />
          </button>
        </span>
      ) : null}
    </div>
  );
}
