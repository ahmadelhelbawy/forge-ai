/**
 * Typed client for the FORGE web API.
 */
export interface ProviderInfo {
  id: string;
  available: boolean;
  defaultModel: string;
  baseUrlConfigured: boolean;
}

export interface TargetInfo {
  id: string;
  displayName: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface PromptVersion {
  v: number;
  text: string;
  source: "model" | "manual" | "import" | "restore" | "merge";
  at: string;
  /** The action that produced it (WS-R7). Absent on pre-V2 records. */
  action?: string;
  /** The turn that produced it (WS-R7). */
  turnId?: string;
  /** The hash that names this version's text (V2-C, WS-R17). */
  textHash?: string;
}

/** WS-R8: an alternative artifact inside one conversation. */
export interface PromptCandidate {
  id: string;
  label: string;
  text: string;
  fromVersion: number | null;
  strategy?: string;
  /** ST-R7: an open enum whose only v0.1 value is `archetype`. */
  origin: "archetype";
  /** ST-R6: the deciding rule, so the choice is the user's and not FORGE's. */
  rationale?: string;
  score?: number;
  at: string;
  /** Layer 1 against this candidate. Present on the candidate routes. */
  preservation?: PreservationReport;
}

/** ST-R6: which candidates produced which version. */
export interface CandidatePromotion {
  v: number;
  promotion: "select" | "merge";
  candidateIds: string[];
  at: string;
}

/** §11.5, reported as the evidence that the alternatives differ structurally. */
export interface OverlayDistinctness {
  pairs: Array<{ a: string; b: string; distance: number }>;
  rejected: Array<{ a: string; b: string; distance: number }>;
}

export interface CandidateGenerationPayload {
  fromVersion: number;
  candidates: PromptCandidate[];
  overlayDistinctness: OverlayDistinctness;
  diagnostics: DiagnosticWire[];
  calls: { extraction: number; generation: number; total: number };
  /** WS-R8: always false. Generating alternatives never moves the prompt. */
  versionCreated: false;
  currentV: number;
  layer: "deterministic";
}

export interface ComparedArtifact {
  ref: string;
  kind: "version" | "candidate";
  label: string;
  text: string;
  strategy?: string;
  preservation: PreservationReport;
}

export interface ComparisonPayload {
  a: ComparedArtifact;
  b: ComparedArtifact;
  /** Counted block differences — evidence, never a score (INV-008). */
  divergence: { shared: number; uniqueToA: number; uniqueToB: number };
  hunks: DiffHunk[];
  layer: "deterministic";
}

export interface PromotionPayload {
  version: PromptVersion;
  currentV: number;
  prompt: string;
  preservation: PreservationReport;
  promotions: CandidatePromotion[];
  layer: "deterministic";
  merge?: {
    blocks: Array<{ text: string; sourceIds: string[] }>;
    contributions: Array<{ sourceId: string; label: string; blocks: number; unique: number; shared: number }>;
  };
}

/** A coded finding as the API renders it. `source` is what WS-R28 turns on. */
export interface DiagnosticWire {
  code: string;
  name: string;
  severity: "error" | "warning" | "info";
  source: "deterministic" | "judged";
  message: string;
  evidence?: Array<Record<string, unknown>>;
}

/** WS-R24: one entry of the user-pinned ledger. */
export interface PinnedRequirement {
  id: string;
  text: string;
  contentHash: string;
  origin: "user_input";
  pinnedFromVersion: number | null;
  at: string;
}

export interface LedgerFinding {
  entryId: string;
  text: string;
  present: boolean;
}

/**
 * Layer 1's verdict (WS-R25).
 *
 * `layer` is carried on the wire rather than inferred by the client, so a
 * surface cannot accidentally render a deterministic guarantee with the same
 * treatment as judged advice (WS-R28, AC-043).
 */
export interface PreservationReport {
  layer: "deterministic";
  v: number;
  findings: LedgerFinding[];
  diagnostics: DiagnosticWire[];
}

export interface DriftFindingWire {
  kind: "vanished" | "changed";
  similarity: number;
  from: { id: string; kind: string; statement: string };
  nearest: { id: string; kind: string; statement: string };
  diagnostic: DiagnosticWire;
}

/**
 * Layer 2's report (WS-R26).
 *
 * `guarantee: false` and `advisory: true` are carried explicitly beside
 * `layer: "judged"`. Redundant on purpose: the one thing a surface must never
 * get wrong about this object is what kind of claim it is (WS-R28).
 */
export interface DriftReportWire {
  layer: "judged";
  guarantee: false;
  advisory: true;
  from: number;
  to: number;
  compared: number;
  skippedPinned: number;
  discarded: number;
  findings: DriftFindingWire[];
}

export interface PreservationPayload {
  ledger: PreservationReport & { guarantee: true };
  drift: DriftReportWire | null;
  /** False means Layer 2 did not run — never that nothing drifted (WS-R27.2). */
  driftRan: boolean;
  driftError?: string;
  citations: Record<string, string>;
  extractedCalls: number;
}

export interface AttachmentMeta {
  name: string;
  size: number;
  truncated: boolean;
  at: string;
  /** Trust tier assigned at upload (V2-R). Absent on pre-V2-R records. */
  trust?: string;
  /** What the secret scanner removed, by rule and count — never by value (SC-R6). */
  redactions?: Array<{ rule: string; count: number }>;
}

export interface ConversationDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  target: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
  attachments: AttachmentMeta[];
  promptVersions: PromptVersion[];
  candidates: PromptCandidate[];
  /** WS-R24. Present from V2-D1 on; empty for a conversation with no pins. */
  ledger: PinnedRequirement[];
  currentV: number;
  prompt: string | null;
  /** §22.11. Null until the first discovery turn. */
  discovery?: DiscoveryWire | null;
}

