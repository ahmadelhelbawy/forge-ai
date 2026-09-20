/**
 * Which model the workspace has selected (client- and server-safe, pure).
 *
 * One rule, applied at every moment the selection could go stale — first
 * load, switching conversation, and after Settings changes a provider — so the
 * header can never show a model the catalog does not offer, and a request can
 * never be sent with one.
 *
 * In priority order:
 *
 * 1. The current selection, when it is still in the catalog — or when it is a
 *    typed custom id and its provider is still available.
 * 2. The stored selection, on the same terms.
 * 3. The saved default of the provider that was selected (current, else
 *    stored). This is the "switch to that provider's saved default" rule: a
 *    stale id under OpenRouter becomes OpenRouter's saved model, not some
 *    other provider's first entry.
 * 4. The first catalog model.
 *
 * A stored id that is NOT marked custom and is no longer offered is treated as
 * stale, never resurrected as custom: that is precisely how a removed preset
 * would otherwise come back.
 */

export interface CatalogModel {
  /** The API model id — what is sent on the wire. */
  readonly id: string;
  /** What the user reads. Never sent. */
  readonly displayName: string;
  readonly provider: string;
  readonly providerDisplayName: string;
}

export interface ProviderDefault {
  readonly id: string;
  readonly defaultModel: string;
}

export interface SelectionRef {
  readonly provider: string;
  readonly model: string;
  readonly custom?: boolean;
}

export interface Selection {
  readonly provider: string;
  readonly model: string;
  readonly custom: boolean;
}

export function inCatalog(models: readonly CatalogModel[], provider: string, model: string): boolean {
  return models.some((m) => m.provider === provider && m.id === model);
}

function providerOffered(models: readonly CatalogModel[], provider: string): boolean {
  return models.some((m) => m.provider === provider);
}

function keep(models: readonly CatalogModel[], ref: SelectionRef | null | undefined): Selection | null {
  if (!ref || !ref.provider || !ref.model) return null;
  if (inCatalog(models, ref.provider, ref.model)) return { provider: ref.provider, model: ref.model, custom: false };
  if (ref.custom && providerOffered(models, ref.provider)) return { provider: ref.provider, model: ref.model, custom: true };
  return null;
}

export function resolveSelection(input: {
  readonly models: readonly CatalogModel[];
  readonly providers: readonly ProviderDefault[];
  readonly current?: SelectionRef | null;
  readonly stored?: SelectionRef | null;
}): Selection | null {
  const { models, providers, current, stored } = input;
  if (models.length === 0) return null;

  const kept = keep(models, current) ?? keep(models, stored);
  if (kept) return kept;

  const provider = current?.provider || stored?.provider;
  if (provider && providerOffered(models, provider)) {
    const saved = providers.find((p) => p.id === provider)?.defaultModel;
    if (saved && inCatalog(models, provider, saved)) return { provider, model: saved, custom: false };
    const first = models.find((m) => m.provider === provider) as CatalogModel;
    return { provider, model: first.id, custom: false };
  }

  const first = models[0] as CatalogModel;
  return { provider: first.provider, model: first.id, custom: false };
}
