"use client";

/**
 * Where this conversation stands in FORGE's flow — idea, discovery, prompt,
 * requirements, compiled contract, evidence — as one rail in the header.
 *
 * The stages are a real sequence, so they are numbered. Every state shown is
 * read from the conversation itself (its discovery status, versions, ledger
 * and persisted verifications); nothing here is inferred or optimistic. A stage
 * that has not happened is shown as available, never as done.
 */
export type RailStage = "brief" | "prompt" | "requirements" | "compile";

type StageState = "done" | "active" | "available" | "idle";

export interface RailInput {
  readonly discovery: { status: "open" | "generated" | "closed" } | null;
  readonly versions: number;
  readonly pinned: number;
  readonly verifications: ReadonlyArray<{ counts: Record<string, number> }>;
  readonly busy: boolean;
}

interface Step {
  readonly key: RailStage;
  readonly label: string;
  readonly state: StageState;
  readonly detail: string;
}

export function railSteps(input: RailInput): Step[] {
  const d = input.discovery;
  const hasPrompt = input.versions > 0;
  const last = input.verifications.at(-1);
  const failed = last ? (last.counts["FAILED"] ?? 0) : 0;
  const verified = last ? (last.counts["VERIFIED"] ?? 0) : 0;
  return [
    {
      key: "brief",
      label: "Discover",
      state: d === null ? (hasPrompt ? "idle" : "available") : d.status === "open" ? "active" : "done",
      detail:
        d === null
          ? hasPrompt
            ? "Skipped — the prompt was written directly"
            : "FORGE asks when an idea is still vague"
          : d.status === "open"
            ? "Discovery is open: nothing is written until you generate"
            : d.status === "closed"
              ? "Discovery was closed without generating"
              : "The brief the prompt was generated from",
    },
    {
      key: "prompt",
      label: "Prompt",
      state: hasPrompt ? "done" : d?.status === "open" ? "idle" : "available",
      detail: hasPrompt ? `${input.versions} version${input.versions === 1 ? "" : "s"}` : "No prompt yet",
    },
    {
      key: "requirements",
      label: "Requirements",
      state: input.pinned > 0 ? "done" : hasPrompt ? "available" : "idle",
      detail: input.pinned > 0 ? `${input.pinned} pinned and checked on every version` : "Pin what must never be dropped",
    },
    {
      key: "compile",
      label: "Contract",
      state: hasPrompt ? "available" : "idle",
      detail: hasPrompt ? "Compile for targets, package, explain" : "Needs a prompt",
    },
    {
      key: "compile",
      label: "Evidence",
      // A run with failures is not "done": the accent dot read as success.
      state: last ? (failed > 0 ? "active" : "done") : hasPrompt ? "available" : "idle",
      detail: last
        ? `Last verification: ${verified} verified, ${failed} failed`
        : "Paste an external run's evidence to verify — FORGE never runs it",
    },
  ];
}

const DOT: Record<StageState, string> = {
  done: "bg-accent-400 shadow-[0_0_0_3px_rgba(98,176,220,0.15)]",
  active: "bg-ember-400 shadow-[0_0_0_3px_rgba(245,165,91,0.18)]",
  available: "border border-ink-500 bg-transparent",
  idle: "border border-ink-600 bg-transparent opacity-50",
};

export function PipelineRail({
  input,
  onOpen,
}: {
  input: RailInput;
  onOpen: (stage: RailStage) => void;
}): React.JSX.Element {
  const steps = railSteps(input);
  return (
    <nav aria-label="Where this conversation is" data-testid="pipeline-rail" className="flex min-w-0 items-center">
      <ol className="flex items-center">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center">
            {i > 0 ? (
              <span
                aria-hidden
                className={`mx-1 h-px w-3 2xl:mx-1.5 2xl:w-5 ${
                  step.state === "done" || step.state === "active" ? "bg-accent-400/40" : "bg-ink-600"
                }`}
              />
            ) : null}
            <button
              type="button"
              onClick={() => onOpen(step.key)}
              title={`${step.label} — ${step.detail}`}
              data-state={step.state}
              className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] transition-colors hover:bg-white/[0.04]"
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[step.state]} ${step.state === "active" && input.busy ? "animate-pulse" : ""}`} />
              <span className="font-mono text-[10.5px] text-slate-500">{i + 1}</span>
              <span
                className={`${step.state === "done" || step.state === "active" ? "" : "hidden 2xl:inline"} ${
                  step.state === "done" || step.state === "active"
                    ? "text-slate-200"
                    : step.state === "available"
                      ? "text-slate-400 group-hover:text-slate-200"
                      : "text-slate-600"
                }`}
              >
                {step.label}
              </span>
              {step.state === "done" || step.state === "active" ? null : <span className="sr-only 2xl:hidden">{step.label}</span>}
              <span className="sr-only">— {step.detail}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
