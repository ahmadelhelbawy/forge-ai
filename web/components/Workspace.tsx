"use client";

import { AlertTriangle, FlaskConical, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatPanel } from "./ChatPanel";
import { PromptStudio } from "./PromptStudio";
import { SettingsModal } from "./SettingsModal";
import { Sidebar } from "./Sidebar";
import {
  api,
  type ConversationDetail,
  type ConversationSummary,
  type DiagnosticWire,
  type ModelOption,
  type PinnedRequirement,
  type PreservationReport,
  type PromptVersion,
  type TargetInfo,
} from "@/lib/api";
import { resolveSelection, type ProviderDefault, type Selection, type SelectionRef } from "@/lib/model-selection";

export function Workspace(): React.JSX.Element {
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [target, setTarget] = useState("generic");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"providers" | "models" | "general">("providers");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /**
   * The last finished turn's diagnostics (INV-012). Turn-scoped: cleared when
   * the next turn starts and when another conversation is opened, because a
   * finding about one turn is not a standing property of the conversation.
   */
  const [diagnostics, setDiagnostics] = useState<DiagnosticWire[]>([]);
  const [streamingReply, setStreamingReply] = useState("");
  const [streamingPrompt, setStreamingPrompt] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  /**
   * Version history with provenance (WS-R7).
   *
   * The detail response carries the versions a conversation holds; this list
   * adds what the store knows about each one — the action, the turn, and the
   * hash that names its text. It is a separate read because it is answered
   * from the derivable index rather than by folding the log (AD-20).
   */
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  /**
   * The requirement ledger and Layer 1's verdict (WS-R24, WS-R25).
   *
   * Read from the server rather than derived in the browser: the guarantee is
   * a server-side deterministic check, and a client that recomputed it would
   * be a second implementation of the thing that must have exactly one.
   */
  const [ledger, setLedger] = useState<PinnedRequirement[]>([]);
  const [preservation, setPreservation] = useState<PreservationReport | null>(null);
  const [proposals, setProposals] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);

  const providerAvailable = models.length > 0;

  const applyPair = useCallback((nextProvider: string, nextModel: string) => {
    setProvider(nextProvider);
    setModel(nextModel);
    setCustomModel(false);
  }, []);

  const applySelection = useCallback((selection: Selection | null) => {
    if (!selection) return;
    setProvider(selection.provider);
    setModel(selection.model);
    setCustomModel(selection.custom);
  }, []);

  /**
   * The latest catalog, for callbacks that must validate a selection without
   * being re-created every time it changes. `resolveSelection` is the only
   * place a selection is decided; this is just what it is decided against.
   */
  const catalogRef = useRef<{
    models: ModelOption[];
    providers: ProviderDefault[];
    stored: SelectionRef | null;
  }>({ models: [], providers: [], stored: null });

  const refreshCatalog = useCallback(async () => {
    const catalog = await api.catalog();
    setTargets(catalog.targets);
    setModels(catalog.models);
    catalogRef.current = {
      models: catalog.models,
      providers: catalog.providers.filter((p) => p.enabled).map((p) => ({ id: p.id, defaultModel: p.defaultModel })),
      stored: catalog.defaultModel,
    };
    return catalog;
  }, []);

  /**
   * Persist the user's choice so a refresh restores it. A typed id is stored
   * as custom, which is what lets it survive a refresh without being mistaken
   * for a stale list entry.
   */
  const persistSelection = useCallback((nextProvider: string, nextModel: string, custom: boolean) => {
    if (!nextProvider || !nextModel.trim()) return;
    catalogRef.current = {
      ...catalogRef.current,
      stored: { provider: nextProvider, model: nextModel.trim(), ...(custom ? { custom: true } : {}) },
    };
    void api.setDefaultModel(nextProvider, nextModel.trim(), custom).catch(() => undefined);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const { conversations } = await api.listConversations();
      setConversations(conversations);
    } catch {
      // List failures surface on the next mutating call; stay quiet here.
    }
  }, []);

  useEffect(() => {
    refreshCatalog()
      .then(async (catalog) => {
        setTargets(catalog.targets);
        setModels(catalog.models);
        setCatalogReady(true);
        applySelection(resolveSelection({ ...catalogRef.current, current: null }));
      })
      .catch(() => undefined);
    refreshList();
  }, [refreshList, refreshCatalog, applySelection]);

  const onSettingsChanged = useCallback(async () => {
    try {
      await refreshCatalog();
      // A provider's saved model may have changed under the selection. Keep
      // it if it is still offered; otherwise switch to that provider's saved
      // default rather than leaving a model on screen nothing can serve.
      applySelection(
        resolveSelection({ ...catalogRef.current, current: { provider, model, custom: customModel } }),
      );
    } catch {
      // Catalog refresh is best-effort; settings already saved server-side.
    }
  }, [refreshCatalog, applySelection, provider, model, customModel]);

  const refreshLedger = useCallback(async (id: string) => {
    try {
      const result = await api.listLedger(id);
      setLedger(result.entries);
      setPreservation(result.check);
      setProposals(result.proposals);
    } catch {
      // The ledger is not the conversation; a failed read must not blank the
      // workspace. The next turn or tab switch retries.
    }
  }, []);

  const select = useCallback(async (id: string) => {
    setActiveId(id);
    setError(null);
    // Turn-scoped, so they do not follow the user into another conversation.
    setDiagnostics([]);
    try {
      const convo = await api.getConversation(id);
      setDetail(convo);
      setVersions(await api.listVersions(id).then((r) => r.versions).catch(() => convo.promptVersions));
      await refreshLedger(id);
      setCanRetry(convo.messages.some((m) => m.role === "user"));
      setTarget(convo.target || "generic");
      // A conversation remembers the model it last used, which may since have
      // been removed or be unavailable to the account. Validate it rather than
      // trusting it: an invalid one resolves to its provider's saved default.
      applySelection(
        resolveSelection({
          ...catalogRef.current,
          current: convo.provider && convo.model ? { provider: convo.provider, model: convo.model } : null,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refreshLedger, applySelection]);

  const create = useCallback(async () => {
    try {
      const { id } = await api.createConversation({ target, provider, model });
      await refreshList();
      await select(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [target, provider, model, refreshList, select]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this conversation and all its prompt versions?")) return;
      try {
        await api.deleteConversation(id);
        if (activeId === id) {
          setActiveId(null);
          setDetail(null);
          setVersions([]);
          setLedger([]);
          setPreservation(null);
          setProposals([]);
        }
        await refreshList();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId, refreshList],
  );

  const reload = useCallback(
    async (id: string) => {
      const convo = await api.getConversation(id);
      setDetail(convo);
      setVersions(await api.listVersions(id).then((r) => r.versions).catch(() => convo.promptVersions));
      await refreshLedger(id);
      await refreshList();
    },
    [refreshList, refreshLedger],
  );

  /**
   * Run one turn, streaming it (WS-R10).
   *
   * The partial text lives here and is thrown away when the turn ends, however
   * it ends: the saved conversation reloaded from the server is the only thing
   * rendered afterwards. That is what makes a cancel leave nothing behind —
   * there is no client state that could survive as a phantom message.
   */
  const runTurn = useCallback(
    async (input: { content?: string; regenerate?: boolean }) => {
      let id = activeId;
      if (!id) {
        try {
          const created = await api.createConversation({ target, provider, model });
          id = created.id;
          setActiveId(id);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setSending(true);
      setError(null);
      setCanRetry(false);
      setStageLabel(null);
      setStreamingReply("");
      setStreamingPrompt("");
      setStartedAt(Date.now());
      setDiagnostics([]);
      // A regenerate re-runs a message already on screen; a send shows the new
      // one immediately, so the first turn of a conversation is never a blank
      // screen with a request in flight.
      setPendingUserMessage(input.regenerate ? null : (input.content ?? null));
      try {
        const outcome = await api.streamMessage(
          id,
          { ...input, target, provider, model },
          {
            onEvent: (event) => {
              if (event.kind === "stage" && event.label) setStageLabel(event.label);
            },
            onReplyDelta: (text) => setStreamingReply((current) => current + text),
            onPromptDelta: (text) => setStreamingPrompt((current) => current + text),
          },
          controller.signal,
        );
        // Drop the streamed text BEFORE the reload, so the Studio never shows
        // a live draft next to the saved version it just became — the window
        // where both were true rendered a draft badge for a version that
        // already existed.
        setStreamingReply("");
        setStreamingPrompt("");
        setPendingUserMessage(null);
        await reload(id);
        // A cancelled turn is not an error and gets no banner: the server kept
        // the message and wrote nothing, and the reload above shows exactly
        // that. Retry stays offered because the message is still there.
        setCanRetry(true);
        // INV-012: the pipeline has been producing these all along and the
        // routes have been serialising them; until V2-R this line was
        // `void outcome`, which is where every FORGE-W001–W004 went.
        setDiagnostics(outcome.diagnostics ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setCanRetry(true);
        try {
          await reload(id);
        } catch {
          // Keep the banner; the conversation may still be intact server-side.
        }
      } finally {
        abortRef.current = null;
        setSending(false);
        setPendingUserMessage(null);
        setStageLabel(null);
        setStartedAt(null);
        setStreamingReply("");
        setStreamingPrompt("");
      }
    },
    [activeId, target, provider, model, reload],
  );

  const send = useCallback((text: string) => runTurn({ content: text }), [runTurn]);
  const retry = useCallback(() => runTurn({ regenerate: true }), [runTurn]);
  const stop = useCallback(() => abortRef.current?.abort(), []);

  const attach = useCallback(
    async (files: File[]) => {
      if (!activeId) return;
      try {
        await api.uploadAttachments(activeId, files);
        await reload(activeId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId, reload],
  );

  const saveEdit = useCallback(
    async (text: string) => {
      if (!activeId) return;
      await api.savePrompt(activeId, text);
      await reload(activeId);
    },
    [activeId, reload],
  );

  const restore = useCallback(
    async (v: number) => {
      if (!activeId) return;
      await api.restoreVersion(activeId, v);
      await reload(activeId);
    },
    [activeId, reload],
  );

  /**
   * Reload after a candidate operation (V2-E).
   *
   * Generating alternatives changes only the candidate set; promoting or
   * merging also writes a version. One reload covers both, and the pane is
   * what decides which happened — the workspace just re-reads the truth.
   */
  const refreshArtifacts = useCallback(async () => {
    if (!activeId) return;
    await reload(activeId);
  }, [activeId, reload]);

  /**
   * Pin and unpin (WS-R24, WS-R27.4).
   *
   * Both are here, on a user gesture, and nowhere else. There is no code path
   * from a turn, a diagnostic or a model response into either of them — which
   * is what AC-042 asserts adversarially on the server side.
   */
  const pin = useCallback(
    async (text: string) => {
      if (!activeId) throw new Error("Open or start a conversation before pinning a requirement.");
      const result = await api.pinRequirement(activeId, text);
      setLedger(result.entries);
      setPreservation(result.check);
    },
    [activeId],
  );

  const unpin = useCallback(
    async (entryId: string) => {
      if (!activeId) return;
      try {
        const result = await api.unpinRequirement(activeId, entryId);
        setLedger(result.entries);
        setPreservation(result.check);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId],
  );

  const groupedModels = (): Array<{ provider: string; label: string; models: ModelOption[] }> => {
    const groups = new Map<string, { label: string; models: ModelOption[] }>();
    for (const m of models) {
      const entry = groups.get(m.provider) ?? { label: m.providerDisplayName, models: [] };
      entry.models.push(m);
      groups.set(m.provider, entry);
    }
    return [...groups.entries()].map(([provider, g]) => ({ provider, ...g }));
  };

  const selectedValue = customModel ? "__custom" : `${provider}|||${model}`;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-ink-800 bg-ink-900 px-4 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target</div>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-[13px] text-slate-200 focus:border-accent-500 focus:outline-none"
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Model</div>
        {customModel ? (
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => persistSelection(provider, model, true)}
            placeholder="Custom model ID"
            spellCheck={false}
            autoFocus
            className="w-56 rounded-md border border-accent-500/60 bg-ink-800 px-2 py-1.5 font-mono text-[12.5px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
          />
        ) : (
          <select
            value={models.some((m) => m.provider === provider && m.id === model) ? selectedValue : ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "__custom") {
                setCustomModel(true);
                return;
              }
              const [nextProvider, ...rest] = value.split("|||");
              const nextModel = rest.join("|||");
              if (nextProvider && nextModel) {
                applyPair(nextProvider, nextModel);
                persistSelection(nextProvider, nextModel, false);
              }
            }}
            className="max-w-72 rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-[13px] text-slate-200 focus:border-accent-500 focus:outline-none"
          >
            {models.length === 0 ? <option value="">No models available</option> : null}
            {groupedModels().map((g) => (
              <optgroup key={g.provider} label={g.label}>
                {g.models.map((m) => (
                  <option key={`${m.provider}|||${m.id}`} value={`${m.provider}|||${m.id}`}>
                    {m.displayName}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="__custom">Custom model ID…</option>
          </select>
        )}
        {customModel ? (
          <button
            onClick={() => {
              // Back to the list: a typed id is not a list entry, so resolve
              // to one the list actually offers — the provider's saved default.
              // `stored: null` on purpose: the stored selection IS the custom id
              // being left, and passing it would keep it.
              const next = resolveSelection({ ...catalogRef.current, current: { provider, model }, stored: null });
              applySelection(next);
              if (next) persistSelection(next.provider, next.model, false);
            }}
            className="rounded-md border border-ink-700 px-2 py-1.5 text-[12px] text-slate-400 hover:text-slate-200"
          >
            List
          </button>
        ) : null}
        <div className="flex-1" />
        <button
          onClick={() => {
            setSettingsTab("providers");
            setSettingsOpen(true);
          }}
          title="Settings"
          className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-[12.5px] text-slate-400 transition-colors hover:text-slate-200"
        >
          <SettingsIcon size={14} />
          Settings
        </button>
        <button
          onClick={() => setAdvanced((v) => !v)}
          title="Show the Advanced panel (structure inspection)"
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors ${
            advanced
              ? "border-accent-500/60 bg-accent-500/10 text-accent-400"
              : "border-ink-700 bg-ink-800 text-slate-400 hover:text-slate-200"
          }`}
        >
          <FlaskConical size={14} />
          Advanced
        </button>
        <div
          title={providerAvailable ? "Model provider reachable" : "No provider configured"}
          className={`h-2.5 w-2.5 rounded-full ${providerAvailable ? "bg-green-400" : "bg-red-400"}`}
        />
      </header>

      {error ? (
        <div className="flex items-start gap-2 border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-[13px] text-red-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-red-300/70 hover:text-red-200">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {catalogReady && !providerAvailable && !activeId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-md rounded-xl border border-ink-700 bg-ink-900 p-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-ink-700 font-mono text-lg font-bold text-slate-200">
                F
              </div>
              <div className="text-[15px] font-semibold text-slate-100">No AI provider connected</div>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
                FORGE needs a model to chat with. Connect Anthropic, OpenAI, Google, xAI, OpenCode Go,
                OpenRouter — or any OpenAI-compatible endpoint — then pick a model and start.
              </p>
              <button
                onClick={() => {
                  setSettingsTab("providers");
                  setSettingsOpen(true);
                }}
                className="mt-4 rounded-lg bg-accent-500 px-5 py-2 text-[13.5px] font-medium text-white hover:bg-accent-400"
              >
                Connect provider
              </button>
            </div>
          </div>
        ) : (
          <>
            <Sidebar conversations={conversations} activeId={activeId} onSelect={select} onNew={create} onDelete={remove} />
            <ChatPanel
              messages={detail?.messages ?? []}
              attachments={detail?.attachments ?? []}
              sending={sending}
              ready
              providerAvailable={providerAvailable}
              streamingReply={streamingReply}
              pendingUserMessage={pendingUserMessage}
              stageLabel={stageLabel}
              startedAt={startedAt}
              diagnostics={diagnostics}
              onSend={send}
              onAttach={attach}
              onStop={stop}
              onRetry={retry}
              canRetry={canRetry && !sending && (detail?.messages.length ?? 0) > 0}
            />
            <PromptStudio
              conversationId={activeId}
              prompt={detail?.prompt ?? null}
              versions={versions}
              candidates={detail?.candidates ?? []}
              currentV={detail?.currentV ?? 0}
              streamingPrompt={sending ? streamingPrompt : ""}
              provider={provider}
              model={model}
              advanced={advanced}
              ledger={ledger}
              preservation={preservation}
              proposals={proposals}
              targets={targets}
              target={target}
              onSaveEdit={saveEdit}
              onRestore={restore}
              onPin={pin}
              onUnpin={unpin}
              onArtifactsChanged={refreshArtifacts}
            />
          </>
        )}
      </div>
      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
        onChanged={onSettingsChanged}
      />
    </div>
  );
}
