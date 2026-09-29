"use client";

import { Check, Download, Hammer, History, Package } from "lucide-react";
import { useState } from "react";

import { DiagnosticList } from "./DiagnosticList";
import { TraceabilityPanel } from "./TraceabilityPanel";
import {
  api,
  type CompileResponse,
  type PackageResponse,
  type TargetInfo,
  type VerificationRecordWire,
  type VerifyResponse,
} from "@/lib/api";

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
 * is a read of it. Several targets compile from ONE IR through the real
 * compiler, one profile each (WS-R41) — never one output renamed for another.
 */
export function CompilePanel({
  conversationId,
  targets,
  defaultTarget,
  hasPrompt,
  verifications,
  onVerified,
}: {
  conversationId: string | null;
  targets: TargetInfo[];
  defaultTarget: string;
  hasPrompt: boolean;
  verifications: VerificationRecordWire[];
  onVerified: () => Promise<void>;
}): React.JSX.Element {
  // `generic` is not a profile; the compile path maps it, and so does the default here.
  const initial = defaultTarget === "generic" ? "claude-code" : defaultTarget;
  const [target, setTarget] = useState(initial);
  const [selected, setSelected] = useState<string[]>([initial]);
  const [results, setResults] = useState<CompileResponse[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const result = results.find((r) => r.target === active) ?? results[0] ?? null;
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
      const { results: compiled } = await api.compileTargets(conversationId, { targets: selected });
      setResults(compiled);
      setActive(compiled[0]?.target ?? null);
      setOpen(compiled[0]?.artifacts[0]?.path ?? null);
      if (compiled[0]) setTarget(compiled[0].target);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
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
      // Verify against the package on screen, not whatever the target menu
      // says now: the evidence was produced for that package.
      setVerdicts(await api.verifyVersion(conversationId, { target: pkg?.profileId ?? target, evidence }));
      await onVerified();
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
    // Attached and revoked late, for the reason given in PromptStudio's export.
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
  const profiles = targets.filter((t) => t.id !== "generic");
  const last = verifications.at(-1) ?? null;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-[11.5px] font-medium text-slate-500">Compile for</div>
        <div data-testid="compile-targets" className="flex flex-wrap gap-1.5">
          {profiles.map((t) => {
            const on = selected.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                data-testid={`compile-target-${t.id}`}
                onClick={() =>
                  setSelected((current) =>
                    on ? (current.length > 1 ? current.filter((x) => x !== t.id) : current) : [...current, t.id],
                  )
                }
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                  on ? "border-accent-400 bg-accent-500/15 text-slate-50" : "border-white/[0.09] text-slate-400 hover:border-white/[0.18] hover:text-slate-200"
                }`}
              >
                {on ? <Check size={11} /> : null}
                {t.displayName}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={busy}
          data-testid="compile-run"
          className="flex items-center gap-1.5 rounded-md bg-accent-500 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-40"
        >
          <Hammer size={13} /> {busy ? "Compiling…" : selected.length > 1 ? `Compile ${selected.length} targets` : "Compile"}
        </button>
        <div className="flex-1" />
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-testid="compile-target"
          aria-label="Target to package and verify"
          title="The target the Execution Package is built for"
          className="h-8 rounded-md border border-white/[0.08] bg-ink-850 px-2 text-[12.5px] text-slate-200 focus:border-accent-400 focus:outline-none"
        >
          {profiles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
        <button
          onClick={() => void buildPackage()}
          disabled={packaging}
          data-testid="package-run"
          title="Build a portable Execution Package: artifacts, requirements, verification obligations, provenance and diagnostics"
          className="flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-ink-850 px-3 py-1.5 text-[12.5px] text-slate-200 transition-colors hover:border-white/[0.2] disabled:opacity-40"
        >
          <Package size={13} /> {packaging ? "Packaging…" : "Package"}
        </button>
      </div>

      {last ? (
        <div data-testid="last-verification" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/[0.07] bg-ink-850/60 px-3 py-2 text-[12px] text-slate-400">
          <History size={12} className="text-slate-500" />
          <span>
            Last verified {new Date(last.at).toLocaleString()} · v{last.v} · {last.profileId}
          </span>
          <span className="text-emerald-400">{last.counts["VERIFIED"] ?? 0} verified</span>
          <span className={last.counts["FAILED"] ? "text-rose-400" : "text-slate-500"}>{last.counts["FAILED"] ?? 0} failed</span>
          <span className="text-slate-500">
            {last.counts["UNVERIFIED"] ?? 0} unverified · {last.counts["REVIEW_REQUIRED"] ?? 0} need review
          </span>
          {!last.packageValid ? <span className="text-rose-300">package rejected</span> : null}
          <div className="flex-1" />
          {last.evidenceKept && last.evidence ? (
            <button onClick={() => setEvidence(last.evidence ?? "")} className="rounded px-1.5 text-slate-300 hover:bg-white/[0.05]">
              Load evidence
            </button>
          ) : (
            <span title="The pasted evidence contained something the secret scanner flagged, so FORGE did not store it.">
              evidence not stored
            </span>
          )}
        </div>
      ) : null}

      {pkg ? (
        <div data-testid="package-result" className="space-y-1.5 rounded-lg border border-white/[0.07] bg-ink-850/60 px-3.5 py-2.5">
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
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3.5 py-2.5 text-[13px] text-rose-200/90">
          {error}
        </div>
      ) : null}

      {/* V2-H: governance, repository linkage and the traceability matrix. */}
      <TraceabilityPanel conversationId={conversationId} target={target} evidence={evidence} />

      {results.length > 1 ? (
        <div role="tablist" aria-label="Compiled targets" className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-1.5">
          {results.map((r) => (
            <button
              key={r.target}
              role="tab"
              aria-selected={result?.target === r.target}
              data-testid={`compiled-${r.target}`}
              onClick={() => {
                setActive(r.target);
                setOpen(r.artifacts[0]?.path ?? null);
              }}
              className={`rounded-md px-2 py-1 text-[12px] transition-colors ${
                result?.target === r.target ? "bg-ink-700 text-slate-50" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {targets.find((t) => t.id === r.target)?.displayName ?? r.target}
              {r.refused ? <span className="ml-1 text-amber-300">refused</span> : null}
            </button>
          ))}
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
                className="whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-ink-950 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-200"
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
