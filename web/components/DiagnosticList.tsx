"use client";

import { AlertTriangle, Info, OctagonAlert } from "lucide-react";

import type { DiagnosticWire } from "@/lib/api";

/**
 * Turn diagnostics, on screen.
 *
 * The findings were already produced, serialised and typed before V2-R; the
 * only missing step was rendering them, so `FORGE-W001`–`W004` were computed
 * for every turn and shown to nobody. INV-012 says no degradation is silent,
 * and a degradation the user cannot see is silent no matter how many server
 * logs record it.
 *
 * What this is NOT: a summary, a score, or a judgement about the prompt. It
 * shows the code, the severity, the message and the evidence, in that order,
 * because a diagnostic's purpose is to be checkable — a reader who disbelieves
 * it must be able to go and look. INV-008 forbids rolling these into a number,
 * and nothing here counts or ranks them.
 *
 * Severity is styled, not translated. `FORGE-W004` is an error because a
 * prompt write was blocked, and rendering it as a soft grey note would tell the
 * user the opposite of what happened.
 */

const STYLES = {
  error: {
    icon: OctagonAlert,
    box: "border-red-900/60 bg-red-950/30",
    code: "text-red-300",
    text: "text-red-200/90",
  },
  warning: {
    icon: AlertTriangle,
    box: "border-amber-900/60 bg-amber-950/30",
    code: "text-amber-300",
    text: "text-amber-200/90",
  },
  info: {
    icon: Info,
    box: "border-ink-700 bg-ink-900",
    code: "text-slate-300",
    text: "text-slate-400",
  },
} as const;

/**
 * Evidence, rendered as the thing it is rather than as prose.
 *
 * Each variant points at something independently checkable: a node that exists
 * in the IR, a byte range in an artifact, or a counted quantity with its unit.
 * An unknown shape is printed as JSON rather than dropped — a future evidence
 * kind should look unfamiliar, not invisible.
 */
function describeEvidence(item: Record<string, unknown>): string {
  switch (item["kind"]) {
    case "node":
      return `node ${String(item["node_id"])}`;
    case "span":
      return `${String(item["artifact_path"])} bytes ${String(item["start"])}–${String(item["end"])}`;
    case "measure":
      return `${String(item["label"])}: ${String(item["value"])} ${String(item["unit"])}`;
    default:
      return JSON.stringify(item);
  }
}

export function DiagnosticList({
  diagnostics,
}: {
  diagnostics: DiagnosticWire[];
}): React.JSX.Element | null {
  if (diagnostics.length === 0) return null;

  return (
    <div data-testid="turn-diagnostics" className="space-y-2">
      {diagnostics.map((d, i) => {
        const style = STYLES[d.severity] ?? STYLES.info;
        const Icon = style.icon;
        const evidence = d.evidence ?? [];
        return (
          <div
            key={`${d.code}-${i}`}
            data-testid="turn-diagnostic"
            data-code={d.code}
            data-severity={d.severity}
            className={`rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed ${style.box}`}
          >
            <div className="flex items-start gap-2">
              <Icon size={14} className={`mt-0.5 shrink-0 ${style.code}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`font-mono text-[11.5px] font-semibold ${style.code}`}>{d.code}</span>
                  <span className="font-mono text-[11px] text-slate-500">{d.name}</span>
                  {/* Whether a finding was computed or proposed by a model is
                      part of how much weight it deserves (INV-012), so it is
                      shown rather than flattened away. */}
                  <span className="font-mono text-[11px] text-slate-600">{d.source}</span>
                </div>
                <p className={`mt-1 ${style.text}`}>{d.message}</p>
                {evidence.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-500">
                    {evidence.map((item, j) => (
                      <li key={j}>{describeEvidence(item)}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
