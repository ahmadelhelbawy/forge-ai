"use client";

import { Download, Hammer } from "lucide-react";
import { useState } from "react";

import { DiagnosticList } from "./DiagnosticList";
import { api, type CompileResponse, type TargetInfo } from "@/lib/api";

/**
 * The compile surface (V2-R step 9).
 *
 * Until now the workspace ended at prose and the compiler was reachable only
 * from the CLI, so the profile registry, the capability gates and every
 * `FORGE-C0xx` diagnostic were invisible to anyone using the product. This pane
 * is where a user sees them: pick a target, compile the current prompt, read
 * the artifacts the target's own topology defines — or read the refusal.
 *
 * A REFUSAL IS NOT AN ERROR and is not rendered as one. A target that cannot do
 * what the prompt requires should refuse (FORGE-C030), and that refusal is the
 * single most useful answer the compiler gives: it is the difference between
 * finding out here and finding out when the agent fails. So a refused
 * compilation shows its diagnostics prominently and shows no artifacts, because
 * there are none.
 *
 * Compiling writes no prompt version. The prose stays the truth (WS-R2); this
 * is a read of it.
 */
export function CompilePanel({
  conversationId,
  targets,
  defaultTarget,
  hasPrompt,
}: {
  conversationId: string | null;
  targets: TargetInfo[];
  defaultTarget: string;
  hasPrompt: boolean;
}): React.JSX.Element {
  const [target, setTarget] = useState(defaultTarget);
  const [result, setResult] = useState<CompileResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (!conversationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const compiled = await api.compileVersion(conversationId, { target });
      setResult(compiled);
      setOpen(compiled.artifacts[0]?.path ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const download = (path: string, content: string): void => {
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = path.split("/").pop() ?? "artifact.md";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!conversationId || !hasPrompt) {
    return (
      <div className="py-10 text-center text-[13px] leading-relaxed text-slate-500">
        Nothing to compile yet.
        <br />
        Produce a prompt first, then compile it for a target.
      </div>
    );
  }

  const shown = result?.artifacts.find((a) => a.path === open) ?? result?.artifacts[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-testid="compile-target"
          className="flex-1 rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-[12.5px] text-slate-200 focus:border-accent-500 focus:outline-none"
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={busy}
          data-testid="compile-run"
          className="flex items-center gap-1.5 rounded-md bg-accent-500 px-3 py-1.5 text-[12.5px] text-white transition-colors hover:bg-accent-400 disabled:opacity-40"
        >
          <Hammer size={13} /> {busy ? "Compiling…" : "Compile"}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3.5 py-2.5 text-[13px] text-red-200/90">
          {error}
        </div>
      ) : null}

      {result ? (
        <>
          <div className="font-mono text-[11px] text-slate-500">
            {result.profileId}
            {result.profileId !== result.target ? ` (for "${result.target}")` : ""} · v{result.v} ·{" "}
            {result.semanticHash.slice(7, 15)} · {result.tokenizer.id}
            {result.extracted ? " · IR extracted this run" : " · IR reused"}
          </div>

          {result.refused ? (
            <div
              data-testid="compile-refused"
              className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-200/90"
            >
              This target refused to compile the prompt. That is a finding, not a failure — the
              diagnostics below say what it cannot do. Nothing was written.
            </div>
          ) : null}

          <DiagnosticList diagnostics={result.diagnostics} />

          {result.artifacts.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {result.artifacts.map((a) => (
                <button
                  key={a.path}
                  onClick={() => setOpen(a.path)}
                  className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
                    shown?.path === a.path
                      ? "bg-ink-700 text-slate-100"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {a.path}
                </button>
              ))}
            </div>
          ) : null}

          {shown ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                <span>
                  {shown.path} · {shown.bytes} bytes · {shown.contentHash.slice(7, 15)}
                </span>
                <button
                  onClick={() => download(shown.path, shown.content)}
                  title="Download this artifact"
                  className="flex items-center gap-1 rounded-md border border-ink-700 px-1.5 py-0.5 text-slate-400 transition-colors hover:border-ink-600 hover:text-slate-200"
                >
                  <Download size={11} /> Save
                </button>
              </div>
              <pre
                data-testid="compile-artifact"
                className="whitespace-pre-wrap rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-200"
              >
                {shown.content}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
