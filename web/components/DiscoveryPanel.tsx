"use client";

import { Compass, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import type { DiscoveryWire } from "@/lib/api";

/**
 * Discovery, in the chat column (§22.11).
 *
 * The questions FORGE is asking, each with its suggested answers as chips and
 * a free-text box — an answer is never limited to the options. Submitting
 * composes one ordinary message, so the transcript reads as the conversation
 * it was. The Generate button is the only way out of discovery (WS-R31): FORGE
 * may say it is ready, which highlights the button, but never presses it.
 */
export function DiscoveryPanel({
  discovery,
  disabled,
  onAnswer,
  onGenerate,
}: {
  discovery: DiscoveryWire;
  disabled: boolean;
  onAnswer: (text: string) => void;
  onGenerate: () => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState<Record<number, string>>({});

  // New questions, new answers.
  const key = discovery.questions.map((q) => q.question).join("|");
  useEffect(() => {
    setChosen({});
    setTyped({});
  }, [key]);

  const unresolved = new Set([...(discovery.brief.open_questions ?? []), ...discovery.questions.map((q) => q.question)]).size;
  const answers = discovery.questions
    .map((q, i) => {
      const parts = [chosen[i], typed[i]?.trim()].filter((x): x is string => Boolean(x));
      return parts.length > 0 ? `**${q.question}**\n${parts.join(" — ")}` : null;
    })
    .filter((x): x is string => x !== null);

  return (
    <div data-testid="discovery-panel" className="mx-auto w-full max-w-3xl rounded-xl border border-ink-700 bg-ink-900/70 px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-slate-300">
        <Compass size={13} /> Working out what to build
        <span className="ml-auto font-normal text-slate-500">nothing is written until you press Generate</span>
      </div>

      {discovery.questions.map((q, i) => (
        <div key={q.question} className="mb-3" data-testid={`discovery-question-${i}`}>
          <div className="mb-1.5 text-[13.5px] text-slate-200">{q.question}</div>
          {q.options.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {q.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  data-testid="discovery-option"
                  onClick={() => setChosen((c) => ({ ...c, [i]: c[i] === option ? "" : option }))}
                  className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                    chosen[i] === option
                      ? "border-accent-500 bg-accent-500/15 text-slate-100"
                      : "border-ink-700 text-slate-400 hover:border-ink-600 hover:text-slate-200"
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
            placeholder={q.options.length > 0 ? "Or say it in your own words…" : "Your answer…"}
            data-testid={`discovery-text-${i}`}
            className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-[13px] text-slate-200 focus:border-accent-500 focus:outline-none"
          />
        </div>
      ))}

      {discovery.research_needed ? (
        <div className="mb-2 rounded-md border border-amber-900/50 bg-amber-950/20 px-2.5 py-1.5 text-[12px] text-amber-200/90">
          Needs current research FORGE cannot do: {discovery.research_needed}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {discovery.questions.length > 0 ? (
          <button
            type="button"
            disabled={disabled || answers.length === 0}
            onClick={() => onAnswer(answers.join("\n\n"))}
            data-testid="discovery-submit"
            className="rounded-lg bg-accent-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-400 disabled:opacity-40"
          >
            Submit answers
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={onGenerate}
          data-testid="discovery-generate"
          className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-40 ${
            discovery.ready
              ? "border-emerald-600 bg-emerald-600/15 text-emerald-200 hover:bg-emerald-600/25"
              : "border-ink-700 text-slate-300 hover:border-ink-600 hover:text-slate-100"
          }`}
        >
          <Sparkles size={13} />
          {unresolved > 0 ? "Generate now with what we know" : "Generate prompt"}
        </button>
        <span className="text-[11.5px] text-slate-500">
          {discovery.ready ? "FORGE thinks there is enough to write a good prompt." : ""}
          {unresolved > 0 ? ` ${unresolved} question${unresolved === 1 ? "" : "s"} still open — they will be stated as assumptions.` : ""}
        </span>
      </div>
    </div>
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

/** The evolving brief, in the Studio. Only fields that hold something are shown. */
export function DiscoveryBrief({ discovery }: { discovery: DiscoveryWire }): React.JSX.Element {
  const rows = LABELS.filter(([k]) => {
    const v = discovery.brief[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
  return (
    <div data-testid="discovery-brief" className="space-y-2.5 py-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        What FORGE understands so far {discovery.status === "generated" ? "· generated" : "· discovering"}
      </div>
      {rows.length === 0 ? (
        <div className="text-[13px] text-slate-500">Nothing yet — answer a question or two.</div>
      ) : (
        rows.map(([k, label]) => {
          const v = discovery.brief[k];
          return (
            <div key={k}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
              {Array.isArray(v) ? (
                <ul className="ml-4 list-disc text-[13px] leading-relaxed text-slate-200">
                  {v.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-[13px] leading-relaxed text-slate-200">{v}</div>
              )}
            </div>
          );
        })
      )}
      <div className="text-[11px] text-slate-500">This is FORGE&apos;s summary of the conversation, not your words.</div>
    </div>
  );
}
