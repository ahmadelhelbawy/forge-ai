"use client";

import {
  AlertTriangle,
  FlaskConical,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings as SettingsIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatPanel } from "./ChatPanel";
import { PipelineRail, type RailStage } from "./PipelineRail";
import { PromptStudio, type StudioTab } from "./PromptStudio";
import { Resizer } from "./Resizer";
import { SettingsModal } from "./SettingsModal";
import { Sidebar } from "./Sidebar";
import {
  api,
  type ArtifactKindWire,
  type ConversationDetail,
  type ConversationSummary,
  type DiagnosticWire,
  type ModelOption,
  type OutputShapeWire,
  type PinnedRequirement,
  type PreservationReport,
  type PromptVersion,
  type ReasoningAvailabilityWire,
  type ReasoningEffortWire,
  type TargetInfo,
  type TransformationModeWire,
} from "@/lib/api";
import { resolveSelection, type ProviderDefault, type Selection, type SelectionRef } from "@/lib/model-selection";
import { useMediaQuery, usePref } from "@/lib/prefs";

const LEFT = { min: 200, max: 420, initial: 256 };
const RIGHT = { min: 360, max: 900, initial: 460 };

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
  const conversationsRef = useRef<ConversationSummary[]>([]);
  conversationsRef.current = conversations;
  const [activeIdState, setActiveIdState] = useState<string | null>(null);
  /**
   * The open conversation, readable from async code. Every response is applied
   * only if it still belongs to the open conversation: without this, a turn or
   * a load that finished after the user switched wrote conversation A's state
   * onto B's screen (audit 2026-09-29).
   */
  const activeIdRef = useRef<string | null>(null);
  const activeId = activeIdState;
  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);
  const isOpen = (id: string): boolean => activeIdRef.current === id;
  /** The conversation the running turn belongs to (one turn at a time). */
  const [turnConversation, setTurnConversation] = useState<string | null>(null);
  // While "New conversation" is still being created, sending is disabled: a
  // message sent in that window created a second conversation, and the
  // pending create then selected the empty one — so Generate wrote into a
  // conversation other than the one on screen (found by browser acceptance).
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** A message the server refused before keeping it, handed back to the composer. */
  const [returnedDraft, setReturnedDraft] = useState<{ text: string; at: number } | null>(null);
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
  const starting = useRef(false);
  const [advanced, setAdvanced] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);

  // ── Workspace layout: per-browser preferences (lib/prefs) ───────────────
  const narrow = useMediaQuery("(max-width: 1099px)");
  const [leftOpen, setLeftOpen] = usePref("leftOpen", true);
  const [rightOpen, setRightOpen] = usePref("rightOpen", true);
  const [leftWidth, setLeftWidth] = usePref("leftWidth", LEFT.initial);
  const [rightWidth, setRightWidth] = usePref("rightWidth", RIGHT.initial);
  const [studioMax, setStudioMax] = usePref("studioMax", false);
  const [studioTab, setStudioTab] = usePref<StudioTab>("studioTab", "prompt");

  // The Studio follows the work: while discovery runs with no prompt, the
  // brief is what there is to see; the moment a version is written, the
  // prompt is. Keyed on the conversation and version, so a user who picks a
  // tab keeps it until something new happens.
  const lastSeen = useRef<string>("");
  useEffect(() => {
    if (!detail) return;
    const key = `${detail.id}:${detail.currentV}:${detail.discovery?.status ?? "none"}`;
    if (key === lastSeen.current) return;
    const [prevId, prevV] = lastSeen.current.split(":");
    lastSeen.current = key;
    if (detail.currentV === 0 && detail.discovery?.status === "open") setStudioTab("brief");
    else if (prevId === detail.id && Number(prevV) !== detail.currentV && detail.currentV > 0) setStudioTab("prompt");
  }, [detail, setStudioTab]);
  // On a narrow screen the side panels are drawers, closed until asked for.
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);

  // ── Conversation settings the user owns (WS-R39, WS-R40, WS-R43) ────────
  // Kept locally before a conversation exists, then applied to it on creation.
  const [draftKind, setDraftKind] = useState<ArtifactKindWire>("unspecified");
  const [draftShape, setDraftShape] = useState<OutputShapeWire>("single");
  const [defaultEffort, setDefaultEffort] = usePref<ReasoningEffortWire>("reasoningEffort", "default");
  const [reasoning, setReasoning] = useState<ReasoningAvailabilityWire | null>(null);

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
      if (activeIdRef.current !== id) return;
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
    rememberConversation(id);
    setLeftDrawer(false);
    setError(null);
    // Turn-scoped, so they do not follow the user into another conversation.
    setDiagnostics([]);
    try {
      const convo = await api.getConversation(id);
      if (!isOpen(id)) return;
      const listed = await api.listVersions(id).then((r) => r.versions).catch(() => convo.promptVersions);
      if (!isOpen(id)) return;
      setDetail(convo);
      setVersions(listed);
      await refreshLedger(id);
      if (!isOpen(id)) return;
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
  }, [refreshLedger, applySelection, setActiveId]);

  // A reload returns to the conversation that was open: the URL names it
  // (`#c=<id>`, so it can be bookmarked), with the last one opened as the
  // fallback. Waits for the model catalog, which `select` validates against.
  const restored = useRef(false);
  useEffect(() => {
    if (!catalogReady || restored.current) return;
    restored.current = true;
    const wanted = rememberedConversation();
    if (!wanted) return;
    // One read of the one conversation, not the whole list: with a hundred
    // conversations the list made a reload visibly reopen the wrong screen
    // first. A conversation that no longer exists is simply forgotten.
    void api
      .getConversation(wanted)
      .then(() => select(wanted))
      .catch(() => forgetConversation());
  }, [catalogReady, select]);

  const create = useCallback(async () => {
    setCreating(true);
    try {
      // Clicking New while the open conversation is still untouched keeps it
      // rather than adding another empty row. Only the open one: any other
      // empty record may carry settings (a target, a closed discovery) the
      // user would not expect a "new" conversation to inherit.
      if (
        detail &&
        detail.messages.length === 0 &&
        detail.promptVersions.length === 0 &&
        detail.discovery === null
      ) {
        return;
      }
      const { id } = await api.createConversation({ target, provider, model });
      await refreshList();
      await select(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [target, provider, model, refreshList, select, detail]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this conversation and all its prompt versions?")) return;
      try {
        await api.deleteConversation(id);
        if (activeId === id) {
          setActiveId(null);
          forgetConversation();
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
    [activeId, refreshList, setActiveId],
  );

  const reload = useCallback(
    async (id: string) => {
      const convo = await api.getConversation(id);
      const listed = await api.listVersions(id).then((r) => r.versions).catch(() => convo.promptVersions);
      if (isOpen(id)) {
        setDetail(convo);
        setVersions(listed);
        await refreshLedger(id);
      }
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
  const artifactKind: ArtifactKindWire = detail?.artifactKind ?? draftKind;
  const outputShape: OutputShapeWire = detail?.outputShape ?? draftShape;
  const effort: ReasoningEffortWire = detail?.reasoningEffort ?? defaultEffort;

  const runTurn = useCallback(
    async (input: { content?: string; regenerate?: boolean; generate?: boolean; mode?: TransformationModeWire }) => {
      // A double click on the first message (or an example) must not create
      // two conversations and run two turns: the create is awaited before
      // `sending` is set, so this ref closes that window.
      if (starting.current) return;
      starting.current = true;
      let id = activeId;
      if (!id) {
        try {
          const created = await api.createConversation({ target, provider, model });
          id = created.id;
          setActiveId(id);
          rememberConversation(id);
          if (draftKind !== "unspecified" || draftShape !== "single") {
            await api.updateConversation(id, { artifactKind: draftKind, outputShape: draftShape });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          starting.current = false;
          return;
        }
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setTurnConversation(id);
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
          {
            ...input,
            target,
            provider,
            model,
            // WS-R42: only an effort the model is known to accept is sent.
            // Otherwise none is named, so the conversation keeps the choice
            // for when the user switches back to a model that takes it.
            ...(reasoning?.supported ? { reasoningEffort: effort } : {}),
          },
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
        if (isOpen(id)) {
          setCanRetry(true);
          // INV-012: the pipeline has been producing these all along and the
          // routes have been serialising them; until V2-R this line was
          // `void outcome`, which is where every FORGE-W001–W004 went.
          setDiagnostics(outcome.diagnostics ?? []);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // A failure of a turn in another conversation is still reported, and
        // says which conversation it belongs to.
        const title = conversationsRef.current.find((c) => c.id === id)?.title;
        setError(isOpen(id) ? message : `In "${title ?? "another conversation"}": ${message}`);
        if (isOpen(id)) setCanRetry(true);
        try {
          await reload(id);
          // A configuration failure (no key, unknown model) is refused before
          // the server keeps the message. The composer was already cleared, so
          // without this the user's text was simply gone.
          if (!input.regenerate && input.content) {
            const saved = await api.getConversation(id);
            const last = [...saved.messages].reverse().find((m) => m.role === "user");
            if (last?.content !== input.content && isOpen(id)) setReturnedDraft({ text: input.content, at: Date.now() });
          }
        } catch {
          // Keep the banner; the conversation may still be intact server-side.
        }
      } finally {
        starting.current = false;
        abortRef.current = null;
        setTurnConversation(null);
        setSending(false);
        setPendingUserMessage(null);
        setStageLabel(null);
        setStartedAt(null);
        setStreamingReply("");
        setStreamingPrompt("");
      }
    },
    [activeId, target, provider, model, reload, draftKind, draftShape, reasoning, effort, setActiveId],
  );

  const send = useCallback((text: string) => runTurn({ content: text }), [runTurn]);
  const retry = useCallback(() => runTurn({ regenerate: true }), [runTurn]);
  // WS-R31: the only way out of discovery. The server words the message.
  const generate = useCallback(
    (mode?: TransformationModeWire) =>
      runTurn({
        generate: true,
        content: mode
          ? `Generate the prompt (${mode}) from what we have discussed.`
          : "Generate the prompt from what we have discussed.",
        ...(mode ? { mode } : {}),
      }),
    [runTurn],
  );

  /** WS-R39/WS-R40/WS-R43/WS-R46: a user setting, saved on the conversation. */
  const updateSettings = useCallback(
    async (patch: Parameters<typeof api.updateConversation>[1]) => {
      if (!activeId) {
        if (patch.artifactKind) setDraftKind(patch.artifactKind);
        if (patch.outputShape) setDraftShape(patch.outputShape);
        if (patch.reasoningEffort) setDefaultEffort(patch.reasoningEffort);
        return;
      }
      try {
        await api.updateConversation(activeId, patch);
        if (patch.reasoningEffort) setDefaultEffort(patch.reasoningEffort);
        await reload(activeId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId, reload, setDefaultEffort],
  );

  // WS-R42: ask the server whether the chosen model takes a reasoning setting.
  useEffect(() => {
    if (!provider || !model || customModel) {
      setReasoning(
        customModel
          ? { supported: false, levels: [], source: null, wire: null, reason: "FORGE has no record that a custom model id accepts a reasoning setting, so it sends none." }
          : null,
      );
      return;
    }
    let live = true;
    // The previous model's answer must not stand in for this one's while the
    // check runs: its levels could be sent to a model that rejects them.
    setReasoning(null);
    api
      .reasoning(provider, model)
      .then((r) => live && setReasoning(r))
      .catch(
        (e: unknown) =>
          live &&
          setReasoning({
            supported: false,
            levels: [],
            source: null,
            wire: null,
            reason: `Could not check reasoning support (${e instanceof Error ? e.message : String(e)}); none is sent.`,
          }),
      );
    return () => {
      live = false;
    };
  }, [provider, model, customModel]);

  const openStudio = useCallback(
    (stage: RailStage | StudioTab) => {
      setStudioTab(stage === "brief" ? "brief" : (stage as StudioTab));
      if (narrow) setRightDrawer(true);
      else setRightOpen(true);
    },
    [narrow, setStudioTab, setRightOpen],
  );
  const stop = useCallback(() => abortRef.current?.abort(), []);

  const attach = useCallback(
    async (files: File[]) => {
      try {
        // Attaching first is a fine way to start: the conversation is created
        // for the files instead of the click silently doing nothing.
        let id = activeId;
        if (!id) {
          id = (await api.createConversation({ target, provider, model })).id;
          setActiveId(id);
          rememberConversation(id);
        }
        await api.uploadAttachments(id, files);
        await reload(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId, reload, target, provider, model, setActiveId],
  );

  const saveEdit = useCallback(
    async (text: string) => {
      if (!activeId) return;
      try {
        await api.savePrompt(activeId, text);
        await reload(activeId);
      } catch (e) {
        // Shown, then rethrown so the editor stays open with the draft: a
        // failed save that closed the editor would lose the user's text.
        setError(`Your edit was not saved: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }
    },
    [activeId, reload],
  );

  const restore = useCallback(
    async (v: number) => {
      if (!activeId) return;
      try {
        await api.restoreVersion(activeId, v);
        await reload(activeId);
      } catch (e) {
        setError(`Version ${v} was not restored: ${e instanceof Error ? e.message : String(e)}`);
      }
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

  // Ctrl/Cmd+B toggles conversations, Ctrl/Cmd+. toggles the Studio.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "b") {
        e.preventDefault();
        if (narrow) setLeftDrawer((v) => !v);
        else setLeftOpen(!leftOpen);
      } else if (e.key === ".") {
        e.preventDefault();
        if (narrow) setRightDrawer((v) => !v);
        else setRightOpen(!rightOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, leftOpen, rightOpen, setLeftOpen, setRightOpen]);

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
  const control =
    "h-8 rounded-md border border-white/[0.08] bg-ink-850 px-2 text-[12.5px] text-slate-200 transition-colors hover:border-white/[0.14] focus:border-accent-400 focus:outline-none disabled:opacity-50";
  const iconToggle =
    "flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100";

  const turnHere = sending && (turnConversation === null || turnConversation === activeId);
  const turnElsewhere = sending && !turnHere;
  const showLeft = narrow ? leftDrawer : leftOpen;
  const showRight = narrow ? rightDrawer : rightOpen;

  const sidebar = (
    <Sidebar conversations={conversations} activeId={activeId} onSelect={select} onNew={create} onDelete={remove} />
  );
  const studio = (
    <PromptStudio
      // Everything the Studio holds (candidates, drift, the traceability
      // matrix, a package and its verdicts) belongs to one conversation, and
      // a request still in flight must not land on the next one.
      key={activeId ?? "none"}
      conversationId={activeId}
      prompt={detail?.prompt ?? null}
      discovery={detail?.discovery ?? null}
      discoveryMarks={detail?.discoveryMarks ?? {}}
      stages={detail?.stages ?? null}
      versions={versions}
      candidates={detail?.candidates ?? []}
      currentV={detail?.currentV ?? 0}
      streamingPrompt={turnHere ? streamingPrompt : ""}
      provider={provider}
      model={model}
      advanced={advanced}
      ledger={ledger}
      preservation={preservation}
      proposals={proposals}
      targets={targets}
      target={target}
      verifications={detail?.verifications ?? []}
      tab={studioTab}
      onTabChange={setStudioTab}
      maximized={studioMax && !narrow}
      onToggleMaximize={() => setStudioMax(!studioMax)}
      onClose={() => (narrow ? setRightDrawer(false) : setRightOpen(false))}
      onSaveEdit={saveEdit}
      onRestore={restore}
      onPin={pin}
      onUnpin={unpin}
      onArtifactsChanged={refreshArtifacts}
      onReopenDiscovery={() => void updateSettings({ discovery: "reopen" })}
    />
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-ink-950/80 px-2 backdrop-blur">
        <button
          onClick={() => (narrow ? setLeftDrawer(!leftDrawer) : setLeftOpen(!leftOpen))}
          title={showLeft ? "Hide conversations (Ctrl+B)" : "Show conversations (Ctrl+B)"}
          aria-label={showLeft ? "Hide conversations" : "Show conversations"}
          data-testid="toggle-left"
          className={iconToggle}
        >
          {showLeft ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <div className="flex items-center gap-2 pr-2">
          <svg aria-hidden viewBox="0 0 32 32" className="h-6 w-6">
            <rect width="32" height="32" rx="7" fill="#1c2128" />
            <path d="M10 8h13v3.2h-9.4v3.6h8v3.2h-8V24H10z" fill="#e4e7ec" />
            <circle cx="23.5" cy="22.5" r="2.5" fill="#f5a55b" />
          </svg>
          <span className="text-[13px] font-semibold tracking-[0.08em] text-slate-100">FORGE</span>
        </div>
        <div className="hidden min-w-0 overflow-hidden border-l border-white/[0.06] pl-2 lg:block">
          <PipelineRail
            input={{
              discovery: detail?.discovery ?? null,
              versions: versions.length,
              pinned: ledger.length,
              verifications: detail?.verifications ?? [],
              busy: turnHere,
            }}
            onOpen={openStudio}
          />
        </div>
        <div className="flex-1" />
        <div className="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
        <label className="flex shrink-0 items-center gap-1.5">
          <span className="hidden text-[11.5px] text-slate-500 lg:inline">Target</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              if (activeId) void updateSettings({ target: e.target.value });
            }}
            aria-label="Target agent"
            className={`${control} max-w-40`}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex shrink-0 items-center gap-1.5">
          <span className="hidden text-[11.5px] text-slate-500 lg:inline">Model</span>
          {customModel ? (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => persistSelection(provider, model, true)}
              placeholder="Custom model ID"
              aria-label="Custom model ID"
              spellCheck={false}
              autoFocus
              className={`${control} w-48 border-accent-400/60 font-mono`}
            />
          ) : (
            <select
              value={models.some((m) => m.provider === provider && m.id === model) ? selectedValue : ""}
              aria-label="Model"
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
              className={`${control} max-w-40 sm:max-w-56`}
            >
              {models.length === 0 ? <option value="">{catalogReady ? "No models available" : "Loading models…"}</option> : null}
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
        </label>
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
            className={`${control} text-slate-400`}
          >
            List
          </button>
        ) : null}
        <label
          className="flex shrink-0 items-center gap-1.5"
          title={
            reasoning?.supported
              ? `Reasoning effort — ${reasoning.source === "discovered" ? "support reported by the provider" : "support documented for this model"}.` +
                (reasoning.defaultLevel
                  ? ` This model reasons without a limit when nothing is sent, so Default sends ${reasoning.defaultLevel}.`
                  : "")
              : reasoning
                ? `Not supported: ${reasoning.reason ?? "this model accepts no reasoning setting."}`
                : "Checking whether this model accepts a reasoning setting…"
          }
        >
          <span className="hidden text-[11.5px] text-slate-500 lg:inline">Effort</span>
          <select
            value={reasoning?.supported ? effort : "default"}
            disabled={!reasoning?.supported}
            aria-label="Reasoning effort"
            data-testid="reasoning-effort"
            onChange={(e) => void updateSettings({ reasoningEffort: e.target.value as ReasoningEffortWire })}
            className={`${control} w-[112px]`}
          >
            <option value="default">
              {!reasoning
                ? "Checking…"
                : !reasoning.supported
                  ? "Not supported"
                  : reasoning.defaultLevel
                    ? `Default (${reasoning.defaultLevel[0]!.toUpperCase() + reasoning.defaultLevel.slice(1)})`
                    : "Default"}
            </option>
            {(reasoning?.levels ?? []).map((level) => (
              <option key={level} value={level}>
                {level[0]!.toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        </label>
        </div>
        <div className="mx-1 hidden h-5 w-px bg-white/[0.08] sm:block" />
        <button
          onClick={() => {
            setSettingsTab("providers");
            setSettingsOpen(true);
          }}
          title="Providers and models"
          aria-label="Settings"
          className={iconToggle}
        >
          <SettingsIcon size={16} />
        </button>
        <button
          onClick={() => setAdvanced((v) => !v)}
          title="Advanced: show structure inspection in the Studio"
          aria-label="Advanced"
          aria-pressed={advanced}
          className={`${iconToggle} ${advanced ? "bg-accent-500/15 text-accent-300" : ""}`}
        >
          <FlaskConical size={16} />
        </button>
        <span
          role="status"
          title={!catalogReady ? "Loading providers…" : providerAvailable ? "A model provider is connected" : "No provider configured"}
          className={`mx-1 h-2 w-2 shrink-0 rounded-full ${!catalogReady ? "bg-slate-600" : providerAvailable ? "bg-emerald-400" : "bg-rose-400"}`}
        />
        <button
          onClick={() => (narrow ? setRightDrawer(!rightDrawer) : setRightOpen(!rightOpen))}
          title={showRight ? "Hide the Studio (Ctrl+.)" : "Show the Studio (Ctrl+.)"}
          aria-label={showRight ? "Hide the Studio" : "Show the Studio"}
          data-testid="toggle-right"
          className={iconToggle}
        >
          {showRight ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </header>

      {error ? (
        <div role="alert" className="flex items-start gap-2 border-b border-rose-900/50 bg-rose-950/40 px-4 py-2 text-[13px] text-rose-100">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-300" />
          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</div>
          <button onClick={() => setError(null)} className="text-rose-300/80 hover:text-rose-100">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {catalogReady && !providerAvailable && !activeId ? (
          <div className="workbench flex flex-1 items-center justify-center p-4">
            <div className="max-w-md rounded-xl border border-white/[0.08] bg-ink-900/90 p-8 text-center">
              <div className="text-[15px] font-semibold text-slate-100">Connect a model to start</div>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
                FORGE needs a model to talk with. Connect Anthropic, OpenAI, Google, xAI, OpenCode Go,
                OpenRouter — or any OpenAI-compatible endpoint — then pick a model.
              </p>
              <button
                onClick={() => {
                  setSettingsTab("providers");
                  setSettingsOpen(true);
                }}
                className="mt-4 rounded-lg bg-accent-500 px-5 py-2 text-[13.5px] font-medium text-white hover:bg-accent-600"
              >
                Connect a provider
              </button>
            </div>
          </div>
        ) : (
          <>
            {narrow ? (
              leftDrawer ? (
                <>
                  <div className="absolute inset-0 z-30 bg-black/50" onClick={() => setLeftDrawer(false)} aria-hidden />
                  <div className="absolute inset-y-0 left-0 z-40 w-[min(300px,85vw)] animate-fade-in shadow-2xl">{sidebar}</div>
                </>
              ) : null
            ) : leftOpen && !studioMax ? (
              <>
                <div style={{ width: leftWidth }} className="shrink-0">
                  {sidebar}
                </div>
                <Resizer
                  label="Resize conversations"
                  side="left"
                  width={leftWidth}
                  min={LEFT.min}
                  max={LEFT.max}
                  defaultWidth={LEFT.initial}
                  onResize={setLeftWidth}
                />
              </>
            ) : null}

            {!(studioMax && showRight && !narrow) ? (
              <ChatPanel
                messages={detail?.messages ?? []}
                attachments={detail?.attachments ?? []}
                sending={turnHere}
                // One turn at a time: while another conversation's turn runs,
                // this composer waits rather than starting a second one.
                ready={catalogReady && !creating && !turnElsewhere && Boolean(provider) && Boolean(model.trim())}
                waitingOn={turnElsewhere ? (conversations.find((c) => c.id === turnConversation)?.title ?? "another conversation") : null}
                providerAvailable={providerAvailable || !catalogReady}
                streamingReply={turnHere ? streamingReply : ""}
                pendingUserMessage={turnHere ? pendingUserMessage : null}
                stageLabel={turnHere ? stageLabel : null}
                startedAt={turnHere ? startedAt : null}
                returnedDraft={returnedDraft}
                diagnostics={diagnostics}
                onSend={send}
                discovery={detail?.discovery ?? null}
                hasPrompt={Boolean(detail?.prompt)}
                unresolvedCount={detail?.discoveryUnresolved?.length ?? 0}
                artifactKind={artifactKind}
                outputShape={outputShape}
                onSettings={(patch) => void updateSettings(patch)}
                onGenerate={generate}
                onCloseDiscovery={() => void updateSettings({ discovery: "close" })}
                onAttach={attach}
                onStop={stop}
                onRetry={retry}
                canRetry={canRetry && !sending && (detail?.messages.length ?? 0) > 0}
              />
            ) : null}

            {narrow ? (
              rightDrawer ? (
                <>
                  <div className="absolute inset-0 z-30 bg-black/50" onClick={() => setRightDrawer(false)} aria-hidden />
                  <div className="absolute inset-y-0 right-0 z-40 w-[min(560px,96vw)] animate-fade-in shadow-2xl">{studio}</div>
                </>
              ) : null
            ) : rightOpen ? (
              <>
                {!studioMax ? (
                  <Resizer
                    label="Resize the Studio"
                    side="right"
                    width={rightWidth}
                    min={RIGHT.min}
                    max={RIGHT.max}
                    defaultWidth={RIGHT.initial}
                    onResize={setRightWidth}
                  />
                ) : null}
                <div style={studioMax ? undefined : { width: rightWidth }} className={studioMax ? "min-w-0 flex-1" : "shrink-0"}>
                  {studio}
                </div>
              </>
            ) : null}
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

const ACTIVE_KEY = "forge.activeConversation";

function rememberConversation(id: string): void {
  try {
    window.history.replaceState(null, "", `#c=${encodeURIComponent(id)}`);
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // A private window or blocked storage: the conversation still opens, it
    // just is not reopened after a reload.
  }
}

function forgetConversation(): void {
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // As above.
  }
}

function rememberedConversation(): string | null {
  try {
    const fromHash = /(?:^#|&)c=([^&]+)/.exec(window.location.hash)?.[1];
    return fromHash ? decodeURIComponent(fromHash) : window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
