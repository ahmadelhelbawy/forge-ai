"use client";

import { GitBranch, Pin, Table2 } from "lucide-react";
import { useEffect, useState } from "react";

import { DiagnosticList } from "./DiagnosticList";
import {
  api,
  type AuthoritativeLinkWire,
  type GovernanceDecisionWire,
  type MatrixRowWire,
  type RepositoryWire,
  type TraceabilityMatrixWire,
} from "@/lib/api";

/**
 * The requirement traceability matrix (V2-H, `spec.md` §22.10, TM-R1–TM-R4).
 *
 * Minimal by design: bind a repository, build the matrix, open one requirement
 * and read its chain — human statement → requirement → IR node → artifact span →
 * file/test links → obligation → evidence → verdict. The buttons are the three
 * governance decisions (RG-R3) and asserting an advisory link; nothing here is
 * automatic.
 *
 * ADVISORY LINKS ARE RENDERED FROM THEIR OWN FIELD, IN THEIR OWN BOX. The
 * authoritative columns render only `files` and `tests`, which the matrix fills
 * from deterministic evidence alone, so no rendering path can put an asserted
 * link among them (LK-R4, AC-056).
 */
export function TraceabilityPanel({
  conversationId,
  target,
  evidence,
}: {
  conversationId: string;
  target: string;
  /** The evidence pasted into the Verify box, joined as V2-G verdicts when present. */
  evidence: string;
}): React.JSX.Element {
  const [repo, setRepo] = useState<RepositoryWire | null>(null);
  const [path, setPath] = useState("");
  const [matrix, setMatrix] = useState<TraceabilityMatrixWire | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.repository(conversationId).then(setRepo, () => setRepo(null));
  }, [conversationId]);

  const act = async (fn: () => Promise<unknown>, rebuild = true): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (rebuild) {
        setMatrix(await api.traceability(conversationId, { target, ...(evidence.trim() ? { evidence } : {}) }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = (decision: GovernanceDecisionWire): Promise<void> =>
    act(() => api.decideRequirement(conversationId, decision));

  return (
    <div className="space-y-2 border-t border-ink-800 pt-3" data-testid="traceability-panel">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-300">
        <Table2 size={13} /> Requirement traceability
      </div>

      <div className="space-y-1" data-testid="repo-binding">
        {repo?.bound ? (
          <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
            <span className="truncate" title={repo.root ?? ""}>
              <GitBranch size={11} className="mr-1 inline" />
              bound: {repo.root}
              {repo.usable ? "" : " (no longer allowed)"}
            </span>
            <button
              onClick={() => void act(async () => setRepo(await api.unbindRepository(conversationId)))}
              data-testid="repo-unbind"
              className="shrink-0 rounded-md border border-ink-700 px-2 py-0.5 text-slate-400 hover:text-slate-200"
            >
              Unbind
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              data-testid="repo-path"
              placeholder="/absolute/path/to/repository (must be under FORGE_REPO_ROOTS)"
              className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-800 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-accent-500 focus:outline-none"
            />
            <button
              onClick={() => void act(async () => setRepo(await api.bindRepository(conversationId, path.trim())))}
              disabled={path.trim() === ""}
              data-testid="repo-bind"
              className="rounded-md border border-ink-700 px-2 py-1 text-[12px] text-slate-300 hover:text-slate-100 disabled:opacity-40"
            >
              Bind
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => void act(async () => undefined)}
        disabled={busy}
        data-testid="matrix-build"
        className="rounded-md border border-ink-700 bg-ink-900 px-3 py-1 text-[12px] text-slate-300 hover:text-slate-100 disabled:opacity-40"
      >
        {busy ? "Working…" : matrix ? "Rebuild matrix" : "Build matrix"}
      </button>

      {error ? (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 px-2.5 py-1.5 text-[12px] text-red-200/90">
          {error}
        </div>
      ) : null}

      {matrix ? (
        <div className="space-y-1.5" data-testid="matrix">
          <div className="font-mono text-[10px] text-slate-500">
            {matrix.package_semantic_id ? `package ${matrix.package_semantic_id.slice(7, 19)}` : "no package"} ·{" "}
            {matrix.ir_extracted ? "IR extracted" : "IR not extracted — only pinned requirements shown"} ·{" "}
            {matrix.repository_bound ? "repository bound" : "no repository — no links"} ·{" "}
            {matrix.verdicts_rejected ? "package REJECTED — no verdicts" : matrix.verdicts_supplied ? "verdicts joined" : "no evidence"}
          </div>
          {/* The fixed columns alone are 32rem; at the Studio's usual width
              they left the requirement column zero wide. A minimum width
              keeps ~14rem for the text, and the table scrolls inside its own
              box instead of overflowing the Studio. */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] table-fixed text-left font-mono text-[11px]">
            <thead className="text-slate-500">
              <tr>
                <th className="w-[7.5rem]">id</th>
                <th>requirement</th>
                <th className="w-[5.5rem]">origin</th>
                <th className="w-[5.5rem]">status</th>
                <th className="w-[3.5rem]">files</th>
                <th className="w-[3.5rem]">tests</th>
                <th className="w-[6.5rem]">verdicts</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr
                  key={r.id}
                  data-testid={`matrix-row-${r.id}`}
                  onClick={() => setOpenRow(openRow === r.id ? null : r.id)}
                  // Keyboard users must reach Accept / Supersede / Conflict too.
                  tabIndex={0}
                  aria-expanded={openRow === r.id}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenRow(openRow === r.id ? null : r.id);
                    }
                  }}
                  className={`cursor-pointer align-top hover:bg-ink-800 ${r.active ? "text-slate-300" : "text-slate-500"}`}
                >
                  <td className="truncate">{r.id}</td>
                  <td className="truncate" title={r.text}>
                    {r.pinned ? <Pin size={10} className="mr-1 inline" aria-label="pinned" /> : null}
                    {r.text}
                  </td>
                  <td>{r.origin === "user_stated" ? "stated" : "inferred"}</td>
                  <td data-testid={`status-${r.id}`}>{r.status}</td>
                  <td>{r.files.length}</td>
                  <td>{r.tests.length}</td>
                  <td className="truncate">{r.obligations.map((o) => o.verdict ?? "—").join(" ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {matrix.rows
            .filter((r) => r.id === openRow)
            .map((r) => (
              <RowDetail key={r.id} row={r} rows={matrix.rows} busy={busy} decide={decide}
                addLink={(p, note) => act(() => api.addAdvisoryLink(conversationId, { requirementId: r.id, path: p, note }))} />
            ))}
          {matrix.caveat ? <div className="text-[10px] leading-snug text-slate-500">{matrix.caveat}</div> : null}
          <DiagnosticList diagnostics={matrix.diagnostics} />
        </div>
      ) : null}
    </div>
  );
}

function LinkList({ links, testid }: { links: AuthoritativeLinkWire[]; testid: string }): React.JSX.Element {
  if (links.length === 0) return <div className="text-slate-500">(none — no deterministic evidence)</div>;
  return (
    <ul data-testid={testid}>
      {links.map((l) => (
        <li key={l.path}>
          {l.path} <span className="text-slate-500">← {l.evidence.map((e) => e.type === "rg_term" ? `rg_term ${e.matched}/${e.of} [${e.matched_terms.join(",")}]` : e.type === "test_naming" ? `test_naming [${e.matched_terms.join(",")}]` : e.type === "scope_glob" ? `scope_glob ${e.glob}` : `git_history #${e.commit_position}`).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

function RowDetail({
  row,
  rows,
  busy,
  decide,
  addLink,
}: {
  row: MatrixRowWire;
  rows: MatrixRowWire[];
  busy: boolean;
  decide: (d: GovernanceDecisionWire) => Promise<void>;
  addLink: (path: string, note: string) => Promise<void>;
}): React.JSX.Element {
  const [other, setOther] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const others = rows.filter((r) => r.id !== row.id);
  return (
    <div data-testid="matrix-detail" className="space-y-1.5 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-2 font-mono text-[11px] text-slate-300">
      <div className="whitespace-pre-wrap text-slate-200">“{row.text}”</div>
      <div>
        {row.id} · origin <b>{row.origin}</b> · status <b>{row.status}</b>
        {row.pinned ? " · pinned" : ""}
        {row.superseded_by ? ` · superseded by ${row.superseded_by}` : ""}
        {row.conflicts_with.length > 0 ? ` · conflicts with ${row.conflicts_with.join(", ")}` : ""}
      </div>
      <div>
        sources:{" "}
        {row.sources.length === 0
          ? "(in no current version)"
          : row.sources.map((s) => (s.kind === "ledger" ? "ledger (pinned verbatim)" : `IR ${s.node_kind} ${s.node_id}`)).join(" · ")}
      </div>
      <div>
        artifact spans:{" "}
        {row.artifact_spans.length === 0
          ? "(none)"
          : row.artifact_spans.map((s) => `${s.artifact_path}:${s.start}-${s.end} (${s.node_id})`).join(" · ")}
      </div>
      <div>
        <div className="text-slate-400">files — authoritative</div>
        <LinkList links={row.files} testid="authoritative-files" />
      </div>
      <div>
        <div className="text-slate-400">tests — authoritative</div>
        <LinkList links={row.tests} testid="authoritative-tests" />
      </div>
      <div data-testid="advisory-links" className="rounded border border-dashed border-amber-800/70 px-2 py-1 text-amber-200/80">
        <div className="text-amber-300/90">ADVISORY — asserted, not evidence</div>
        {row.advisory_links.length === 0 ? (
          <div className="text-amber-200/50">(none)</div>
        ) : (
          <ul>
            {row.advisory_links.map((l) => (
              <li key={l.path}>
                {l.path} <span className="text-amber-200/50">({l.source}{l.note ? `: ${l.note}` : ""})</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex gap-1">
          <input value={linkPath} onChange={(e) => setLinkPath(e.target.value)} placeholder="repo-relative path"
            data-testid="advisory-path"
            className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-slate-200" />
          <button disabled={busy || linkPath.trim() === ""} onClick={() => void addLink(linkPath.trim(), "")}
            data-testid="advisory-add" className="rounded border border-ink-700 px-1.5 disabled:opacity-40">
            Assert link
          </button>
        </div>
      </div>
      <div>
        <div className="text-slate-400">obligations → evidence → verdict</div>
        {row.obligations.length === 0 ? (
          <div className="text-slate-500">(no obligation satisfies this requirement)</div>
        ) : (
          <ul>
            {row.obligations.map((o) => (
              <li key={o.id} data-testid={`obligation-${o.id}`}>
                [{o.id}] {o.kind}: {o.spec} → {o.accepted_records} record(s) → <b>{o.verdict ?? "no evidence"}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-800 pt-1.5">
        <button disabled={busy || row.status !== "open"} onClick={() => void decide({ kind: "accept", requirement_id: row.id })}
          data-testid="decide-accept" className="rounded border border-ink-700 px-2 py-0.5 disabled:opacity-40">
          Accept
        </button>
        <select value={other} onChange={(e) => setOther(e.target.value)} data-testid="decide-other"
          className="max-w-[14rem] rounded border border-ink-700 bg-ink-800 px-1 py-0.5">
          <option value="">— another requirement —</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>{o.id} {o.text.slice(0, 40)}</option>
          ))}
        </select>
        <button disabled={busy || other === ""} data-testid="decide-supersede"
          onClick={() => void decide({ kind: "supersede", requirement_id: row.id, successor_id: other })}
          className="rounded border border-ink-700 px-2 py-0.5 disabled:opacity-40">
          Superseded by it
        </button>
        <button disabled={busy || other === ""} data-testid="decide-conflict"
          onClick={() => void decide({ kind: "conflict", requirement_ids: [row.id, other] })}
          className="rounded border border-ink-700 px-2 py-0.5 disabled:opacity-40">
          Conflicts with it
        </button>
      </div>
    </div>
  );
}
