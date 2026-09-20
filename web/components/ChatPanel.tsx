"use client";

import { Paperclip, RotateCcw, SendHorizonal, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AttachmentMeta, ChatMessage } from "@/lib/api";
import { Markdown } from "@/lib/markdown";

interface Props {
  messages: ChatMessage[];
  attachments: AttachmentMeta[];
  sending: boolean;
  ready: boolean;
  providerAvailable: boolean;
  /** The reply as it streams in, before the turn is saved (WS-R10). */
  streamingReply: string;
  /**
   * The message the user just sent, shown before the server has echoed it.
   *
   * Without this the first turn of a conversation renders the welcome screen
   * while a request is in flight — the product looked frozen at exactly the
   * moment the user most needs to see that it is not.
   */
  pendingUserMessage: string | null;
  /** The current named stage (WS-R11). Never a spinner caption. */
  stageLabel: string | null;
  /** When the running turn started, for the elapsed clock. */
  startedAt: number | null;
  onSend: (text: string) => void;
  onAttach: (files: File[]) => void;
  onStop: () => void;
  onRetry: () => void;
  canRetry: boolean;
}

/** `1.4s`, then `12s`, then `1:05` — short enough to read at a glance. */
function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function ChatPanel({
  messages,
  attachments,
  sending,
  ready,
  providerAvailable,
  streamingReply,
  pendingUserMessage,
  stageLabel,
  startedAt,
  onSend,
  onAttach,
  onStop,
  onRetry,
  canRetry,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, streamingReply, stageLabel, pendingUserMessage]);

  // The clock is the honest part of "not frozen": it moves whether or not the
  // provider has sent a byte, which is exactly the case the user needs to see.
  useEffect(() => {
    if (!sending || startedAt === null) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - startedAt);
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [sending, startedAt]);

  const send = (): void => {
    const text = draft.trim();
    if (!text || sending || !ready) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 && !sending && pendingUserMessage === null ? (
          <div className="mx-auto max-w-2xl pt-10">
            <h1 className="text-xl font-semibold text-slate-100">Describe the prompt you need.</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-slate-400">
              Talk through an idea, paste an existing prompt or spec of any size, and FORGE will shape it
              into a working prompt — then iterate with you, one change at a time.
            </p>
            <div className="mt-5 space-y-2 text-[13px]">
              {[
                "I'm building a SaaS onboarding agent that reads our Postgres schema before suggesting changes…",
                "Paste a draft prompt and ask what is weak about it.",
                "Make the database section PostgreSQL and keep everything else.",
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => ready && !sending && onSend(example)}
                  className="block w-full rounded-lg border border-ink-700 bg-ink-900 px-4 py-2.5 text-left text-slate-300 transition-colors hover:border-ink-600 hover:bg-ink-850"
                >
                  {example}
                </button>
              ))}
            </div>
            {!providerAvailable ? (
              <div className="mt-5 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-[13px] leading-relaxed text-amber-200/90">
                No model provider is configured on this server. Set <code className="font-mono">ANTHROPIC_API_KEY</code> or{" "}
                <code className="font-mono">FORGE_API_KEY</code> (plus <code className="font-mono">FORGE_BASE_URL</code> for
                OpenAI-compatible gateways) and restart.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap rounded-xl bg-ink-700 px-4 py-2.5 text-[13.5px] leading-relaxed text-slate-100"
                      : "max-w-full"
                  }
                >
                  {m.role === "user" ? (
                    m.content
                  ) : (
                    <div className="flex gap-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-500 font-mono text-[11px] font-bold text-white">
                        F
                      </div>
                      <div className="min-w-0 flex-1">
                        <Markdown text={m.content} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pendingUserMessage !== null ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-ink-700 px-4 py-2.5 text-[13.5px] leading-relaxed text-slate-100">
                  {pendingUserMessage}
                </div>
              </div>
            ) : null}
            {sending && streamingReply ? (
              <div className="max-w-full">
                <div className="flex gap-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-500 font-mono text-[11px] font-bold text-white">
                    F
                  </div>
                  <div className="min-w-0 flex-1">
                    <Markdown text={streamingReply} />
                  </div>
                </div>
              </div>
            ) : null}
            {sending ? (
              <div
                data-testid="turn-status"
                className="flex items-center gap-2.5 text-[13px] text-slate-400"
              >
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-400" />
                <span data-testid="turn-stage">{stageLabel ?? "Starting…"}</span>
                <span data-testid="turn-elapsed" className="font-mono text-[12px] text-slate-500">
                  {formatElapsed(elapsed)}
                </span>
                <button
                  onClick={onStop}
                  data-testid="turn-stop"
                  title="Stop this turn. Nothing is saved."
                  className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-[12px] text-slate-300 transition-colors hover:border-red-800 hover:text-red-200"
                >
                  <Square size={11} /> Stop
                </button>
              </div>
            ) : canRetry ? (
              <button
                onClick={onRetry}
                data-testid="turn-retry"
                title="Run the last message again"
                className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-[12px] text-slate-400 transition-colors hover:border-ink-600 hover:text-slate-200"
              >
                <RotateCcw size={12} /> Regenerate
              </button>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      <div className="border-t border-ink-800 px-6 py-3">
        {attachments.length > 0 ? (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span key={a.name} className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-400">
                {a.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) onAttach(files);
            }}
          />
          <button
            title="Attach text, markdown, or code files"
            onClick={() => fileRef.current?.click()}
            disabled={!ready || sending}
            className="rounded-lg border border-ink-700 bg-ink-900 p-2.5 text-slate-400 transition-colors hover:border-ink-600 hover:text-slate-200 disabled:opacity-40"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            placeholder={ready ? "Describe your idea, paste a prompt, or request a change…" : "Start a new chat first…"}
            disabled={!ready || sending}
            className="max-h-48 min-h-[76px] flex-1 resize-y rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!draft.trim() || sending || !ready}
            className="rounded-lg bg-accent-500 p-2.5 text-white transition-colors hover:bg-accent-400 disabled:opacity-40"
            title="Send"
          >
            <SendHorizonal size={16} />
          </button>
        </div>
        <div className="mx-auto mt-1.5 max-w-3xl text-[11px] text-slate-600">
          Enter to send · Shift+Enter for a new line. Large pastes welcome.
        </div>
      </div>
    </div>
  );
}