/** §22.11: FORGE's evolving understanding. Model-authored, validated, never user-stated. */
export interface DiscoveryBriefWire {
  vision?: string;
  goal?: string;
  target_user?: string;
  problem?: string;
  background?: string;
  capabilities?: string[];
  constraints?: string[];
  success_criteria?: string[];
  open_questions?: string[];
}

export interface DiscoveryWire {
  status: "open" | "generated";
  brief: DiscoveryBriefWire;
  questions: Array<{ question: string; options: string[] }>;
  ready: boolean;
  research_needed: string | null;
  turns: number;
}

/** The wire form of a turn event. Mirrors `web/lib/turn/events.ts`. */
export interface TurnEventWire {
  seq: number;
  turnId: string;
  at: string;
  kind: string;
  stage?: string;
  label?: string;
  action?: string;
  degraded?: boolean;
  reason?: string;
  v?: number;
  regenerated?: boolean;
}

export interface TurnOutcome {
  turnId?: string;
  reply: string;
  version: PromptVersion | null;
  promptChanged: boolean;
  prompt: string | null;
  action?: string;
  degraded?: boolean;
  refused?: boolean;
  streamed?: boolean;
  regenerated?: boolean;
  cancelled?: boolean;
  /** Layer 1's verdict on the version this turn wrote, or null (WS-R25). */
  preservation?: PreservationReport | null;
  diagnostics?: DiagnosticWire[];
}

export interface StreamHandlers {
  onEvent?(event: TurnEventWire): void;
  onReplyDelta?(text: string): void;
  onPromptDelta?(text: string): void;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  currentV: number;
  hasPrompt: boolean;
}

export interface Analysis {
  goals: string[];
  constraints: { statement: string; hardness: string }[];
  questions: { question: string; blocking: boolean; options: string[] }[];
  assumptions: string[];
  verification: { spec: string; expected: string }[];
  risk: string;
  repairs: number;
  model: string;
  latencyMs: number;
  strategies: { archetype: string; score: number; rationale: string }[];
}

export interface DiffHunk {
  type: "same" | "del" | "add";
  lines: string[];
}

export interface ProviderSummary {
  id: string;
  kind: "anthropic" | "openai-compat";
  displayName: string;
  enabled: boolean;
  custom: boolean;
  source: "settings" | "environment" | "default";
  status: "connected" | "error" | "not-configured" | "disabled" | "untested";
  maskedKey: string;
  baseURL: string | null;
  defaultModel: string;
  headers: string[];
  modelsPreset: { id: string; displayName: string }[];
  sessionHeader: string | null;
  lastTest: { ok: boolean; message: string; at: string } | null;
}

