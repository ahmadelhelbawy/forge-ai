"use client";

import { Check, Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type ModelOption, type ProviderSummary } from "@/lib/api";

interface Props {
  open: boolean;
  initialTab?: "providers" | "models" | "general";
  onClose: () => void;
  onChanged: () => void;
}

const STATUS_DOT: Record<ProviderSummary["status"], string> = {
  connected: "bg-green-400",
  error: "bg-red-400",
  "not-configured": "bg-slate-500",
  disabled: "bg-slate-700",
  untested: "bg-amber-400",
};

const STATUS_LABEL: Record<ProviderSummary["status"], string> = {
  connected: "Connected",
  error: "Error",
  "not-configured": "Not configured",
  disabled: "Disabled",
  untested: "Untested",
};

export function SettingsModal({ open, initialTab, onClose, onChanged }: Props): React.JSX.Element | null {
  const [tab, setTab] = useState<"providers" | "models" | "general">(initialTab ?? "providers");
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [discovered, setDiscovered] = useState<string[] | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBase, setNewBase] = useState("");
  const [newModel, setNewModel] = useState("");

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [defaultSel, setDefaultSel] = useState("");

  const selected = providers.find((p) => p.id === selectedId) ?? null;

  const refresh = async (keepSelection = true): Promise<ProviderSummary[]> => {
    const { providers } = await api.listSettings();
    setProviders(providers);
    if (!keepSelection || !selectedId || !providers.some((p) => p.id === selectedId)) {
      setSelectedId(providers[0]?.id ?? null);
    }
    try {
      const catalog = await api.catalog();
      setModelOptions(catalog.models);
      const stored = await api.getDefaultModel();
      if (stored.defaultModel) setDefaultSel(`${stored.defaultModel.provider}|||${stored.defaultModel.model}`);
    } catch {
      // Catalog is best-effort here; the providers list is authoritative.
    }
    return providers;
  };

  useEffect(() => {
    if (!open) return;
    setTab(initialTab ?? "providers");
    setError(null);
    setLoading(true);
    refresh(false)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!selected) return;
    setDisplayName(selected.displayName);
    setEnabled(selected.enabled);
    setApiKey("");
    setBaseURL(selected.baseURL ?? "");
    setDefaultModel(selected.defaultModel);
    setHeadersText("");
    setTestResult(selected.lastTest ? { ok: selected.lastTest.ok, message: selected.lastTest.message } : null);
    setDiscovered(null);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const save = async (): Promise<boolean> => {
    if (!selected) return false;
    setSaving(true);
    setError(null);
    try {
      let headers: Record<string, string> | undefined;
      if (headersText.trim()) {
        try {
          const parsed = JSON.parse(headersText) as unknown;
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
          headers = parsed as Record<string, string>;
        } catch {
          setError("Custom headers must be a JSON object of name/value pairs.");
          setSaving(false);
          return false;
        }
      }
      const updated = await api.saveProvider(selected.id, {
        enabled,
        displayName: displayName !== selected.displayName ? displayName : undefined,
        ...(apiKey ? { apiKey } : {}),
        baseURL: selected.custom ? baseURL : baseURL !== (selected.baseURL ?? "") ? baseURL : undefined,
        defaultModel: defaultModel !== selected.defaultModel ? defaultModel : undefined,
        ...(headers !== undefined ? { headers } : {}),
      });
      setProviders((list) => list.map((p) => (p.id === updated.provider.id ? updated.provider : p)));
      setApiKey("");
      // New credentials invalidate the previous verdict. Leaving the old
      // failure on screen reads as a fresh result for the key just entered.
      setTestResult(null);
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const test = async (): Promise<void> => {
    if (!selected) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Test exactly what is on screen. The key field is only persisted by
      // Save, so a test that read stored state silently tested the PREVIOUS
      // key and reported it as this one's result.
      const result = await api.testProvider(selected.id, {
        ...(defaultModel ? { model: defaultModel } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      });
      setTestResult({ ok: result.ok, message: result.message });
      await refresh();
      onChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setTestResult({ ok: false, message });
      await refresh().catch(() => undefined);
    } finally {
      setTesting(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!selected) return;
    const label = selected.custom ? `Delete custom provider "${selected.displayName}"?` : `Reset "${selected.displayName}" to defaults (clears the saved key)?`;
    if (!window.confirm(label)) return;
    await api.deleteProvider(selected.id);
    setSelectedId(null);
    await refresh(false);
    onChanged();
  };

  const addCustom = async (): Promise<void> => {
    try {
      const created = await api.createCustomProvider({ name: newName, baseURL: newBase, model: newModel });
      setNewName("");
      setNewBase("");
      setNewModel("");
      setShowAdd(false);
      await refresh(false);
      setSelectedId(created.provider.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const discover = async (): Promise<void> => {
    if (!selected) return;
    try {
      const result = await api.providerModels(selected.id);
      setDiscovered(result.discovered);
    } catch {
      setDiscovered(null);
    }
  };

  const saveDefault = async (value: string): Promise<void> => {
    setDefaultSel(value);
    const [provider, ...rest] = value.split("|||");
    const model = rest.join("|||");
    if (!provider || !model) return;
    await api.setDefaultModel(provider, model);
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[880px] max-w-full flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
          <div className="text-[15px] font-semibold text-slate-100">Settings</div>
          <button onClick={onClose} className="rounded p-1.5 text-slate-400 hover:bg-ink-700 hover:text-slate-100" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex border-b border-ink-800 px-5">
          {(["providers", "models", "general"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-[13px] font-medium capitalize ${
                tab === t ? "border-b-2 border-accent-500 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "providers" ? "AI Providers" : t}
            </button>
          ))}
        </div>

        {error ? <div className="border-b border-red-900/60 bg-red-950/40 px-5 py-2 text-[13px] text-red-200">{error}</div> : null}

        <div className="flex min-h-0 flex-1">
          {tab === "providers" ? (
            <>
              <div className="w-64 shrink-0 overflow-y-auto border-r border-ink-800 p-2">
                {loading ? (
                  <div className="px-3 py-4 text-[13px] text-slate-500">Loading…</div>
                ) : (
                  providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                        p.id === selectedId ? "bg-ink-700" : "hover:bg-ink-850"
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[p.status]}`} title={STATUS_LABEL[p.status]} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-slate-200">{p.displayName}</span>
                        <span className="block text-[11px] text-slate-500">
                          {STATUS_LABEL[p.status]}
                          {p.source === "environment" ? " · env" : ""}
                          {p.custom ? " · custom" : ""}
                        </span>
                      </span>
                    </button>
                  ))
                )}
                <button
                  onClick={() => setShowAdd((v) => !v)}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-ink-600 px-3 py-2 text-[13px] text-slate-400 hover:border-ink-500 hover:text-slate-200"
                >
                  <Plus size={14} /> Add custom provider
                </button>
                {showAdd ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-ink-700 p-3">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className="w-full rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none" />
                    <input value={newBase} onChange={(e) => setNewBase(e.target.value)} placeholder="Base URL https://…" spellCheck={false} className="w-full rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 font-mono text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none" />
                    <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="Default model ID" spellCheck={false} className="w-full rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 font-mono text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none" />
                    <button onClick={addCustom} className="w-full rounded-md bg-accent-500 px-2 py-1.5 text-[13px] font-medium text-white hover:bg-accent-400">
                      Add provider
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="min-w-0 flex-1 overflow-y-auto p-5">
                {!selected ? (
                  <div className="text-[13px] text-slate-500">Select a provider.</div>
                ) : (
                  <div className="max-w-lg space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-100">{selected.displayName}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500">
                          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[selected.status]}`} />
                          {STATUS_LABEL[selected.status]}
                          <span>· {selected.source === "settings" ? "configured in Settings" : selected.source === "environment" ? "from environment" : "defaults"}</span>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-[13px] text-slate-300">
                        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                        Enabled
                      </label>
                    </div>

                    <label className="block">
                      <div className="mb-1 text-[12px] font-medium text-slate-400">Display name</div>
                      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-2 text-[13px] text-slate-100 focus:border-accent-500 focus:outline-none" />
                    </label>

                    <label className="block">
                      <div className="mb-1 text-[12px] font-medium text-slate-400">
                        API key {selected.maskedKey ? <span className="font-mono text-slate-500">({selected.maskedKey} saved — leave blank to keep)</span> : null}
                      </div>
                      <input
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        type="password"
                        autoComplete="off"
                        placeholder={selected.maskedKey || (selected.source === "environment" ? "key from environment" : "sk-…")}
                        spellCheck={false}
                        className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-2 font-mono text-[13px] text-slate-100 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none"
                      />
                    </label>

                    {selected.kind === "openai-compat" || selected.custom ? (
                      <label className="block">
                        <div className="mb-1 text-[12px] font-medium text-slate-400">Base URL</div>
                        <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} spellCheck={false} placeholder="https://…" className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-2 font-mono text-[13px] text-slate-100 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none" />
                      </label>
                    ) : null}

                    <label className="block">
                      <div className="mb-1 text-[12px] font-medium text-slate-400">Default model</div>
                      <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} spellCheck={false} className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-2 font-mono text-[13px] text-slate-100 focus:border-accent-500 focus:outline-none" />
                    </label>

                    <div>
                      <div className="mb-1 text-[12px] font-medium text-slate-400">
                        Custom headers (JSON, optional)
                        {selected.headers.length > 0 ? <span className="ml-1 text-slate-500">stored: {selected.headers.join(", ")}</span> : null}
                      </div>
                      <textarea
                        value={headersText}
                        onChange={(e) => setHeadersText(e.target.value)}
                        rows={2}
                        spellCheck={false}
                        placeholder='{"X-Title": "FORGE"}'
                        className="w-full resize-y rounded-md border border-ink-700 bg-ink-800 px-2.5 py-2 font-mono text-[12.5px] text-slate-100 placeholder:text-slate-600 focus:border-accent-500 focus:outline-none"
                      />
                    </div>

                    {selected.sessionHeader ? (
                      <div className="rounded-md border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-400">
                        Sends <span className="text-slate-200">{selected.sessionHeader}</span> with a random UUID per call.
                      </div>
                    ) : null}

                    {testResult ? (
                      <div className={`whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-[13px] ${testResult.ok ? "border-green-900/60 bg-green-950/30 text-green-200" : "border-red-900/60 bg-red-950/30 text-red-200"}`}>
                        {testResult.message}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={save} disabled={saving} className="rounded-md bg-accent-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-400 disabled:opacity-50">
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={test} disabled={testing} className="flex items-center gap-1.5 rounded-md border border-ink-600 px-4 py-2 text-[13px] text-slate-200 hover:border-ink-500 disabled:opacity-50">
                        {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        Test connection
                      </button>
                      <button onClick={discover} className="rounded-md border border-ink-600 px-3 py-2 text-[13px] text-slate-400 hover:text-slate-200">
                        Refresh models
                      </button>
                      <button
                        onClick={remove}
                        className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-2 text-[12.5px] text-slate-500 hover:text-red-300"
                      >
                        {selected.custom ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                        {selected.custom ? "Delete" : "Reset"}
                      </button>
                    </div>
                    {discovered !== null ? (
                      <div className="text-[12px] text-slate-500">
                        {discovered.length > 0 ? `Discovered: ${discovered.slice(0, 12).join(", ")}${discovered.length > 12 ? "…" : ""}` : "Discovery returned nothing — presets apply."}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          ) : tab === "models" ? (
            <div className="min-w-0 flex-1 overflow-y-auto p-5">
              <div className="max-w-lg space-y-4">
                <div>
                  <div className="mb-1 text-[13px] font-semibold text-slate-200">Default model</div>
                  <p className="mb-2 text-[12.5px] text-slate-500">Used for new conversations. Only models from enabled, configured providers are listed.</p>
                  <select
                    value={defaultSel}
                    onChange={(e) => saveDefault(e.target.value)}
                    className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-2 text-[13px] text-slate-100 focus:border-accent-500 focus:outline-none"
                  >
                    <option value="">No default</option>
                    {modelOptions.map((m) => (
                      <option key={`${m.provider}|||${m.id}`} value={`${m.provider}|||${m.id}`}>
                        {m.displayName} — {m.providerDisplayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-[13px] font-semibold text-slate-200">Available models</div>
                  <div className="space-y-1">
                    {modelOptions.length === 0 ? (
                      <div className="text-[12.5px] text-slate-500">No enabled providers with keys. Configure one under AI Providers.</div>
                    ) : (
                      modelOptions.map((m) => (
                        <div key={`${m.provider}|||${m.id}`} className="flex items-center justify-between rounded-md bg-ink-850 px-3 py-1.5 text-[12.5px]">
                          <span className="text-slate-200">{m.displayName}</span>
                          <span className="font-mono text-[11.5px] text-slate-500">{m.providerDisplayName} · {m.id}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1 overflow-y-auto p-5">
              <div className="max-w-lg space-y-3 text-[13px] text-slate-300">
                <div>
                  <div className="font-semibold text-slate-200">Storage</div>
                  <p className="text-slate-500">Conversations, prompt versions, and provider settings persist as JSON on this server. API keys are encrypted at rest and never sent to the browser.</p>
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Advanced</div>
                  <p className="text-slate-500">Toggle the Advanced button in the top bar to inspect prompt structure (goals, constraints, questions) and strategy candidates from the FORGE engine.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
