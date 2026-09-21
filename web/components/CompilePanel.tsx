"use client";

import { Download, Hammer, Package } from "lucide-react";
import { useState } from "react";

import { DiagnosticList } from "./DiagnosticList";
import { api, type CompileResponse, type PackageResponse, type TargetInfo, type VerifyResponse } from "@/lib/api";

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
  const [pkg, setPkg] = useState<PackageResponse | null>(null);
  // V2-G: pasted evidence and the verdicts it produced. FORGE runs nothing;
  // this only evaluates what an external executor reported.
  const [evidence, setEvidence] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verdicts, setVerdicts] = useState<VerifyResponse | null>(null);
  const [packaging, setPackaging] = useState(false);

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

  /**
   * Build an Execution Package and hand the user its files.
   *
   * One file per download rather than a zip: a package's whole point is that it
   * needs no decoder (`PK-R8`), and shipping it as an archive would put one
   * between the user and a format designed to avoid exactly that. The layout is
   * preserved in the filenames so a recipient can reconstruct the directory.
   */
  const buildPackage = async (): Promise<void> => {
    if (!conversationId || packaging) return;
    setPackaging(true);
    setError(null);
    try {
      setPkg(await api.packageVersion(conversationId, { target }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPkg(null);
    } finally {
      setPackaging(false);
    }
  };

  const verify = async (): Promise<void> => {
    if (!conversationId || verifying || evidence.trim() === "") return;
    setVerifying(true);
    setError(null);
    try {
      setVerdicts(await api.verifyVersion(conversationId, { target, evidence }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVerdicts(null);
    } finally {
      setVerifying(false);
    }
  };

  const download = (path: string, content: string): void => {
    const json = path.endsWith(".json");
    const url = URL.createObjectURL(
      new Blob([content], { type: json ? "application/json" : "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = url;
    // The package layout is flattened into the filename so a recipient can
    // rebuild the directory: `artifacts/PROMPT.md` saves as `artifacts__PROMPT.md`.
    link.download = path.includes("/") ? path.split("/").join("__") : path;
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
        <button
          onClick={() => void buildPackage()}
          disabled={packaging}
          data-testid="package-run"
          title="Build a portable Execution Package: artifacts, requirements, verification obligations, provenance and diagnostics"
          className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5 text-[12.5px] text-slate-300 transition-colors hover:border-ink-600 hover:text-slate-100 disabled:opacity-40"
        >
          <Package size={13} /> {packaging ? "Packaging…" : "Package"}
        </button>
      </div>

      {pkg ? (
        <div data-testid="package-result" className="space-y-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5">
          <div className="font-mono text-[11px] text-slate-500">
            Execution Package · {pkg.profileId} · v{pkg.v} · {pkg.semanticId.slice(7, 19)}
            {pkg.refused ? " · compilation refused" : ""}
          </div>
          <p className="text-[12.5px] leading-relaxed text-slate-400">
            Readable with JSON parsing and the published schema — no FORGE needed. Every
            hash below is <code className="font-mono">sha256</code> over the file&apos;s bytes.
            FORGE ran none of the verification steps it declares.
          </p>
          <ul className="space-y-0.5">
            {pkg.files.map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="truncate text-slate-400">{f.path}</span>
                <span className="flex shrink-0 items-center gap-2 text-slate-600">
                  {f.bytes}B
                  <button
                    onClick={() => download(f.path, f.content)}
                    title={`Save ${f.path}`}
                    className="rounded border border-ink-700 px-1.5 text-slate-400 transition-colors hover:border-ink-600 hover:text-slate-200"
                  >
                    save
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5 border-t border-ink-800 pt-2">
            <div className="text-[11px] text-slate-500">
              Verify an external run — paste the evidence file your CI or agent produced. FORGE
              executes nothing; it checks the package, then reads what was reported.
            </div>
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              data-testid="verify-evidence"
              rows={3}
              placeholder='{ "records": [ { "obligation_id": "v1", "kind": "command", "exit_code": 0, … } ] }'
              className="w-full rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 font-mono text-[11px] text-slate-200 focus:border-accent-500 focus:outline-none"
            />
            <button
              onClick={() => void verify()}
              disabled={verifying || evidence.trim() === ""}
              data-testid="verify-run"
              className="rounded-md border border-ink-700 bg-ink-900 px-3 py-1 text-[12px] text-slate-300 transition-colors hover:border-ink-600 hover:text-slate-100 disabled:opacity-40"
            >
              {verifying ? "Verifying…" : "Verify evidence"}
            </button>
            {verdicts ? (
              <div data-testid="verify-result" className="space-y-1">
                {verdicts.packageValid ? (
                  <ul className="space-y-0.5">
                    {verdicts.verdicts.map((v) => (
                      <li key={v.obligation_id} className="flex items-start justify-between gap-2 font-mono text-[11px]">
                        <span className="truncate text-slate-400" title={v.spec}>
                          [{v.obligation_id}] {v.kind}: {v.spec}
                          {v.records.length > 0
                            ? ` ← ${v.records.map((r) => `#${r.index} ${r.runner} exit ${r.exit_code ?? "-"}`).join(", ")}`
                            : ""}
                        </span>
                        <span
                          data-testid={`verdict-${v.obligation_id}`}
                          className={`shrink-0 ${
                            v.verdict === "VERIFIED"
                              ? "text-emerald-400"
                              : v.verdict === "FAILED"
                                ? "text-red-400"
                                : v.verdict === "REVIEW_REQUIRED"
                                  ? "text-amber-300"
                                  : "text-slate-500"
                          }`}
                        >
                          {v.verdict}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12px] text-red-300">
                    Package rejected before any evidence was read — it does not rebuild from its own inputs.
                  </div>
                )}
                <DiagnosticList diagnostics={verdicts.diagnostics} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
