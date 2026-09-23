"use client";

import { Layers, Paperclip, RotateCcw, SendHorizonal, Square, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  ArtifactKindWire,
  AttachmentMeta,
  ChatMessage,
  DiagnosticWire,
  DiscoveryWire,
  OutputShapeWire,
  TransformationModeWire,
} from "@/lib/api";
import { Markdown } from "@/lib/markdown";

import { DiagnosticList } from "./DiagnosticList";
import { DiscoveryPanel } from "./DiscoveryPanel";

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
  /**
   * The finished turn's diagnostics (INV-012), shown beneath the reply.
   *
   * Turn-scoped, not conversation-scoped, and honestly so: these findings are
   * about what happened during one turn and are not persisted on the
   * conversation record, so they clear when the next turn starts or another
   * conversation is opened. Persisting them is a storage change, which is not
   * in V2-R's scope; showing them to the user who caused them is.
   */
  diagnostics: DiagnosticWire[];
  onSend: (text: string) => void;
  /** §22.11: the conversation's discovery state; the panel shows while it is open. */
  discovery: DiscoveryWire | null;
  /** WS-R31: the explicit generate control, with the WS-R38 mode when one is chosen. */
  onGenerate: (mode?: TransformationModeWire) => void;
  /** WS-R46: leave discovery without generating. */
  onCloseDiscovery: () => void;
  hasPrompt: boolean;
  unresolvedCount: number;
  /** WS-R39/WS-R40: the user's output settings, and how to change them. */
  artifactKind: ArtifactKindWire;
  outputShape: OutputShapeWire;
  onSettings: (patch: { artifactKind?: ArtifactKindWire; outputShape?: OutputShapeWire }) => void;
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

const EXAMPLES: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: "Start from an idea",
    text: "I want to build an AI agent for my small accounting practice, but I'm not sure what it should do first.",
  },
  {
    label: "Improve a prompt you have",
    text: "Paste a prompt you already use — FORGE asks at most two questions, then polishes, strengthens or rebuilds it.",
  },
  {
    label: "Build instructions for a coding agent",
    text: "Write instructions for Claude Code to build a CLI that syncs Notion pages to Markdown, with tests.",
  },
];