export interface ModelOption {
  id: string;
  displayName: string;
  provider: string;
  providerDisplayName: string;
}

/**
 * The explanation a failed response actually carries.
 *
 * Routes are not uniform: some reply with `error`, the connection test replies
 * with `message`, and a failure that has a full diagnostic block supplies
 * `diagnostic`. Reading only `error` discarded every real explanation and
 * rendered "Request failed (502)." instead — the defect this function fixes.
 */
export function errorTextFromBody(body: unknown, status: number): string {
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  for (const key of ["diagnostic", "error", "message"] as const) {
    const value = fields[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return `Request failed (${status}).`;
}

function cancelledOutcome(): TurnOutcome {
  return { reply: "", version: null, promptChanged: false, prompt: null, cancelled: true };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new Error(errorTextFromBody(body, response.status));
  }
  return body;
}


/** One artifact the compiler produced for a target (V2-R, FR-018). */
export interface CompiledArtifact {
  path: string;
  content: string;
  contentHash: string;
  bytes: number;
}

/** A byte range and the origin that produced it (INV-010). */
export interface CompiledSpan {
  artifactPath: string;
  start: number;
  end: number;
  origin: Record<string, unknown>;
}

/**
 * The result of compiling the current prompt for a target.
 *
 * `refused` is not an error: a target that cannot do what the prompt requires
 * SHOULD refuse (FORGE-C030), and the diagnostics say why. A client that
 * rendered a refusal as a failure would be hiding the most useful answer the
 * compiler gives.
 */
export interface CompileResponse {
  v: number;
  target: string;
  profileId: string;
  semanticHash: string;
  extracted: boolean;
  refused: boolean;
  tokenizer: { id: string; version: string };
  artifacts: CompiledArtifact[];
  spans: CompiledSpan[];
  diagnostics: DiagnosticWire[];
}


/** One file of an Execution Package, with the bytes to write (PK-R1). */
export interface PackageFileWire {
  path: string;
  content: string;
  contentHash: string;
  bytes: number;
}

export interface PackageResponse {
  v: number;
  target: string;
  profileId: string;
  semanticId: string;
  refused: boolean;
  extracted: boolean;
  files: PackageFileWire[];
}

/** One obligation's verdict (V2-G, spec.md §11.1). Mirrors `ObligationVerdict`. */
export interface ObligationVerdictWire {
  obligation_id: string;
  kind: string;
  spec: string;
  satisfies: string[];
  degraded_from: string | null;
  expected_exit_code: number | null;
  verdict: "VERIFIED" | "FAILED" | "UNVERIFIED" | "REVIEW_REQUIRED";
  records: Array<{ index: number; runner: string; exit_code: number | null }>;
}

export interface VerifyResponse {
  v: number;
  profileId: string;
  packageValid: boolean;
  semanticId: string | null;
  verdicts: ObligationVerdictWire[];
  diagnostics: DiagnosticWire[];
  json: string;
}

/** V2-H: one link a deterministic rule derived (LK-R1). `advisory` is always false. */
export interface AuthoritativeLinkWire {
  advisory: false;
  requirement_id: string;
  path: string;
  kind: "file" | "test";
  evidence: Array<
    | { type: "rg_term"; matched_terms: string[]; matched: number; of: number; required: number }
    | { type: "test_naming"; matched_terms: string[] }
    | { type: "scope_glob"; glob: string }
    | { type: "git_history"; commit_position: number }
  >;
}

/** V2-H: a link a user asserted (LK-R4). `advisory` is always true. */
export interface AdvisoryLinkWire {
  advisory: true;
  requirement_id: string;
  path: string;
  source: "user_asserted" | "model";
  note: string;
}

export interface MatrixRowWire {
  id: string;
  text: string;
  origin: "user_stated" | "inferred";
  status: "open" | "accepted" | "superseded" | "conflicted";
  pinned: boolean;
  superseded_by: string | null;
  active: boolean;
  conflicts_with: string[];
  sources: Array<{ kind: "ledger" } | { kind: "ir_node"; node_id: string; node_kind: string }>;
  artifact_spans: Array<{ artifact_path: string; start: number; end: number; node_id: string }>;
  files: AuthoritativeLinkWire[];
  tests: AuthoritativeLinkWire[];
  advisory_links: AdvisoryLinkWire[];
  obligations: Array<{
    id: string;
    kind: string;
    spec: string;
    expected: string;
    verdict: string | null;
    accepted_records: number;
  }>;
}

/** V2-H: the requirement traceability matrix (TM-R1–TM-R4). */
export interface TraceabilityMatrixWire {
  matrix_version: number;
  package_semantic_id: string | null;
  ir_extracted: boolean;
  repository_bound: boolean;
  verdicts_supplied: boolean;
  verdicts_rejected: boolean;
  caveat: string | null;
  rows: MatrixRowWire[];
  diagnostics: DiagnosticWire[];
}

export interface RepositoryWire {
  bound: boolean;
  root: string | null;
  usable: boolean;
  error?: string;
}

export type GovernanceDecisionWire =
  | { kind: "accept"; requirement_id: string }
  | { kind: "supersede"; requirement_id: string; successor_id: string }
  | { kind: "conflict"; requirement_ids: [string, string] };

export const api = {
  health: () => request<{ ok: boolean; version: string; storage: string; providers: ProviderInfo[] }>("/api/health"),
  catalog: () =>
    request<{
      providers: ProviderSummary[];
      targets: TargetInfo[];
      models: ModelOption[];
      defaultModel: { provider: string; model: string; custom?: true } | null;
    }>("/api/providers"),
  listConversations: () => request<{ conversations: ConversationSummary[] }>("/api/conversations"),
  createConversation: (input: { title?: string; target?: string; provider?: string; model?: string }) =>
    request<{ id: string }>("/api/conversations", { method: "POST", body: JSON.stringify(input) }),
  getConversation: (id: string) => request<ConversationDetail>(`/api/conversations/${id}`),
  packageVersion: (id: string, input: { target?: string; v?: number } = {}) =>
    request<PackageResponse>(`/api/conversations/${id}/package`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  verifyVersion: (id: string, input: { evidence: string; target?: string; v?: number }) =>
    request<VerifyResponse>(`/api/conversations/${id}/verify`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // V2-H (spec.md §22.10). Every call below is an explicit user action.
  repository: (id: string) => request<RepositoryWire>(`/api/conversations/${id}/repository`),
  bindRepository: (id: string, path: string) =>
    request<RepositoryWire>(`/api/conversations/${id}/repository`, { method: "POST", body: JSON.stringify({ path }) }),
  unbindRepository: (id: string) =>
    request<RepositoryWire>(`/api/conversations/${id}/repository`, { method: "DELETE" }),
  decideRequirement: (id: string, decision: GovernanceDecisionWire) =>
    request<unknown>(`/api/conversations/${id}/requirements`, { method: "POST", body: JSON.stringify({ decision }) }),
  addAdvisoryLink: (id: string, input: { requirementId: string; path: string; note?: string }) =>
    request<unknown>(`/api/conversations/${id}/links`, { method: "POST", body: JSON.stringify(input) }),
  traceability: (id: string, input: { target?: string; evidence?: string } = {}) =>
    request<TraceabilityMatrixWire>(`/api/conversations/${id}/traceability`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  compileVersion: (id: string, input: { target?: string; v?: number } = {}) =>
    request<CompileResponse>(`/api/conversations/${id}/compile`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteConversation: (id: string) => request<{ deleted: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  sendMessage: (
    id: string,
    input: { content?: string; target?: string; provider?: string; model?: string; regenerate?: boolean; generate?: boolean },
  ) => request<TurnOutcome>(`/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify(input) }),
  /**
   * Send a message and read the turn as it happens (WS-R10).
   *
   * The caller's `signal` is the cancel: aborting the fetch aborts the server
   * request, which is what the turn pipeline watches. An abort is reported as
   * a cancelled outcome rather than an error, because nothing went wrong.
   *
   * A server that cannot stream (no route, a proxy that buffers to death, a
   * non-SSE content type) falls back to the whole-response route, so the
   * product never depends on streaming being available.
   */
  streamMessage: async (
    id: string,
    input: { content?: string; target?: string; provider?: string; model?: string; regenerate?: boolean; generate?: boolean },
    handlers: StreamHandlers = {},
    signal?: AbortSignal,
  ): Promise<TurnOutcome> => {
    let response: Response;
    try {
      response = await fetch(`/api/conversations/${id}/messages/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) return cancelledOutcome();
      throw error;
    }
    if (response.status === 404) {
      // The streaming route is not deployed. This is the only safe moment to
      // fall back: the turn provably did not start, so re-sending cannot
      // double-write. A 2xx with the wrong content-type is NOT retried —
      // the turn may already have run, and running it twice would write two
      // versions for one request.
      return api.sendMessage(id, input);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(errorTextFromBody(body, response.status));
    }
    if (!response.body || !(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      throw new Error("The server did not return an event stream, so the turn could not be followed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let outcome: TurnOutcome | null = null;
    let failed: string | null = null;

    const handleFrame = (raw: string): void => {
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (!line) return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (payload["type"]) {
        case "event":
          handlers.onEvent?.(payload["event"] as TurnEventWire);
          return;
        case "delta": {
          const text = String(payload["text"] ?? "");
          if (payload["kind"] === "reply_delta") handlers.onReplyDelta?.(text);
          else handlers.onPromptDelta?.(text);
          return;
        }
        case "result":
          outcome = payload as unknown as TurnOutcome;
          return;
        case "failed":
          failed = errorTextFromBody(payload, 502);
          return;
        default:
          return;
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          handleFrame(buffer.slice(0, split));
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");
        }
      }
      if (buffer.trim()) handleFrame(buffer);
    } catch (error) {
      if (signal?.aborted) return cancelledOutcome();
      throw error;
    }

    if (failed !== null) throw new Error(failed);
    if (outcome === null) {
      // The stream ended with no outcome frame: the server went away. Say so
      // rather than presenting an empty turn as a successful one (INV-012).
      if (signal?.aborted) return cancelledOutcome();
      throw new Error("The turn ended before the server reported a result.");
    }
    return outcome;
  },
  savePrompt: (id: string, text: string) =>
    request<{
      version: PromptVersion | null;
      promptChanged: boolean;
      prompt: string;
      preservation?: PreservationReport | null;
    }>(`/api/conversations/${id}/prompt`, { method: "PUT", body: JSON.stringify({ text }) }),
  /**
   * The requirement ledger (WS-R24, WS-R25).
   *
   * Three calls, all of them user-initiated. There is no "FORGE pins this for
   * you" call, and there is no model on the server side of any of them.
   */
  listLedger: (id: string) =>
    request<{
      entries: PinnedRequirement[];
      layer: "deterministic";
      check: PreservationReport;
      proposals: string[];
    }>(`/api/conversations/${id}/ledger`),
  pinRequirement: (id: string, text: string, fromVersion?: number) =>
    request<{ entry: PinnedRequirement; entries: PinnedRequirement[]; check: PreservationReport }>(
      `/api/conversations/${id}/ledger`,
      { method: "POST", body: JSON.stringify({ text, ...(fromVersion === undefined ? {} : { fromVersion }) }) },
    ),
  /**
   * The advisory drift check (WS-R26, WS-R29).
   *
   * Opt-in: nothing calls this unless the user asks for it, which is what
   * keeps Layer 2 off the critical path of a turn.
   */
  preservation: (id: string) => request<PreservationPayload>(`/api/conversations/${id}/preservation`),
  checkDrift: (id: string, input: { from?: number; to?: number; provider?: string; model?: string }) =>
    request<PreservationPayload>(`/api/conversations/${id}/preservation`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unpinRequirement: (id: string, entryId: string) =>
    request<{ unpinned: PinnedRequirement; entries: PinnedRequirement[]; check: PreservationReport }>(
      `/api/conversations/${id}/ledger/${encodeURIComponent(entryId)}`,
      { method: "DELETE" },
    ),
  /**
   * WS-R8. The candidate set, and the request that creates one.
   *
   * `listCandidates` is free; `generateCandidates` is the explicit ask. Note
   * that neither writes a version — `selectCandidate` and `mergeCandidates`
   * are the only two client calls that can (ST-R6, WS-R2).
   */
  listCandidates: (id: string) =>
    request<{
      candidates: PromptCandidate[];
      promotions: CandidatePromotion[];
      currentV: number;
      limits: { min: number; max: number; default: number };
      layer: "deterministic";
    }>(`/api/conversations/${id}/candidates`),
  generateCandidates: (id: string, input: { count?: number; provider?: string; model?: string }) =>
    request<CandidateGenerationPayload>(`/api/conversations/${id}/candidates`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  compareArtifacts: (id: string, a: string, b: string) =>
    request<ComparisonPayload>(
      `/api/conversations/${id}/candidates/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    ),
  selectCandidate: (id: string, candidateId: string) =>
    request<PromotionPayload>(`/api/conversations/${id}/candidates/${encodeURIComponent(candidateId)}/select`, {
      method: "POST",
    }),
  mergeCandidates: (id: string, refs: string[]) =>
    request<PromotionPayload>(`/api/conversations/${id}/candidates/merge`, {
      method: "POST",
      body: JSON.stringify({ refs }),
    }),
  restoreVersion: (id: string, v: number) =>
    request<{ currentV: number; prompt: string }>(`/api/conversations/${id}/versions/${v}/restore`, { method: "POST" }),
  listVersions: (id: string) =>
    request<{ versions: PromptVersion[]; currentV: number; candidates: PromptCandidate[] }>(
      `/api/conversations/${id}/versions`,
    ),
  diffVersions: (id: string, a: number, b: number) =>
    request<{ a: number; b: number; hunks: DiffHunk[] }>(`/api/conversations/${id}/diff?a=${a}&b=${b}`),
  uploadAttachments: async (id: string, files: File[]): Promise<{ attachments: AttachmentMeta[] }> => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const response = await fetch(`/api/conversations/${id}/attachments`, { method: "POST", body: form });
    const body = (await response.json().catch(() => ({}))) as { attachments?: AttachmentMeta[]; error?: string };
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Upload failed.");
    return { attachments: body.attachments ?? [] };
  },
  analyze: (id: string, input: { provider?: string; model?: string }) =>
    request<Analysis>(`/api/conversations/${id}/analyze`, { method: "POST", body: JSON.stringify(input) }),
  listSettings: () =>
    request<{ providers: ProviderSummary[]; defaultModel: { provider: string; model: string } | null }>(
      "/api/settings/providers",
    ),
  saveProvider: (id: string, input: Record<string, unknown>) =>
    request<{ provider: ProviderSummary }>(`/api/settings/providers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteProvider: (id: string) =>
    request<{ deleted: boolean; reset: boolean }>(`/api/settings/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  createCustomProvider: (input: { name: string; baseURL: string; model: string }) =>
    request<{ provider: ProviderSummary }>("/api/settings/providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** Tests the values currently on screen, not what was last saved. */
  testProvider: (id: string, current: { model?: string; apiKey?: string; baseURL?: string }) =>
    request<{ ok: boolean; message: string; model: string; protocol?: string; reply?: string }>(
      `/api/settings/providers/${encodeURIComponent(id)}/test`,
      { method: "POST", body: JSON.stringify(current) },
    ),
  providerModels: (id: string) =>
    request<{ provider: string; discovered: string[] | null; source: string }>(
      `/api/settings/providers/${encodeURIComponent(id)}/models`,
    ),
  getDefaultModel: () =>
    request<{ defaultModel: { provider: string; model: string } | null }>("/api/settings/default-model"),
  setDefaultModel: (provider: string, model: string, custom = false) =>
    request<{ defaultModel: { provider: string; model: string; custom?: true } | null }>("/api/settings/default-model", {
      method: "PUT",
      body: JSON.stringify({ provider, model, ...(custom ? { custom: true } : {}) }),
    }),
};
