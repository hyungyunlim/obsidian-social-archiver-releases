/**
 * The model lifecycle around a client (PRD §5.7): the catalog (remote, last
 * good copy, or bundled), each provider's live model list cached for 24 h,
 * resolution for every run, and one retry when a model turns out to be gone.
 * The host supplies keys, the transport and a small key-value store; keys
 * never touch the store.
 */
import type { ByokClient, ByokValidateResult } from './client';
import type { ByokModelCatalog, ByokModelResolution, ByokTask } from './models';
import type { ByokModelInfo, ByokProviderId } from './providers';
import type { ByokTransport } from './transport';
import { createByokClient } from './client';
import { ByokError, isModelGoneError } from './errors';
import {
  BUNDLED_MODEL_CATALOG,
  MODEL_CATALOG_TTL_MS,
  MODEL_LIST_TTL_MS,
  modelLifecycle,
  parseModelCatalog,
  resolveModel,
} from './models';
import { BYOK_PROVIDERS } from './providers';

/** Device-local and unsynced (plugin localStorage, Tauri store, AsyncStorage). `null` deletes. */
export interface ByokKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

export interface ByokEngineDeps {
  getKey(provider: ByokProviderId): Promise<string | null>;
  transport: ByokTransport;
  store: ByokKeyValueStore;
  /**
   * `GET /api/byok/model-catalog` JSON (the `{ success, data }` envelope or the
   * catalog itself). Keep it quick to fail: a first run with no stored catalog
   * waits for it once.
   */
  fetchRemoteCatalog?(): Promise<unknown>;
  now?(): number;
}

export interface ByokRunResult<T> {
  value: T;
  /** The model the run asked for (`ByokGenerateResult.model` is what the provider reports). */
  model: string;
  /** The user's model was retired or missing and another ran: tell the user once, persist `model`. */
  replaced?: { from: string; reason: 'retired' | 'missing'; retiresAt?: string };
  /** The first model failed as gone (`model_not_found`) and `model` ran on the single retry. */
  recoveredFrom?: string;
}

export interface ByokEngine {
  getCatalog(options?: { force?: boolean }): Promise<ByokModelCatalog>;
  /** Live list, cached 24 h; a stale copy when the provider cannot be reached; throws only with no copy at all. */
  listModels(provider: ByokProviderId, options?: { force?: boolean }): Promise<ByokModelInfo[]>;
  /** `no_model` only when a fetched list has models and none fits; with no list, the user's or the catalog's model is tried. */
  resolve(provider: ByokProviderId, task: ByokTask, preferred?: string | null): Promise<ByokModelResolution>;
  /** Throws an `invalid_key` ByokError when no key is stored. */
  client(provider: ByokProviderId): Promise<ByokClient>;
  /** Checks a key before the host stores it; on success the model list is cached. */
  validateKey(provider: ByokProviderId, candidateKey: string): Promise<ByokValidateResult>;
  /** Drops the cached model list (key changed or removed). */
  invalidate(provider: ByokProviderId): Promise<void>;
  run<T>(input: {
    provider: ByokProviderId;
    task: ByokTask;
    preferred?: string | null | undefined;
    run: (client: ByokClient, model: string) => Promise<T>;
  }): Promise<ByokRunResult<T>>;
}

const CATALOG_KEY = 'byok.catalog.v1';
const modelsKey = (provider: ByokProviderId) => `byok.models.${provider}.v1`;

