"use client";

import {
  Check,
  Copy,
  Download,
  FlaskConical,
  GitCompare,
  GitMerge,
  History,
  Layers,
  Lock,
  Lightbulb,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Pencil,
  Pin,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  type Analysis,
  type CandidatePromotion,
  type ComparisonPayload,
  type DiagnosticWire,
  type DiscoveryWire,
  type DiffHunk,
  type DriftReportWire,
  type OverlayDistinctness,
  type PinnedRequirement,
  type PreservationReport,
  type PromptCandidate,
  type PromptVersion,
  type StagesWire,
  type TargetInfo,
  type VerificationRecordWire,
} from "@/lib/api";
import { CompilePanel } from "./CompilePanel";
import { DiscoveryBrief } from "./DiscoveryPanel";
import { estimateTokens } from "@/lib/diff";

interface Props {
  /** §22.11: the evolving brief, shown before and beside the prompt. */
  discovery: DiscoveryWire | null;
  /** WS-R45: each brief item marked stated or inferred. */
  discoveryMarks: Record<string, "stated" | "inferred">;
  /** WS-R40: the current version read as stages, when it is staged. */
  stages: StagesWire | null;
  /** Persisted verifications, newest last. */
  verifications: VerificationRecordWire[];
  tab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
  /** WS-R46: reopen a closed or generated discovery. */
  onReopenDiscovery: () => void;
  conversationId: string | null;
  prompt: string | null;
  versions: PromptVersion[];
  candidates: PromptCandidate[];
  currentV: number;
  /** The prompt as it streams in, before it is a version (V2-B, WS-R10). */
  streamingPrompt: string;
  provider: string;
  model: string;
  advanced: boolean;
  /** WS-R24: the pinned ledger, and WS-R25's deterministic verdict on it. */
  ledger: PinnedRequirement[];
  preservation: PreservationReport | null;
  proposals: string[];
  /** Targets the compile tab may compile for (V2-R). */
  targets: TargetInfo[];
  /** The conversation's current target, used as the compile tab's default. */
  target: string;
  onSaveEdit: (text: string) => Promise<void>;
  onRestore: (v: number) => Promise<void>;
  onPin: (text: string) => Promise<void>;
  onUnpin: (entryId: string) => Promise<void>;
  /**
   * Reload the conversation after a candidate produced a version (ST-R6).
   *
   * Promotion and merge are the only two things in this pane that write one,
   * and they are the only two that call this.
   */
  onArtifactsChanged: () => Promise<void>;
}

export type StudioTab = "brief" | "prompt" | "history" | "requirements" | "candidates" | "compile";

function shortHash(hash: string | undefined): string {
  return hash && hash.startsWith("sha256:") ? hash.slice(7, 15) : "";
}

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

/**
 * The prompt editor.
 *
 * A textarea with a gutter rather than a code-editor dependency: the artifact
 * is prose with structure, not code, and what a user actually needs here is
 * line numbers to refer to, a tab that indents instead of escaping, and a save
 * shortcut. None of that is worth a syntax-highlighting engine in `web/`.
 */
function Editor({
  value,
  onChange,
  onSave,
  readOnly,
}: {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  readOnly: boolean;
}): React.JSX.Element {
  const gutterRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lines = useMemo(() => value.split("\n").length, [value]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-ink-700 bg-ink-950 focus-within:border-accent-500/70">
      <div
        ref={gutterRef}
        aria-hidden
        className="select-none overflow-hidden border-r border-ink-800 bg-ink-900/60 px-2 py-2 text-right font-mono text-[12.5px] leading-relaxed text-slate-600"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={areaRef}
        data-testid="studio-editor"
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={() => {
          if (gutterRef.current && areaRef.current) gutterRef.current.scrollTop = areaRef.current.scrollTop;
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            onSave();
            return;
          }
          if (e.key === "Tab") {
            e.preventDefault();
            const area = e.currentTarget;
            const { selectionStart: start, selectionEnd: end } = area;
            onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
            requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2));
          }
        }}
        className="min-h-0 flex-1 resize-none bg-transparent p-2 font-mono text-[12.5px] leading-relaxed text-slate-100 outline-none"
      />
    </div>
  );
}

/**
 * The Prompt Studio (WS-R6, WS-R7, WS-R8).
 *
 * The prompt is the product, so this pane treats it as an artifact with a
 * history rather than as a read-only preview beside the chat: it can be
 * edited in place, widened or taken full-screen, and every version carries the
 * provenance the store records — the action that produced it, the turn it came
 * from, and the hash that names its text.
 *
 * A manual save writes a new version with `source: "manual"`; it never edits
 * one that exists (WS-R7). Restoring moves the pointer and records that it
 * did. Candidates are shown but not generated — that is V2-E's job, and a
 * Studio that invented alternatives by default would break WS-R8.
 */