const KIND_LABEL: Record<ArtifactKindWire, string> = {
  unspecified: "Auto",
  agent: "Agent prompt",
  builder: "Build instructions",
};

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
  diagnostics,
  onSend,
  discovery,
  onGenerate,
  onCloseDiscovery,
  hasPrompt,
  unresolvedCount,
  artifactKind,
  outputShape,
  onSettings,
  onAttach,
  onStop,
  onRetry,
  canRetry,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, streamingReply, stageLabel, pendingUserMessage]);

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

  const mark = (
    <div aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-ink-800">
      <svg viewBox="0 0 32 32" className="h-3.5 w-3.5">
        <path d="M10 8h13v3.2h-9.4v3.6h8v3.2h-8V24H10z" fill="#e4e7ec" />
        <circle cx="23.5" cy="22.5" r="2.5" fill="#f5a55b" />
      </svg>
    </div>
  );
  const userBubble =
    "max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm border border-white/[0.06] bg-ink-800 px-4 py-2.5 text-[13.5px] leading-relaxed text-slate-100";
  const segment = (active: boolean): string =>
    `h-6 rounded px-2 text-[11.5px] transition-colors ${active ? "bg-ink-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`;

  return (
    <main className="workbench flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && !sending && pendingUserMessage === null ? (
          <div className="mx-auto max-w-2xl pt-6 sm:pt-12">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-50">What are you trying to get an agent to do?</h1>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-slate-400">
              Start from a vague idea or paste a prompt you already have. FORGE works out what you need, writes it only
              when you say so, then compiles it for the agents you use — and checks what came back.
            </p>
            <div className="mt-6 grid gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  onClick={() => {
                    if (example.label === "Improve a prompt you have") {
                      areaRef.current?.focus();
                      return;
                    }
                    if (ready && !sending) onSend(example.text);
                  }}
                  className="group rounded-lg border border-white/[0.07] bg-ink-900/70 px-4 py-3 text-left transition-colors hover:border-white/[0.14] hover:bg-ink-850"
                >
                  <div className="text-[12px] font-medium text-slate-300 group-hover:text-slate-100">{example.label}</div>
                  <div className="mt-0.5 text-[13px] leading-snug text-slate-500">{example.text}</div>
                </button>
              ))}
            </div>
            {!providerAvailable ? (
              <div className="mt-5 rounded-lg border border-amber-800/50 bg-amber-950/25 px-4 py-3 text-[13px] leading-relaxed text-amber-200/90">
                No model provider is configured. Open Settings to connect one.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "animate-fade-in"}>
                {m.role === "user" ? (
                  <div className={userBubble}>{m.content}</div>
                ) : (
                  <div className="flex gap-3">
                    {mark}
                    <div className="min-w-0 flex-1 text-[14px] text-slate-200">
                      <Markdown text={m.content} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {pendingUserMessage !== null ? (
              <div className="flex justify-end">
                <div className={userBubble}>{pendingUserMessage}</div>
              </div>
            ) : null}
            {sending && streamingReply ? (
              <div className="flex gap-3">
                {mark}
                <div className="min-w-0 flex-1 text-[14px] text-slate-200">
                  <Markdown text={streamingReply} />
                </div>
              </div>
            ) : null}
            {!sending ? <DiagnosticList diagnostics={diagnostics} /> : null}
            {sending ? (
              <div
                data-testid="turn-status"
                role="status"
                className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-ink-900/80 px-3 py-2 text-[13px] text-slate-300"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-400" />
                </span>
                <span data-testid="turn-stage">{stageLabel ?? "Starting…"}</span>
                <span data-testid="turn-elapsed" className="font-mono text-[12px] text-slate-500">
                  {formatElapsed(elapsed)}
                </span>
                <div className="flex-1" />
                <button
                  onClick={onStop}
                  data-testid="turn-stop"
                  title="Stop this turn. Nothing is saved."
                  className="flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2 py-1 text-[12px] text-slate-300 transition-colors hover:border-rose-800 hover:text-rose-200"
                >
                  <Square size={11} /> Stop
                </button>
              </div>
            ) : canRetry ? (
              <button
                onClick={onRetry}
                data-testid="turn-retry"
                title="Run the last message again"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-slate-200"
              >
                <RotateCcw size={12} /> Regenerate
              </button>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      {discovery?.status === "open" && !sending ? (
        <div className="px-4 pb-2 sm:px-6">
          <DiscoveryPanel
            discovery={discovery}
            disabled={sending || !ready}
            hasPrompt={hasPrompt}
            artifactKind={artifactKind}
            unresolvedCount={unresolvedCount}
            onAnswer={onSend}
            onGenerate={onGenerate}
            onClose={onCloseDiscovery}
            onArtifactKind={(kind) => onSettings({ artifactKind: kind })}
          />
        </div>
      ) : null}
      <div className="border-t border-white/[0.06] bg-ink-950/60 px-4 py-3 backdrop-blur sm:px-6">
        {attachments.length > 0 ? (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
            {attachments.map((a) => {
              const redacted = (a.redactions ?? []).reduce((n, r) => n + r.count, 0);
              return (
                <span
                  key={a.name}
                  data-testid="attachment-chip"
                  title={
                    redacted > 0
                      ? `${a.trust ?? "semi_trusted"} · ${redacted} secret${redacted === 1 ? "" : "s"} redacted before storage: ` +
                        (a.redactions ?? []).map((r) => `${r.rule}×${r.count}`).join(", ")
                      : `${a.trust ?? "semi_trusted"} · no secrets detected`
                  }
                  className={`rounded-md border px-2 py-1 font-mono text-[11px] ${
                    redacted > 0
                      ? "border-amber-800/50 bg-amber-950/25 text-amber-200/90"
                      : "border-white/[0.08] bg-ink-900 text-slate-400"
                  }`}
                >
                  {a.name}
                  {redacted > 0 ? <span className="ml-1.5">· {redacted} redacted</span> : null}
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="mx-auto max-w-3xl rounded-xl border border-white/[0.09] bg-ink-900 transition-colors focus-within:border-accent-400/70">
          <textarea
            ref={areaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            aria-label="Message"
            placeholder={
              discovery?.status === "open"
                ? "Answer in your own words, or ask something…"
                : hasPrompt
                  ? "Ask for a change, a critique or an explanation…"
                  : "Describe your idea, or paste a prompt of any size…"
            }
            disabled={!ready || sending}
            className="block max-h-60 min-h-[72px] w-full resize-y rounded-t-xl bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center gap-1.5 overflow-x-auto px-2 pb-2 no-scrollbar">
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
              title="Attach text, markdown or code files (scanned for secrets before storage)"
              aria-label="Attach files"
              onClick={() => fileRef.current?.click()}
              disabled={!ready || sending}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40"
            >
              <Paperclip size={15} />
            </button>
            <div
              role="radiogroup"
              aria-label="What FORGE writes"
              data-testid="artifact-kind"
              title="What the prompt is: the agent's own prompt, or instructions for a coding agent to build that agent."
              className="flex items-center gap-0.5 rounded-md border border-white/[0.07] bg-ink-850 p-0.5"
            >
              <Target size={12} className="mx-1 text-slate-500" aria-hidden />
              {(["unspecified", "agent", "builder"] as const).map((kind) => (
                <button
                  key={kind}
                  role="radio"
                  aria-checked={artifactKind === kind}
                  disabled={sending}
                  onClick={() => onSettings({ artifactKind: kind })}
                  className={segment(artifactKind === kind)}
                >
                  {KIND_LABEL[kind]}
                </button>
              ))}
            </div>
            <div
              role="radiogroup"
              aria-label="Output shape"
              data-testid="output-shape"
              title="One master prompt, or dependent stages for complex work — each stage a prompt for one agent run."
              className="flex items-center gap-0.5 rounded-md border border-white/[0.07] bg-ink-850 p-0.5"
            >
              <Layers size={12} className="mx-1 text-slate-500" aria-hidden />
              {(["single", "staged"] as const).map((shape) => (
                <button
                  key={shape}
                  role="radio"
                  aria-checked={outputShape === shape}
                  disabled={sending}
                  onClick={() => onSettings({ outputShape: shape })}
                  className={segment(outputShape === shape)}
                >
                  {shape === "single" ? "Single" : "Staged"}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <span className="hidden text-[11px] text-slate-600 2xl:inline">Enter to send · Shift+Enter for a new line</span>
            <button
              onClick={send}
              disabled={!draft.trim() || sending || !ready}
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500 text-white transition-colors hover:bg-accent-600 disabled:bg-ink-700 disabled:text-slate-500"
              title="Send"
            >
              <SendHorizonal size={15} />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