export function createByokEngine(deps: ByokEngineDeps): ByokEngine {
  const now = deps.now ?? Date.now;
  const { store } = deps;
  /** ponytail: per session, not persisted — an unreachable catalog endpoint costs one attempt a day per launch. */
  let catalogAttemptAt: number | undefined;

  async function readStored<T>(key: string, field: string, parse: (value: unknown) => T | null) {
    try {
      const raw = await store.get(key);
      const entry = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      const value = entry ? parse(entry[field]) : null;
      return value !== null && typeof entry?.fetchedAt === 'number' ? { fetchedAt: entry.fetchedAt, value } : null;
    } catch {
      return null;
    }
  }

  async function write(key: string, value: string | null): Promise<void> {
    try {
      await store.set(key, value);
    } catch {
      // A full or unavailable store costs a refetch later, never the run.
    }
  }

  async function getCatalog(options: { force?: boolean } = {}): Promise<ByokModelCatalog> {
    const stored = await readStored(CATALOG_KEY, 'catalog', parseModelCatalog);
    if (!options.force && stored && now() - stored.fetchedAt < MODEL_CATALOG_TTL_MS) return newest(stored.value);
    if (deps.fetchRemoteCatalog && (options.force || catalogAttemptAt === undefined || now() - catalogAttemptAt >= MODEL_CATALOG_TTL_MS)) {
      catalogAttemptAt = now();
      try {
        const raw = await deps.fetchRemoteCatalog();
        const catalog = parseModelCatalog(raw) ?? parseModelCatalog(envelopeData(raw));
        if (catalog) {
          await write(CATALOG_KEY, JSON.stringify({ fetchedAt: now(), catalog }));
          return newest(catalog);
        }
      } catch {
        // Offline or endpoint down: the last good copy, else the bundled one.
      }
    }
    return newest(stored?.value);
  }

  async function client(provider: ByokProviderId): Promise<ByokClient> {
    const apiKey = (await deps.getKey(provider))?.trim();
    if (!apiKey) {
      throw new ByokError('invalid_key', `No ${BYOK_PROVIDERS[provider].label} API key is stored on this device.`, { provider });
    }
    return createByokClient({ provider, apiKey, transport: deps.transport });
  }

  async function listModels(provider: ByokProviderId, options: { force?: boolean } = {}): Promise<ByokModelInfo[]> {
    const stored = await readStored(modelsKey(provider), 'models', parseModelList);
    if (!options.force && stored && now() - stored.fetchedAt < MODEL_LIST_TTL_MS) return stored.value;
    try {
      const models = await (await client(provider)).listModels();
      // An empty list says more about parsing than about the provider: never cache it.
      if (models.length > 0) await write(modelsKey(provider), JSON.stringify({ fetchedAt: now(), models }));
      return models;
    } catch (error) {
      if (stored) return stored.value;
      throw error;
    }
  }

  async function resolve(provider: ByokProviderId, task: ByokTask, preferred?: string | null): Promise<ByokModelResolution> {
    const catalog = await getCatalog();
    const available = await listModels(provider).catch(() => []);
    return available.length > 0
      ? resolveModel({ provider, task, preferred, available, catalog })
      : untestedModel(catalog, provider, task, preferred || undefined);
  }

  return {
    getCatalog,
    listModels,
    resolve,
    client,

    async validateKey(provider, candidateKey) {
      const result = await createByokClient({ provider, apiKey: candidateKey, transport: deps.transport }).validateKey();
      // An empty list would make every later run `no_model`; leave the cache for the next fetch.
      if (result.ok && result.models.length > 0) {
        await write(modelsKey(provider), JSON.stringify({ fetchedAt: now(), models: result.models }));
      }
      return result;
    },

    invalidate: (provider) => write(modelsKey(provider), null),

    async run(input) {
      const { provider, task } = input;
      const preferred = input.preferred || undefined;
      const api = await client(provider);
      const first = await resolve(provider, task, preferred);
      if ('error' in first) {
        throw new ByokError(
          'model_not_found',
          `No ${BYOK_PROVIDERS[provider].label} model fits this task. Choose one in settings.`,
          { provider },
        );
      }
      try {
        const value = await input.run(api, first.model);
        return { value, model: first.model, ...(first.replaced ? { replaced: first.replaced } : {}) };
      } catch (error) {
        if (!isModelGoneError(error)) throw error;
        // §5.7 rule 3: refresh the list (bypassing the cache), re-resolve without the gone model, retry once.
        const fresh = await listModels(provider, { force: true }).catch(() => undefined);
        if (!fresh) throw error;
        const available = fresh.filter((model) => model.id !== first.model);
        const second = resolveModel({ provider, task, preferred, available, catalog: await getCatalog() });
        if ('error' in second || second.model === first.model) throw error;
        const value = await input.run(api, second.model);
        return {
          value,
          model: second.model,
          recoveredFrom: first.model,
          ...(second.replaced ? { replaced: second.replaced } : {}),
        };
      }
    },
  };
}

/**
 * No live list and no cached one (offline, or a key that may not list
 * models): run the user's model, else the catalog's first, and let a
 * model_not_found retry sort it out. A trailing-`*` pattern stands for its
 * own prefix when that is a whole id (`gpt-6-luna*` → `gpt-6-luna`, not `claude-haiku-*`).
 */
function untestedModel(
  catalog: ByokModelCatalog,
  provider: ByokProviderId,
  task: ByokTask,
  preferred: string | undefined,
): ByokModelResolution {
  const usable = (id: string) => /[A-Za-z0-9]$/.test(id) && modelLifecycle(catalog, provider, id).status !== 'retired';
  let replaced: { from: string; reason: 'retired'; retiresAt?: string } | undefined;
  if (preferred && task !== 'deepResearch') {
    const lifecycle = modelLifecycle(catalog, provider, preferred);
    if (lifecycle.status !== 'retired') return { model: preferred, source: 'preferred' };
    replaced = { from: preferred, reason: 'retired', ...(lifecycle.retiresAt ? { retiresAt: lifecycle.retiresAt } : {}) };
    const replacement = lifecycle.replacement?.replace(/\*$/, '');
    if (replacement && usable(replacement)) return { model: replacement, source: 'replacement', replaced };
  }
  for (const entry of catalog.providers[provider].preferences[task]) {
    const id = entry.replace(/\*$/, '');
    if (usable(id)) return { model: id, source: 'catalog', ...(replaced ? { replaced } : {}) };
  }
  return { error: 'no_model' };
}

/** The remote/stored catalog unless the bundled one is newer (an app update can outdate a KV copy). */
function newest(catalog: ByokModelCatalog | undefined): ByokModelCatalog {
  return catalog && catalog.updatedAt >= BUNDLED_MODEL_CATALOG.updatedAt ? catalog : BUNDLED_MODEL_CATALOG;
}

function envelopeData(value: unknown): unknown {
  return value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : undefined;
}

function parseModelList(value: unknown): ByokModelInfo[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item: unknown) => {
    const model = item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined;
    if (typeof model?.id !== 'string' || !model.id) return [];
    return [
      {
        id: model.id,
        ...(typeof model.label === 'string' ? { label: model.label } : {}),
        ...(typeof model.webSearch === 'boolean' ? { webSearch: model.webSearch } : {}),
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
      },
    ];
  });
}