export function PromptStudio({
  discovery,
  discoveryMarks,
  stages,
  verifications,
  tab: requestedTab,
  onTabChange: setTab,
  maximized,
  onToggleMaximize,
  onClose,
  onReopenDiscovery,
  conversationId,
  prompt,
  versions,
  candidates,
  currentV,
  streamingPrompt,
  provider,
  model,
  advanced,
  ledger,
  preservation,
  proposals,
  targets,
  target,
  onSaveEdit,
  onRestore,
  onPin,
  onUnpin,
  onArtifactsChanged,
}: Props): React.JSX.Element {
  // The Brief tab exists only while there is a discovery to show.
  const tab: StudioTab = requestedTab === "brief" && !discovery ? "prompt" : requestedTab;
  const [stageView, setStageView] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [diffA, setDiffA] = useState<number | null>(null);
  const [diffB, setDiffB] = useState<number | null>(null);
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  /**
   * Layer 2 (WS-R26, WS-R29). Lives here, not in `preservation`, so there is
   * no state shape in which an advisory finding could be read as part of the
   * deterministic verdict.
   */
  /**
   * The candidate workspace (WS-R8, ST-R6).
   *
   * `selected` holds artifact refs, not indices: a ref is what COMPARE and
   * MERGE address, and keeping the selection in the same vocabulary the server
   * uses is what lets the current version take part in either.
   */
  const [genCount, setGenCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateChecks, setCandidateChecks] = useState<Record<string, PreservationReport>>({});
  const [candidateDiagnostics, setCandidateDiagnostics] = useState<DiagnosticWire[]>([]);
  const [distinctness, setDistinctness] = useState<OverlayDistinctness | null>(null);
  const [promotions, setPromotions] = useState<CandidatePromotion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ComparisonPayload | null>(null);
  const [comparing, setComparing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [drift, setDrift] = useState<DriftReportWire | null>(null);
  const [driftRan, setDriftRan] = useState(false);
  const [driftError, setDriftError] = useState<string | null>(null);
  const [driftChecking, setDriftChecking] = useState(false);

  useEffect(() => {
    setEditing(false);
    setHunks(null);
    setAnalysis(null);
    setAnalysisError(null);
    // A drift report is about a specific pair of versions. Keeping a stale one
    // on screen after a new version lands would be advice about the past
    // presented as advice about the present.
    setDrift(null);
    setDriftRan(false);
    setDriftError(null);
    if (versions.length >= 2) {
      setDiffA(versions[versions.length - 2]!.v);
      setDiffB(versions[versions.length - 1]!.v);
    } else {
      setDiffA(null);
      setDiffB(null);
    }
  }, [conversationId, versions]);

  const dirty = editing && draft !== (prompt ?? "");
  const drafting = !editing && streamingPrompt.length > 0;
  const shown = drafting ? streamingPrompt : editing ? draft : (prompt ?? "");

  const startEdit = useCallback((): void => {
    setDraft(prompt ?? "");
    setEditing(true);
    setTab("prompt");
  }, [prompt]);

  const save = useCallback(async (): Promise<void> => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSaveEdit(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, draft, onSaveEdit]);

  /**
   * The deterministic verdict, per entry (WS-R25).
   *
   * Derived from the check rather than recomputed here: the browser is not
   * allowed a second opinion about a guarantee. An entry with no finding is
   * rendered as "not yet checked", never as "kept" — WS-R27.2 in the UI.
   */
  const verdict = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const finding of preservation?.findings ?? []) map.set(finding.entryId, finding.present);
    return map;
  }, [preservation]);
  const missing = (preservation?.diagnostics ?? []).length;

  const pin = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || pinning) return;
      setPinning(true);
      setPinError(null);
      try {
        await onPin(trimmed);
        setPinDraft("");
      } catch (error) {
        setPinError(error instanceof Error ? error.message : String(error));
      } finally {
        setPinning(false);
      }
    },
    [onPin, pinning],
  );

  const runDrift = useCallback(async (): Promise<void> => {
    if (!conversationId || versions.length < 2 || driftChecking) return;
    setDriftChecking(true);
    setDriftError(null);
    try {
      const result = await api.checkDrift(conversationId, {
        from: versions[versions.length - 2]!.v,
        to: versions[versions.length - 1]!.v,
      });
      setDrift(result.drift);
      setDriftRan(result.driftRan);
      if (result.driftError) setDriftError(result.driftError);
    } catch (error) {
      setDriftError(error instanceof Error ? error.message : String(error));
    } finally {
      setDriftChecking(false);
    }
  }, [conversationId, versions, driftChecking]);

  // ── Candidates (WS-R8, ST-R6) ─────────────────────────────────────────────

  /**
   * Read what is already there.
   *
   * Free and model-free: it re-runs Layer 1 over each candidate and returns
   * the record of past choices. Nothing here generates anything, which is why
   * it is safe to call on every tab switch (WS-R8).
   */
  const loadCandidates = useCallback(async (): Promise<void> => {
    if (!conversationId) return;
    try {
      const result = await api.listCandidates(conversationId);
      const checks: Record<string, PreservationReport> = {};
      for (const candidate of result.candidates) {
        if (candidate.preservation) checks[candidate.id] = candidate.preservation;
      }
      setCandidateChecks(checks);
      setPromotions(result.promotions);
    } catch {
      // A failed read must not blank the pane; the next switch retries.
    }
  }, [conversationId]);

  useEffect(() => {
    if (tab === "candidates") void loadCandidates();
  }, [tab, loadCandidates]);

  /** The explicit ask. Candidates exist because of this click and nothing else. */
  const generate = useCallback(async (): Promise<void> => {
    if (!conversationId || !prompt || generating) return;
    setGenerating(true);
    setCandidateError(null);
    try {
      const result = await api.generateCandidates(conversationId, { count: genCount, provider, model });
      setCandidateDiagnostics(result.diagnostics);
      setDistinctness(result.overlayDistinctness);
      const checks: Record<string, PreservationReport> = {};
      for (const candidate of result.candidates) {
        if (candidate.preservation) checks[candidate.id] = candidate.preservation;
      }
      setCandidateChecks((prior) => ({ ...prior, ...checks }));
      // WS-R8: no version was written, so only the candidate set is refreshed.
      await onArtifactsChanged();
      await loadCandidates();
    } catch (error) {
      setCandidateError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }, [conversationId, prompt, generating, genCount, provider, model, onArtifactsChanged, loadCandidates]);

  const toggleSelected = useCallback((ref: string): void => {
    setComparison(null);
    setSelected((prior) =>
      prior.includes(ref) ? prior.filter((r) => r !== ref) : prior.length >= 2 ? [prior[1] as string, ref] : [...prior, ref],
    );
  }, []);

  const compare = useCallback(async (): Promise<void> => {
    if (!conversationId || selected.length !== 2 || comparing) return;
    setComparing(true);
    setCandidateError(null);
    try {
      setComparison(await api.compareArtifacts(conversationId, selected[0] as string, selected[1] as string));
    } catch (error) {
      setCandidateError(error instanceof Error ? error.message : String(error));
    } finally {
      setComparing(false);
    }
  }, [conversationId, selected, comparing]);

  /** ST-R6: the user's choice, and the only way a candidate becomes current. */
  const useCandidate = useCallback(
    async (candidateId: string): Promise<void> => {
      if (!conversationId || promoting) return;
      setPromoting(true);
      setCandidateError(null);
      try {
        await api.selectCandidate(conversationId, candidateId);
        await onArtifactsChanged();
        await loadCandidates();
        setComparison(null);
        setSelected([]);
        setTab("prompt");
      } catch (error) {
        setCandidateError(error instanceof Error ? error.message : String(error));
      } finally {
        setPromoting(false);
      }
    },
    [conversationId, promoting, onArtifactsChanged, loadCandidates],
  );

  const mergeSelected = useCallback(async (): Promise<void> => {
    if (!conversationId || selected.length !== 2 || promoting) return;
    setPromoting(true);
    setCandidateError(null);
    try {
      await api.mergeCandidates(conversationId, selected);
      await onArtifactsChanged();
      await loadCandidates();
      setComparison(null);
      setSelected([]);
      setTab("prompt");
    } catch (error) {
      setCandidateError(error instanceof Error ? error.message : String(error));
    } finally {
      setPromoting(false);
    }
  }, [conversationId, selected, promoting, onArtifactsChanged, loadCandidates]);

  const copy = async (): Promise<void> => {
    if (!shown) return;
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const exportFile = (): void => {
    if (!prompt) return;
    const blob = new Blob([prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forge-prompt-v${currentV}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadDiff = async (): Promise<void> => {
    if (!conversationId || diffA === null || diffB === null) return;
    setDiffLoading(true);
    try {
      setHunks((await api.diffVersions(conversationId, diffA, diffB)).hunks);
    } catch {
      setHunks(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const runAnalysis = async (): Promise<void> => {
    if (!conversationId) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      setAnalysis(await api.analyze(conversationId, { provider, model }));
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const stats = useMemo(
    () => ({ tokens: estimateTokens(shown), chars: shown.length, lines: shown ? shown.split("\n").length : 0 }),
    [shown],
  );

  const iconButton = "rounded p-1.5 text-slate-400 hover:bg-ink-700 hover:text-slate-100 disabled:opacity-40";

  return (
    <aside
      data-testid="prompt-studio"
      data-maximized={maximized}
      className="flex h-full w-full min-w-0 flex-col border-l border-white/[0.06] bg-ink-900/95"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-200">
          Studio
          {drafting ? (
            // Deliberately unnumbered. The version number is not knowable
            // while text is still arriving: the WS-R3 check can still block
            // the write and a cancel can discard it, so a predicted "v7" is a
            // claim FORGE has not yet earned the right to make.
            <span
              data-testid="prompt-drafting"
              className="rounded bg-accent-500/15 px-1.5 py-0.5 font-mono text-[11px] text-accent-400"
            >
              drafting…
            </span>
          ) : prompt ? (
            <span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">v{currentV}</span>
          ) : null}
          {dirty ? <span className="text-[11px] font-normal text-amber-400">unsaved</span> : null}
          {missing > 0 ? (
            <span
              data-testid="preservation-failed"
              title="A requirement you pinned is missing from this version"
              className="flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-300"
            >
              <ShieldAlert size={12} />
              {missing} pinned requirement{missing === 1 ? "" : "s"} missing
            </span>
          ) : null}
        </div>
        <div className="flex-1" />
        <button title="Copy" onClick={copy} disabled={!shown} className={iconButton}>
          {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
        </button>
        <button title="Export Markdown" onClick={exportFile} disabled={!prompt} className={iconButton}>
          <Download size={15} />
        </button>
        {editing ? (
          <>
            <button
              title="Save as a new version"
              data-testid="studio-save"
              onClick={save}
              disabled={!dirty || saving}
              className="rounded p-1.5 text-accent-400 hover:bg-ink-700 disabled:opacity-40"
            >
              <Save size={15} />
            </button>
            <button title="Discard edits" onClick={() => setEditing(false)} className={iconButton}>
              <X size={15} />
            </button>
          </>
        ) : (
          <button title="Edit" data-testid="studio-edit" onClick={startEdit} disabled={!prompt || drafting} className={iconButton}>
            <Pencil size={15} />
          </button>
        )}
        <button
          title={maximized ? "Restore the Studio" : "Maximize the Studio"}
          aria-label={maximized ? "Restore the Studio" : "Maximize the Studio"}
          data-testid="studio-width"
          onClick={onToggleMaximize}
          className={iconButton}
        >
          {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button title="Hide the Studio" aria-label="Hide the Studio" onClick={onClose} className={iconButton}>
          <PanelRightClose size={15} />
        </button>
      </div>

      <div role="tablist" aria-label="Studio" className="no-scrollbar flex shrink-0 gap-0.5 overflow-x-auto border-b border-white/[0.06] px-2 text-[12.5px]">
        {(
          [
            ...(discovery ? ([["brief", "Brief", null]] as const) : []),
            ["prompt", "Prompt", null],
            ["history", "History", versions.length],
            ["requirements", "Requirements", ledger.length],
            ["candidates", "Alternatives", candidates.length],
            ["compile", "Contract", verifications.length || null],
          ] as ReadonlyArray<readonly [StudioTab, string, number | null]>
        ).map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            data-testid={`studio-tab-${key}`}
            onClick={() => setTab(key)}
            className={`relative shrink-0 whitespace-nowrap px-2.5 py-2.5 transition-colors ${
              tab === key ? "text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
            {count ? <span className="ml-1.5 font-mono text-[11px] text-slate-500">{count}</span> : null}
            {tab === key ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-400" /> : null}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5">
        {tab === "brief" && discovery ? (
          <DiscoveryBrief discovery={discovery} marks={discoveryMarks} onReopen={onReopenDiscovery} />
        ) : null}
        {tab === "prompt" ? (
          !conversationId || (!prompt && !drafting) ? (
            discovery ? (
              <DiscoveryBrief discovery={discovery} marks={discoveryMarks} onReopen={onReopenDiscovery} />
            ) : (
            <div className="py-10 text-center text-[13px] leading-relaxed text-slate-500">
              No prompt yet.
              <br />
              It will appear here once the conversation produces one.
            </div>
            )
          ) : (
            <>
              {!editing && !drafting && stages ? (
                <StageToolbar stages={stages} stageView={stageView} onToggle={() => setStageView(!stageView)} />
              ) : null}
              {editing ? (
                <Editor value={draft} onChange={setDraft} onSave={save} readOnly={saving} />
              ) : !drafting && stages?.ok && stageView ? (
                <StageList stages={stages} />
              ) : (
                <pre
                  data-testid={drafting ? "prompt-draft-text" : "prompt-text"}
                  className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-slate-200"
                >
                  {shown}
                  {drafting ? (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent-400 align-middle" />
                  ) : null}
                </pre>
              )}
              <div className="mt-2 shrink-0 text-[11px] text-slate-600">
                {stats.lines.toLocaleString()} lines · {stats.chars.toLocaleString()} chars · ~
                {stats.tokens.toLocaleString()} tokens
                {editing ? <span className="ml-2 text-slate-500">⌘S / Ctrl+S saves a new version</span> : null}
              </div>
            </>
          )
        ) : null}

        {tab === "history" ? (
          versions.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-slate-500">No versions yet.</div>
          ) : (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
                <History size={13} /> Versions
              </div>
              <div className="space-y-1">
                {[...versions].reverse().map((v) => (
                  <div
                    key={v.v}
                    data-testid={`studio-version-${v.v}`}
                    className={`rounded-md px-2.5 py-1.5 text-[12.5px] ${v.v === currentV ? "bg-ink-700" : "hover:bg-ink-850"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-slate-200">
                        v{v.v}
                        <span className="ml-1.5 text-slate-400">· {v.source}</span>
                        {v.action ? <span className="ml-1.5 font-mono text-[11px] text-accent-400">{v.action}</span> : null}
                      </span>
                      {v.v !== currentV ? (
                        <button
                          data-testid={`studio-restore-${v.v}`}
                          onClick={() => onRestore(v.v)}
                          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px] text-accent-400 hover:bg-ink-600"
                        >
                          <RotateCcw size={11} /> Restore
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">current</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                      <span>{when(v.at)}</span>
                      {v.textHash ? <span className="font-mono">{shortHash(v.textHash)}</span> : null}
                      {v.turnId ? <span className="font-mono">turn {v.turnId.slice(0, 8)}</span> : null}
                    </div>
                  </div>
                ))}
              </div>

              {versions.length > 1 ? (
                <div className="mt-3 border-t border-ink-800 pt-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-400">
                    <GitCompare size={13} />
                    <select
                      value={diffA ?? ""}
                      onChange={(e) => setDiffA(Number(e.target.value))}
                      className="rounded border border-ink-700 bg-ink-800 px-1 py-0.5"
                    >
                      {versions.map((v) => (
                        <option key={v.v} value={v.v}>
                          v{v.v}
                        </option>
                      ))}
                    </select>
                    <span>→</span>
                    <select
                      value={diffB ?? ""}
                      onChange={(e) => setDiffB(Number(e.target.value))}
                      className="rounded border border-ink-700 bg-ink-800 px-1 py-0.5"
                    >
                      {versions.map((v) => (
                        <option key={v.v} value={v.v}>
                          v{v.v}
                        </option>
                      ))}
                    </select>
                    <button
                      data-testid="studio-diff"
                      onClick={loadDiff}
                      disabled={diffLoading || diffA === null || diffB === null}
                      className="rounded bg-ink-700 px-2 py-0.5 hover:bg-ink-600 disabled:opacity-40"
                    >
                      {diffLoading ? "…" : "Diff"}
                    </button>
                  </div>
                  {hunks ? (
                    <div
                      data-testid="studio-diff-output"
                      className="mt-2 overflow-x-auto rounded-lg border border-ink-700 bg-ink-950 p-2 font-mono text-[11.5px] leading-relaxed"
                    >
                      {hunks.map((h, i) => (
                        <div key={i}>
                          {h.lines.map((line, j) => (
                            <div
                              key={j}
                              className={
                                h.type === "add"
                                  ? "bg-green-950/60 text-green-200"
                                  : h.type === "del"
                                    ? "bg-red-950/60 text-red-200"
                                    : "text-slate-500"
                              }
                            >
                              <span className={`mr-1 select-none ${h.type === "same" ? "opacity-60" : ""}`}>
                                {h.type === "add" ? "+" : h.type === "del" ? "−" : " "}
                              </span>
                              {line || " "}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        ) : null}

        {tab === "requirements" ? (
          <div data-testid="studio-requirements">
            {/*
              WS-R28 / AC-043. This panel says what it is before it says
              anything else: a deterministic, model-free check. V2-D2's
              advisory drift findings render in their own section, under their
              own heading, and the two are never one list.
            */}
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-2">
              <Lock size={13} className="mt-0.5 shrink-0 text-accent-400" />
              <div className="text-[11.5px] leading-relaxed text-slate-400">
                <span className="font-semibold text-slate-200">Deterministic — guaranteed.</span> Pinned text
                is yours, stored verbatim, and checked against every version with no model involved. A match
                ignores case, punctuation and line breaks; a reworded requirement counts as missing.
              </div>
            </div>

            <div className="flex gap-1.5">
              <input
                data-testid="pin-input"
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void pin(pinDraft);
                }}
                placeholder="Pin a requirement, verbatim…"
                disabled={!conversationId || pinning}
                className="flex-1 rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none disabled:opacity-50"
              />
              <button
                data-testid="pin-submit"
                onClick={() => void pin(pinDraft)}
                disabled={!conversationId || pinning || pinDraft.trim().length === 0}
                className="flex items-center gap-1 rounded-md bg-accent-500 px-2.5 py-1.5 text-[12.5px] text-white hover:bg-accent-400 disabled:opacity-40"
              >
                <Pin size={13} /> Pin
              </button>
            </div>
            {pinError ? (
              <div data-testid="pin-error" className="mt-1.5 text-[12px] text-red-300">
                {pinError}
              </div>
            ) : null}

            {ledger.length === 0 ? (
              <div className="py-8 text-center text-[13px] leading-relaxed text-slate-500">
                Nothing pinned.
                <br />
                Pin the requirements that must survive every revision.
              </div>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                {ledger.map((entry) => {
                  const state = verdict.get(entry.id);
                  return (
                    <div
                      key={entry.id}
                      data-testid="ledger-entry"
                      data-present={state === undefined ? "unchecked" : String(state)}
                      className={`rounded-lg border px-2.5 py-2 ${
                        state === false ? "border-red-800/70 bg-red-950/30" : "border-ink-700 bg-ink-950"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {state === false ? (
                          <ShieldAlert size={13} className="mt-0.5 shrink-0 text-red-400" />
                        ) : state === true ? (
                          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-green-400" />
                        ) : (
                          <Pin size={13} className="mt-0.5 shrink-0 text-slate-500" />
                        )}
                        <div className="flex-1 text-[12.5px] leading-relaxed text-slate-200">{entry.text}</div>
                        <button
                          data-testid={`unpin-${entry.id}`}
                          title="Unpin — only you can do this"
                          onClick={() => void onUnpin(entry.id)}
                          className="rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px]">
                        {state === false ? (
                          <span className="font-medium text-red-300">missing from v{preservation?.v}</span>
                        ) : state === true ? (
                          <span className="text-green-400">present in v{preservation?.v}</span>
                        ) : (
                          <span className="text-slate-500">not checked yet</span>
                        )}
                        <span className="font-mono text-slate-600">{shortHash(entry.contentHash)}</span>
                        <span className="text-slate-600">
                          pinned {entry.pinnedFromVersion ? `at v${entry.pinnedFromVersion}` : "before any version"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {(preservation?.diagnostics ?? []).length > 0 ? (
              <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 p-2.5">
                <div className="mb-1 text-[12px] font-semibold text-red-200">
                  Preservation failed — deterministic
                </div>
                {preservation?.diagnostics.map((d, i) => (
                  <div key={i} data-testid="ledger-diagnostic" className="mt-1 text-[12px] leading-relaxed text-red-200">
                    <span className="font-mono text-[11px] text-red-300">{d.code}</span> · {d.message}
                  </div>
                ))}
              </div>
            ) : null}

            {/*
              WS-R28 / AC-043. Everything above this line is Layer 1: a
              deterministic guarantee. Everything below it is Layer 2: advice.
              The separator, the heading, the badge and the wording all exist
              so the two can never be read as one list — and Layer 2 cannot
              resolve, dismiss or annotate anything above it.
            */}
            <div
              data-testid="drift-section"
              data-layer="judged"
              className="mt-4 border-t-2 border-dashed border-ink-700 pt-3"
            >
              <div className="flex items-start gap-2">
                <Lightbulb size={13} className="mt-0.5 shrink-0 text-amber-400" />
                <div className="flex-1">
                  <div className="text-[12px] font-semibold text-amber-200">
                    Advisory — judged, not a guarantee
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
                    A model reads each version&apos;s structure and compares them. It can be wrong in both
                    directions, it says nothing about pinned requirements, and it never changes the verdict
                    above. Pin anything it finds that must be kept.
                  </div>
                </div>
              </div>
              <button
                data-testid="drift-run"
                onClick={() => void runDrift()}
                disabled={!conversationId || versions.length < 2 || driftChecking}
                className="mt-2 rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-[12.5px] text-slate-300 hover:border-amber-500/50 hover:text-slate-100 disabled:opacity-40"
              >
                {driftChecking
                  ? "Comparing versions…"
                  : versions.length < 2
                    ? "Needs two versions"
                    : `Check drift v${versions[versions.length - 2]?.v} → v${versions[versions.length - 1]?.v}`}
              </button>
              {driftError ? (
                <div data-testid="drift-error" className="mt-1.5 text-[12px] text-amber-300">
                  Advisory check unavailable: {driftError} The deterministic verdict above is unaffected.
                </div>
              ) : null}
              {driftRan && drift ? (
                drift.findings.length === 0 ? (
                  <div data-testid="drift-empty" className="mt-2 text-[12px] leading-relaxed text-slate-500">
                    No drift suggested between v{drift.from} and v{drift.to} across {drift.compared} statement
                    {drift.compared === 1 ? "" : "s"}
                    {drift.skippedPinned > 0 ? `, with ${drift.skippedPinned} left to the pinned check above` : ""}.
                    This is not evidence that anything survived — only the ledger can say that.
                  </div>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {drift.findings.map((f, i) => (
                      <div
                        key={i}
                        data-testid="drift-finding"
                        className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-300">
                            advisory
                          </span>
                          <span className="font-mono text-amber-400/80">{f.diagnostic.code}</span>
                          <span className="text-slate-500">{f.kind}</span>
                        </div>
                        <div className="mt-1 text-[12px] leading-relaxed text-slate-300">
                          <span className="text-slate-500">v{drift.from}:</span> {f.from.statement}
                        </div>
                        <div className="mt-0.5 text-[12px] leading-relaxed text-slate-300">
                          <span className="text-slate-500">v{drift.to}:</span> {f.nearest.statement}
                        </div>
                        <button
                          data-testid="drift-pin"
                          onClick={() => void pin(f.from.statement)}
                          disabled={pinning}
                          className="mt-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-accent-400 hover:bg-ink-700 disabled:opacity-40"
                        >
                          <Pin size={11} /> Pin this so it is guaranteed
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </div>

            {proposals.length > 0 ? (
              <div className="mt-3 border-t border-ink-800 pt-2.5">
                <div className="text-[12px] font-semibold text-slate-300">Suggested from this prompt</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  Found by a fixed text rule, not by a model. Nothing is pinned until you pin it.
                </div>
                <div className="mt-1.5 space-y-1">
                  {proposals
                    .filter((text) => !ledger.some((e) => e.text === text))
                    .map((text, i) => (
                      <button
                        key={i}
                        data-testid="pin-proposal"
                        onClick={() => void pin(text)}
                        disabled={pinning}
                        className="flex w-full items-start gap-1.5 rounded-md border border-ink-700 px-2 py-1.5 text-left text-[12px] text-slate-300 hover:border-accent-500/60 hover:text-slate-100 disabled:opacity-40"
                      >
                        <Pin size={12} className="mt-0.5 shrink-0 text-slate-500" />
                        {text}
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "candidates" ? (
          <div className="space-y-3">
            {/*
              WS-R8: the ask. Alternatives are generated here and nowhere else,
              so a conversation that never touches this control never has any.
            */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-950 p-2.5">
              <button
                data-testid="studio-generate-candidates"
                onClick={generate}
                disabled={!conversationId || !prompt || generating}
                className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-400 disabled:opacity-50"
              >
                <Layers size={14} />
                {generating ? "Generating alternatives…" : "Generate alternatives"}
              </button>
              <div className="flex items-center gap-1 text-[12px] text-slate-400">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    data-testid={`studio-candidate-count-${n}`}
                    onClick={() => setGenCount(n)}
                    className={`rounded-md px-2 py-1 ${
                      genCount === n ? "bg-ink-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {!prompt ? <span className="text-[11.5px] text-slate-500">Create a prompt first.</span> : null}
            </div>

            {candidateError ? (
              <div data-testid="studio-candidate-error" className="rounded-lg border border-red-900 bg-red-950/40 p-2 text-[12px] text-red-200">
                {candidateError}
              </div>
            ) : null}

            {/* §11.5, shown as the evidence that the alternatives differ structurally. */}
            {distinctness ? (
              <div data-testid="studio-candidate-distinctness" className="text-[11.5px] text-slate-500">
                Structural distinctness: {distinctness.pairs.length} archetype pair
                {distinctness.pairs.length === 1 ? "" : "s"} compared, {distinctness.rejected.length} rejected as
                duplicates
                {distinctness.pairs.length > 0
                  ? ` · closest ${Math.min(...distinctness.pairs.map((p) => p.distance)).toFixed(2)}`
                  : ""}
              </div>
            ) : null}

            {/* INV-012: an alternative that did not make the set says why. */}
            {candidateDiagnostics.length > 0 ? (
              <div data-testid="studio-candidate-diagnostics" className="space-y-1">
                {candidateDiagnostics.map((d, i) => (
                  <div key={i} className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2 text-[12px] text-amber-200">
                    <span className="font-mono text-[11px] opacity-80">{d.code}</span> {d.message}
                  </div>
                ))}
              </div>
            ) : null}

            {candidates.length === 0 ? (
              <div className="py-8 text-center text-[13px] leading-relaxed text-slate-500">
                No alternatives.
                <br />
                FORGE generates them only when you ask for them.
              </div>
            ) : (
              <>
                {/* WS-R5: COMPARE and MERGE need two addressable artifacts. */}
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <button
                    data-testid="studio-select-current"
                    onClick={() => toggleSelected(`v${currentV}`)}
                    disabled={currentV === 0}
                    className={`rounded-md border px-2 py-1 disabled:opacity-40 ${
                      selected.includes(`v${currentV}`)
                        ? "border-accent-500 bg-accent-500/15 text-accent-200"
                        : "border-ink-700 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Current v{currentV}
                  </button>
                  <span className="text-slate-500">{selected.length} of 2 selected</span>
                  <button
                    data-testid="studio-compare-candidates"
                    onClick={compare}
                    disabled={selected.length !== 2 || comparing}
                    className="rounded-md border border-ink-700 px-2 py-1 text-slate-300 hover:border-ink-600 disabled:opacity-40"
                  >
                    {comparing ? "Comparing…" : "Compare"}
                  </button>
                  <button
                    data-testid="studio-merge-candidates"
                    onClick={mergeSelected}
                    disabled={selected.length !== 2 || promoting}
                    className="flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-slate-300 hover:border-ink-600 disabled:opacity-40"
                  >
                    <GitMerge size={13} />
                    {promoting ? "Working…" : "Merge into new version"}
                  </button>
                </div>

                {comparison ? (
                  <div data-testid="studio-comparison" className="rounded-lg border border-ink-700 bg-ink-950 p-2.5">
                    <div className="flex items-center justify-between text-[12.5px] text-slate-200">
                      <span>{comparison.a.label}</span>
                      <span className="text-slate-600">vs</span>
                      <span>{comparison.b.label}</span>
                    </div>
                    {/* Counted differences — evidence, never a score (INV-008). */}
                    <div data-testid="studio-comparison-divergence" className="mt-1 text-[11.5px] text-slate-500">
                      {comparison.divergence.shared} shared block
                      {comparison.divergence.shared === 1 ? "" : "s"} · {comparison.divergence.uniqueToA} only on the
                      left · {comparison.divergence.uniqueToB} only on the right
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[comparison.a, comparison.b].map((side) => (
                        <div key={side.ref} className="rounded-md border border-ink-800 bg-ink-900/60 p-2">
                          <div className="text-[11px] text-slate-500">
                            {side.kind}
                            {side.strategy ? ` · ${side.strategy}` : ""}
                          </div>
                          {/* WS-R28: the deterministic verdict, labelled as one. */}
                          <div
                            className={`mt-1 text-[11px] ${
                              side.preservation.diagnostics.length > 0 ? "text-red-300" : "text-slate-500"
                            }`}
                          >
                            Requirements (deterministic):{" "}
                            {side.preservation.findings.filter((f) => f.present).length}/
                            {side.preservation.findings.length} kept
                          </div>
                          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">
                            {side.text}
                          </pre>
                        </div>
                      ))}
                    </div>
                    <div
                      data-testid="studio-comparison-diff"
                      className="mt-2 max-h-60 overflow-auto rounded-md border border-ink-800 bg-ink-950 p-2 font-mono text-[11px] leading-relaxed"
                    >
                      {comparison.hunks.map((h, i) => (
                        <div key={i}>
                          {h.lines.map((line, j) => (
                            <div
                              key={j}
                              className={
                                h.type === "add"
                                  ? "bg-green-950/60 text-green-200"
                                  : h.type === "del"
                                    ? "bg-red-950/60 text-red-200"
                                    : "text-slate-600"
                              }
                            >
                              <span className="mr-1 select-none">
                                {h.type === "add" ? "+" : h.type === "del" ? "−" : " "}
                              </span>
                              {line || " "}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {candidates.map((c) => {
                    const check = candidateChecks[c.id];
                    const missing = check ? check.diagnostics.length : 0;
                    return (
                      <div
                        key={c.id}
                        data-testid="studio-candidate"
                        data-candidate-id={c.id}
                        className={`rounded-lg border bg-ink-950 p-2.5 ${
                          selected.includes(c.id) ? "border-accent-500" : "border-ink-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[12.5px]">
                          <label className="flex items-center gap-2 text-slate-200">
                            <input
                              type="checkbox"
                              data-testid="studio-candidate-select"
                              checked={selected.includes(c.id)}
                              onChange={() => toggleSelected(c.id)}
                            />
                            {c.label}
                          </label>
                          <div className="flex items-center gap-2">
                            {c.strategy ? <span className="font-mono text-[11px] text-accent-400">{c.strategy}</span> : null}
                            {typeof c.score === "number" ? (
                              <span className="text-[11px] text-slate-500">fit {c.score}</span>
                            ) : null}
                            <button
                              data-testid="studio-use-candidate"
                              onClick={() => useCandidate(c.id)}
                              disabled={promoting}
                              className="rounded-md border border-ink-700 px-2 py-0.5 text-[11.5px] text-slate-300 hover:border-accent-500 hover:text-accent-200 disabled:opacity-40"
                            >
                              Use this
                            </button>
                          </div>
                        </div>
                        {/* ST-R6: the deciding rule, shown so the choice is the user's. */}
                        {c.rationale ? (
                          <div data-testid="studio-candidate-rationale" className="mt-1 text-[11.5px] text-slate-500">
                            {c.rationale}
                          </div>
                        ) : null}
                        {check ? (
                          <div
                            data-testid="studio-candidate-preservation"
                            className={`mt-1 text-[11.5px] ${missing > 0 ? "text-red-300" : "text-slate-500"}`}
                          >
                            Requirements (deterministic): {check.findings.filter((f) => f.present).length}/
                            {check.findings.length} kept
                            {missing > 0 ? ` · ${missing} dropped` : ""}
                          </div>
                        ) : null}
                        <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-slate-400">
                          {c.text}
                        </pre>
                        <div className="mt-1 text-[11px] text-slate-600">
                          {c.fromVersion !== null ? `from v${c.fromVersion} · ` : ""}
                          {c.origin} · {when(c.at)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ST-R6: the choices, recorded. */}
                {promotions.length > 0 ? (
                  <div data-testid="studio-promotions" className="border-t border-ink-800 pt-2 text-[11.5px] text-slate-500">
                    {promotions.map((p, i) => (
                      <div key={i}>
                        v{p.v} ← {p.promotion === "merge" ? "merged" : "selected"} {p.candidateIds.length} artifact
                        {p.candidateIds.length === 1 ? "" : "s"} · {when(p.at)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {advanced && conversationId && prompt && tab === "prompt" ? (
          <div className="mt-4 shrink-0 border-t border-ink-800 pt-3">
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-[12.5px] text-slate-200 hover:border-ink-600 disabled:opacity-50"
            >
              <FlaskConical size={14} />
              {analyzing ? "Analyzing with FORGE engine…" : "Analyze structure (Advanced)"}
            </button>
            {analysisError ? <div className="mt-2 text-[12px] text-red-300">{analysisError}</div> : null}
            {analysis ? (
              <div className="mt-2 space-y-2 text-[12.5px] text-slate-300">
                <div>
                  <span className="text-slate-500">Goals:</span>
                  {analysis.goals.map((g, i) => (
                    <div key={i} className="ml-2">
                      • {g}
                    </div>
                  ))}
                </div>
                {analysis.constraints.length > 0 ? (
                  <div>
                    <span className="text-slate-500">Constraints:</span>
                    {analysis.constraints.map((c, i) => (
                      <div key={i} className="ml-2">
                        • [{c.hardness}] {c.statement}
                      </div>
                    ))}
                  </div>
                ) : null}
                {analysis.questions.length > 0 ? (
                  <div>
                    <span className="text-slate-500">Open questions:</span>
                    {analysis.questions.map((q, i) => (
                      <div key={i} className="ml-2">
                        • {q.blocking ? "[blocking] " : ""}
                        {q.question}
                      </div>
                    ))}
                  </div>
                ) : null}
                {analysis.strategies.length > 0 ? (
                  <div>
                    <span className="text-slate-500">Strategy candidates:</span>
                    {analysis.strategies.map((s) => (
                      <div key={s.archetype} className="ml-2 mt-1">
                        <span className="font-mono text-accent-400">{s.archetype}</span>
                        <span className="text-slate-500"> (fit {s.score})</span>
                        <div className="text-[12px] text-slate-400">{s.rationale}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "compile" ? (
          <CompilePanel
            conversationId={conversationId}
            targets={targets}
            defaultTarget={target}
            hasPrompt={Boolean(prompt)}
            verifications={verifications}
            onVerified={onArtifactsChanged}
          />
        ) : null}
      </div>
    </aside>
  );
}

/** WS-R40: the stage view's header — how many stages, or why it is not staged. */
function StageToolbar({
  stages,
  stageView,
  onToggle,
}: {
  stages: StagesWire;
  stageView: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  if (!stages.ok) {
    return (
      <div data-testid="stages-unreadable" className="mb-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-2.5 py-1.5 text-[12px] text-amber-200/90">
        Staged output was requested, but this version is not readable as stages ({stages.reason}). Shown as one prompt.
      </div>
    );
  }
  return (
    <div className="mb-2 flex items-center gap-2 text-[12px] text-slate-400">
      <Layers size={13} className="text-accent-300" />
      <span>
        {stages.stages.length} stages, run in order
      </span>
      <div className="flex-1" />
      <button onClick={onToggle} data-testid="stage-view-toggle" className="rounded px-2 py-0.5 text-slate-300 hover:bg-white/[0.05]">
        {stageView ? "Show full text" : "Show stages"}
      </button>
    </div>
  );
}

/** Each stage as its own copyable prompt, with what it depends on and what it carries. */
function StageList({ stages }: { stages: Extract<StagesWire, { ok: true }> }): React.JSX.Element {
  const [copied, setCopied] = useState<number | null>(null);
  const uncarried = stages.carry.filter((c) => c.stages.length === 0);
  return (
    <div data-testid="stage-list" className="space-y-3">
      {stages.stages.map((stage) => {
        const carried = stages.carry.filter((c) => c.stages.includes(stage.n));
        return (
          <section key={stage.n} className="rounded-lg border border-white/[0.07] bg-ink-850/70">
            <header className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
              <span className="font-mono text-[11px] text-slate-500">{stage.n}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-100">{stage.title}</span>
              <span className="text-[11px] text-slate-500">
                {stage.dependsOn.length > 0 ? `after ${stage.dependsOn.map((d) => `stage ${d}`).join(", ")}` : "starts here"}
              </span>
              <button
                title={`Copy stage ${stage.n}`}
                aria-label={`Copy stage ${stage.n}`}
                onClick={() => {
                  void navigator.clipboard?.writeText(stage.text).then(() => {
                    setCopied(stage.n);
                    window.setTimeout(() => setCopied(null), 1200);
                  });
                }}
                className="rounded p-1 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
              >
                {copied === stage.n ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
            </header>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-200">
              {stage.text}
            </pre>
            {carried.length > 0 ? (
              <div className="border-t border-white/[0.06] px-3 py-1.5 text-[11.5px] text-slate-400">
                Carries:{" "}
                {carried.map((c) => (
                  <span key={c.text} className="mr-1.5 inline-block">
                    <span className={c.kind === "pinned" ? "text-accent-300" : "text-slate-300"}>{c.kind === "pinned" ? "pinned" : "brief"}</span>{" "}
                    “{c.text.length > 60 ? `${c.text.slice(0, 60)}…` : c.text}”
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      {uncarried.length > 0 ? (
        <div className="rounded-md border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-[12px] text-rose-200">
          Not carried by any stage:
          <ul className="ml-4 mt-1 list-disc">
            {uncarried.map((c) => (
              <li key={c.text}>
                {c.kind === "pinned" ? "Pinned" : "Brief"}: {c.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
