"use client";

import { Compass, FileText, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ArtifactKindWire, CoverageItemWire, DiscoveryWire, TransformationModeWire } from "@/lib/api";

const MODES: ReadonlyArray<{ mode: TransformationModeWire; label: string; hint: string }> = [
  { mode: "polish", label: "Polish", hint: "Keep its structure and wording; fix ambiguity, contradictions and errors only." },
  { mode: "strengthen", label: "Strengthen", hint: "Keep its intent and structure; add missing constraints, success criteria, verification and edge cases." },
  { mode: "rebuild", label: "Rebuild", hint: "Re-derive the structure from the intent; every requirement is carried, nothing dropped." },
];

const KIND_TEXT: Record<"agent" | "builder", string> = {
  agent: "the agent's own prompt",
  builder: "instructions for a coding agent to build it",
};

/**
 * Discovery, in the chat column (§22.11, §22.12).
 *
 * The questions FORGE is asking, each with suggested answers as chips and a
 * free-text box — an answer is never limited to the options. Submitting
 * composes one ordinary message, so the transcript reads as the conversation
 * it was. Generate is the only way to a prompt (WS-R31); FORGE may say it is
 * ready, which lights the button, but never presses it. The user can also
 * leave without generating (WS-R46).
 */
export function DiscoveryPanel({
  discovery,
  disabled,
  hasPrompt,
  artifactKind,
  unresolvedCount,
  onAnswer,
  onGenerate,
  onClose,
  onArtifactKind,
}: {
  discovery: DiscoveryWire;
  disabled: boolean;
  hasPrompt: boolean;
  artifactKind: ArtifactKindWire;
  /** WS-R32: computed by the server, the same set W010 would name. */
  unresolvedCount: number;
  onAnswer: (text: string) => void;
  onGenerate: (mode?: TransformationModeWire) => void;
  onClose: () => void;
  onArtifactKind: (kind: ArtifactKindWire) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState<Record<number, string>>({});
  const refine = discovery.flavor === "refine";
  const withModes = refine || hasPrompt;
  const [mode, setMode] = useState<TransformationModeWire>("strengthen");

  // New questions, new answers.
  const key = discovery.questions.map((q) => q.question).join("|");
  useEffect(() => {
    setChosen({});
    setTyped({});
  }, [key]);

  const unresolved = unresolvedCount;
  const answers = discovery.questions
    .map((q, i) => {
      const parts = [chosen[i], typed[i]?.trim()].filter((x): x is string => Boolean(x));
      // Plain text: the transcript shows the user's message verbatim, not as markdown.
      return parts.length > 0 ? `${q.question}\n→ ${parts.join(" — ")}` : null;
    })
    .filter((x): x is string => x !== null);
  const suggestion = discovery.artifact_kind && artifactKind === "unspecified" ? discovery.artifact_kind : null;

  return (
    <section
      data-testid="discovery-panel"
      aria-label={refine ? "Refine your prompt" : "Discovery"}
      className="mx-auto w-full max-w-3xl animate-fade-in rounded-xl border border-white/[0.08] bg-ink-900/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        {refine ? <FileText size={14} className="text-accent-300" /> : <Compass size={14} className="text-ember-400" />}
        <h2 className="text-[13px] font-medium text-slate-100">
          {refine ? "Before FORGE changes your prompt" : "Working out what to build"}
        </h2>
        <span className="ml-auto hidden text-[11.5px] text-slate-500 sm:inline">Nothing is written until you generate</span>
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          data-testid="discovery-close"
          title="Leave discovery without generating. The brief is kept and you can reopen it."
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40"
        >
          <X size={12} /> Leave
        </button>
      </header>

      <div className="max-h-[42vh] space-y-3 overflow-y-auto px-4 py-3">
        {suggestion ? (
          <div data-testid="artifact-kind-suggestion" className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-400/25 bg-accent-500/[0.08] px-3 py-2 text-[12.5px] text-slate-200">
            <span>
              FORGE reads this as <strong className="font-medium">{KIND_TEXT[suggestion]}</strong>. Is that right?
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onArtifactKind(suggestion)}
              className="rounded-md bg-accent-500 px-2 py-0.5 text-[12px] text-white hover:bg-accent-600 disabled:opacity-40"
            >
              Yes
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onArtifactKind(suggestion === "agent" ? "builder" : "agent")}
              className="rounded-md border border-white/[0.1] px-2 py-0.5 text-[12px] text-slate-300 hover:border-white/[0.2] disabled:opacity-40"
            >
              No — {KIND_TEXT[suggestion === "agent" ? "builder" : "agent"]}
            </button>
          </div>
        ) : null}

        {discovery.questions.length === 0 ? (
          <p className="text-[13px] text-slate-400">
            {refine ? "Nothing material is unclear. Choose how FORGE should work on it and generate." : "No open questions right now."}
          </p>
        ) : null}

        {discovery.questions.map((q, i) => (
          <div key={q.question} data-testid={`discovery-question-${i}`}>
            <div className="mb-1.5 text-[13.5px] leading-snug text-slate-100">{q.question}</div>
            {q.options.length > 0 ? (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {q.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={disabled}
                    aria-pressed={chosen[i] === option}
                    data-testid="discovery-option"
                    onClick={() => setChosen((c) => ({ ...c, [i]: c[i] === option ? "" : option }))}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      chosen[i] === option
                        ? "border-accent-400 bg-accent-500/20 text-slate-50"
                        : "border-white/[0.09] text-slate-400 hover:border-white/[0.18] hover:text-slate-200"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              value={typed[i] ?? ""}
              disabled={disabled}
              onChange={(e) => setTyped((t) => ({ ...t, [i]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answers.length > 0 && !disabled) onAnswer(answers.join("\n\n"));
              }}
              aria-label={`Answer: ${q.question}`}
              placeholder={q.options.length > 0 ? "Or say it in your own words…" : "Your answer…"}
              data-testid={`discovery-text-${i}`}
              className="h-8 w-full rounded-md border border-white/[0.08] bg-ink-850 px-2.5 text-[13px] text-slate-100 placeholder:text-slate-600 focus:border-accent-400 focus:outline-none"
            />
          </div>
        ))}

        {discovery.research_needed ? (
          <div className="rounded-md border border-amber-800/40 bg-amber-950/20 px-2.5 py-1.5 text-[12px] text-amber-200/90">
            Needs current research FORGE cannot do: {discovery.research_needed}
          </div>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
        {discovery.questions.length > 0 ? (
          <button
            type="button"
            disabled={disabled || answers.length === 0}
            onClick={() => onAnswer(answers.join("\n\n"))}
            data-testid="discovery-submit"
            className="h-8 rounded-lg border border-white/[0.1] bg-ink-800 px-3 text-[13px] font-medium text-slate-100 hover:border-white/[0.2] disabled:opacity-40"
          >
            Send answers
          </button>
        ) : null}
        <div className="flex-1" />
        {withModes ? (
          <div role="radiogroup" aria-label="How FORGE should change the prompt" className="flex rounded-lg border border-white/[0.08] bg-ink-850 p-0.5">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={mode === m.mode}
                title={m.hint}
                data-testid={`mode-${m.mode}`}
                onClick={() => setMode(m.mode)}
                className={`h-7 rounded-md px-2.5 text-[12px] transition-colors ${
                  mode === m.mode ? "bg-ink-700 text-slate-50" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onGenerate(withModes ? mode : undefined)}
          data-testid="discovery-generate"
          title={unresolved > 0 ? `${unresolved} open question(s) will be stated as assumptions in the prompt.` : "Write the prompt now."}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
            discovery.ready || refine
              ? "bg-ember-500 text-[#1a0d02] hover:bg-ember-400"
              : "border border-ember-500/50 text-ember-300 hover:bg-ember-500/10"
          }`}
        >
          <Sparkles size={13} />
          {withModes ? `Generate — ${MODES.find((m) => m.mode === mode)!.label.toLowerCase()}` : unresolved > 0 ? "Generate with what we know" : "Generate prompt"}
        </button>
      </footer>
      {unresolved > 0 || discovery.ready ? (
        <div className="px-4 pb-2.5 text-[11.5px] text-slate-500">
          {discovery.ready ? "FORGE thinks there is enough to write a good prompt. " : ""}
          {unresolved > 0 ? `${unresolved} question${unresolved === 1 ? "" : "s"} still open — generating states them as assumptions.` : ""}
        </div>
      ) : null}
    </section>
  );
}

const LABELS: ReadonlyArray<readonly [keyof DiscoveryWire["brief"], string]> = [
  ["vision", "Vision"],
  ["goal", "Goal"],
  ["target_user", "Target user"],
  ["problem", "Problem"],
  ["background", "Background / skill level"],
  ["capabilities", "Capabilities"],
  ["constraints", "Constraints"],
  ["success_criteria", "Success criteria"],
  ["open_questions", "Open questions"],
];

const COVERAGE_TEXT: Record<CoverageItemWire["status"], { label: string; title: string; tone: string }> = {
  worded: {
    label: "in prompt",
    title: "The prompt carries this item's words, with the same meaning (no negation flipped).",
    tone: "border-accent-400/25 text-accent-300",
  },
  cited: {
    label: "in prompt · cited",
    title: "Paraphrased. The model pointed at the passage below and FORGE found it word for word in the prompt — whether it means the same is the model's claim; check it.",
    tone: "border-accent-400/25 text-accent-300",
  },
  contradicted: {
    label: "may contradict",
    title: "The passage that carries this item's words appears to negate it. Check the passage below.",
    tone: "border-amber-700/50 text-amber-300",
  },
  absent: {
    label: "not found",
    title: "Neither this item's words nor a verified citation are in the prompt. Ask FORGE to add it, or ignore it if you dropped it on purpose.",
    tone: "border-amber-700/50 text-amber-300",
  },
};

function Item({
  text,
  mark,
  coverage,
}: {
  text: string;
  mark: "stated" | "inferred" | undefined;
  coverage?: CoverageItemWire | undefined;
}): React.JSX.Element {
  const c = coverage ? COVERAGE_TEXT[coverage.status] : null;
  return (
    <span>
      {text}
      {c ? (
        <span
          title={c.title}
          data-testid="brief-coverage"
          data-status={coverage!.status}
          className={`ml-1.5 whitespace-nowrap rounded border px-1 py-px align-middle text-[10.5px] ${c.tone}`}
        >
          {c.label}
        </span>
      ) : null}
      {coverage?.passage && coverage.status !== "worded" ? (
        <span className="mt-0.5 block border-l-2 border-white/[0.08] pl-2 text-[11.5px] italic leading-snug text-slate-500">
          “{coverage.passage}”
        </span>
      ) : null}
      {mark === "inferred" ? (
        <span
          title="FORGE's reading — your messages do not say this. Correct it by answering in the chat."
          className="ml-1.5 rounded border border-white/[0.08] px-1 py-px align-middle text-[10.5px] text-slate-500"
        >
          inferred
        </span>
      ) : null}
    </span>
  );
}

/**
 * The evolving brief, in the Studio. Only fields that hold something are
 * shown, and every item FORGE inferred rather than heard says so (WS-R45). It
 * stays after a generate or a close: it is the record of how the prompt came
 * to be (WS-R46).
 */
export function DiscoveryBrief({
  discovery,
  marks = {},
  onReopen,
}: {
  discovery: DiscoveryWire;
  marks?: Record<string, "stated" | "inferred">;
  onReopen?: () => void;
}): React.JSX.Element {
  const generated = discovery.status === "generated";
  const rows = LABELS.filter(([k]) => {
    // After a generate, open questions are no longer an interview: they are
    // shown once, below, as what FORGE decided (WS-R32).
    if (k === "open_questions" && generated && discovery.decided) return false;
    const v = discovery.brief[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
  const coverageByText = new Map((discovery.coverage?.items ?? []).map((c) => [c.text, c]));
  const flagged = (discovery.coverage?.items ?? []).filter((c) => c.status === "absent" || c.status === "contradicted");
  const inferred = Object.values(marks).filter((m) => m === "inferred").length;
  const status =
    discovery.status === "open"
      ? "Discovering"
      : generated
        ? `Prompt generated from this brief${discovery.coverage ? ` (version ${discovery.coverage.v})` : ""}`
        : "Discovery closed";
  return (
    <div data-testid="discovery-brief" className="space-y-3 py-1">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${discovery.status === "open" ? "bg-ember-400" : "bg-accent-400"}`} />
        <span className="text-[12px] text-slate-400">{status}</span>
        <div className="flex-1" />
        {discovery.status !== "open" && onReopen ? (
          <button
            onClick={onReopen}
            data-testid="discovery-reopen"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
          >
            <RotateCcw size={12} /> Reopen discovery
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className="text-[13px] text-slate-500">Nothing yet — answer a question or two.</div>
      ) : (
        rows.map(([k, label]) => {
          const v = discovery.brief[k];
          return (
            <div key={k}>
              <div className="mb-0.5 text-[11.5px] font-medium text-slate-500">{label}</div>
              {Array.isArray(v) ? (
                <ul className="ml-4 list-disc space-y-0.5 text-[13px] leading-relaxed text-slate-200">
                  {v.map((item) => (
                    <li key={item}>
                      <Item text={item} mark={marks[item]} coverage={coverageByText.get(item)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] leading-relaxed text-slate-200">
                  <Item text={v ?? ""} mark={v ? marks[v] : undefined} coverage={v ? coverageByText.get(v) : undefined} />
                </div>
              )}
            </div>
          );
        })
      )}
      {generated && discovery.decided && discovery.decided.length > 0 ? (
        <div data-testid="brief-decided">
          <div className="mb-0.5 text-[11.5px] font-medium text-slate-500">Decided for you at generate</div>
          <ul className="ml-4 list-disc space-y-0.5 text-[13px] leading-relaxed text-slate-400">
            {discovery.decided.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11.5px] text-slate-500">
            You generated before these were answered, so FORGE chose sensible defaults — the reply to that turn says which. Reopen discovery to answer any of them.
          </p>
        </div>
      ) : null}
      {discovery.coverage && flagged.length === 0 ? (
        <p className="text-[11.5px] text-slate-500">
          Every goal, constraint and success criterion is in version {discovery.coverage.v}. Cited items are the model&apos;s paraphrases, found word for word in the prompt.
        </p>
      ) : null}
      <p className="border-t border-white/[0.06] pt-2 text-[11.5px] leading-relaxed text-slate-500">
        FORGE&apos;s summary of the conversation, not your words
        {inferred > 0 ? ` — ${inferred} item${inferred === 1 ? " is" : "s are"} FORGE's inference, marked above` : ""}. It never becomes a
        pinned requirement; pin what must survive in Requirements.
      </p>
    </div>
  );
}
