/**
 * Model lifecycle (PRD §5.7). Providers retire models on short notice, so no
 * model id is a constant: every run resolves its model from the provider's
 * live list plus a catalog that can be replaced remotely (KV
 * `byok:model-catalog`, served by `GET /api/byok/model-catalog`), so a sunset
 * never needs a client release.
 *
 * Type imports only in this file: `scripts/byok-model-canary.mjs` runs it
 * under Node's type stripping, which cannot resolve extensionless value imports.
 */
import type { ByokModelInfo, ByokProviderId } from './providers';

const BYOK_TASKS = ['chat', 'comment', 'research', 'deepResearch'] as const;
export type ByokTask = (typeof BYOK_TASKS)[number];

export interface ByokModelCatalog {
  schemaVersion: 1;
  /** YYYY-MM-DD the ids were last checked against the providers. */
  updatedAt: string;
  providers: Record<ByokProviderId, ByokProviderModels>;
}

interface ByokProviderModels {
  /**
   * Ordered; an exact id or a trailing-`*` prefix pattern. A pattern picks the
   * highest matching id, so keep patterns tier-specific (`gpt-6-luna*`, never `gpt-6*`).
   * `deepResearch`: an exact id names an agent the provider does not list
   * (Gemini `deep-research-*`) and is used as is; listed models take a pattern.
   */
  preferences: Record<ByokTask, string[]>;
  deprecated: { id: string; retiresAt?: string; replacement?: string }[];
  /** Exact ids or patterns known to be shut down. */
  retired: string[];
}

export const MODEL_CATALOG_KV_KEY = 'byok:model-catalog';
/** Clients fetch the remote catalog, and each provider's live model list, at most once a day. */
export const MODEL_CATALOG_TTL_MS = 86_400_000;
export const MODEL_LIST_TTL_MS = 86_400_000;

/**
 * Compiled-in fallback. Checked 2026-11-04 against
 * developers.openai.com/api/docs/models/all + /deprecations,
 * platform.claude.com/docs (models overview, model-deprecations),
 * aistudio.google.com/docs/models + /deep-research and
 * openrouter.ai/api/v1/models. Replacements are the providers' own, except
 * gpt-5-mini/nano → gpt-6-luna (the official ones cost several times more).
 */
export const BUNDLED_MODEL_CATALOG: ByokModelCatalog = {
  schemaVersion: 1,
  updatedAt: '2026-11-04',
  providers: {
    openai: {
      preferences: {
        comment: ['gpt-6-luna*', 'gpt-5.6-luna*', 'gpt-5.4-mini*'],
        chat: ['gpt-6-luna*', 'gpt-5.6-luna*', 'gpt-5.4-mini*'],
        research: ['gpt-6.1-terra*', 'gpt-6.1-sol*', 'gpt-6-sol*', 'gpt-5.6-terra*', 'gpt-6-luna*'],
        // No deep-research model since 2026-07-23: a strong web-search model in background mode.
        deepResearch: ['gpt-6.1-sol*', 'gpt-6-sol*', 'gpt-5.6-sol*', 'gpt-6.1-terra*'],
      },
      deprecated: [
        // Not OpenAI's gpt-5.6-terra / gpt-5.6-luna (6–8x / 3–4x the price): the current cheap tier (README).
        { id: 'gpt-5-mini*', retiresAt: '2026-12-11', replacement: 'gpt-6-luna' },
        { id: 'gpt-5-nano*', retiresAt: '2026-12-11', replacement: 'gpt-6-luna' },
        { id: 'gpt-5-pro*', retiresAt: '2026-12-11', replacement: 'gpt-5.6-sol' },
        { id: 'gpt-5', retiresAt: '2026-12-11', replacement: 'gpt-5.6-sol' },
        { id: 'gpt-5-2025-08-07', retiresAt: '2026-12-11', replacement: 'gpt-5.6-sol' },
        { id: 'o3*', retiresAt: '2026-12-11', replacement: 'gpt-5.6-sol' },
        { id: 'gpt-4o*', retiresAt: '2027-01-14', replacement: 'gpt-6-luna' },
        { id: 'gpt-4.1*', retiresAt: '2027-01-14', replacement: 'gpt-6-luna' },
        { id: 'gpt-5.1', retiresAt: '2027-04-01', replacement: 'gpt-6-sol' },
        { id: 'gpt-5.1-2025-11-13', retiresAt: '2027-04-01', replacement: 'gpt-6-sol' },
        { id: 'gpt-5.3-codex*', retiresAt: '2027-04-01', replacement: 'gpt-6-sol' },
        { id: 'gpt-5.4-nano*', retiresAt: '2027-04-01', replacement: 'gpt-6-luna' },
      ],
      retired: [
        'o3-deep-research*',
        'o4-mini-deep-research*',
        'o4-mini*',
        'o3-mini*',
        'o1*',
        'gpt-4.1-nano*',
        'gpt-4-turbo*',
        'gpt-4o-2024-05-13',
        'gpt-4',
        'gpt-4-0613',
        'gpt-4-0314',
        'gpt-4-0125-preview',
        'gpt-3.5-turbo*',
        'gpt-4.5-preview*',
        'gpt-4o-search-preview*',
        'gpt-4o-mini-search-preview*',
        'computer-use-preview*',
        'chatgpt-4o-latest',
        'codex-mini-latest',
        'gpt-5-codex',
        'gpt-5.1-codex*',
        'gpt-5.2-codex*',
        'gpt-5-chat-latest',
        'gpt-5.1-chat-latest',
        'gpt-5.2-chat-latest',
        'gpt-5.3-chat-latest',
      ],
    },
    anthropic: {
      preferences: {
        comment: ['claude-haiku-5-5', 'claude-haiku-*'],
        chat: ['claude-haiku-5-5', 'claude-haiku-*'],
        research: ['claude-sonnet-5-5', 'claude-sonnet-*', 'claude-haiku-5-5', 'claude-haiku-*'],
        deepResearch: [],
      },
      deprecated: [{ id: 'claude-sonnet-4-5*', retiresAt: '2026-11-30', replacement: 'claude-sonnet-5-5' }],
      retired: [
        'claude-opus-4-1*',
        'claude-opus-4-20250514',
        'claude-sonnet-4-20250514',
        'claude-3-*',
        'claude-2*',
        'claude-instant-*',
      ],
    },
    gemini: {
      preferences: {
        comment: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'],
        chat: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'],
        research: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-4-argon', 'gemini-flash-latest'],
        // Interactions API agent (preview), not a generateContent model.
        deepResearch: ['deep-research-preview-04-2026'],
      },
      deprecated: [
        // Requests are rerouted from this date, not refused.
        { id: 'gemini-2.5-flash', retiresAt: '2026-12-01', replacement: 'gemini-3.5-flash-lite' },
        { id: 'gemini-2.5-pro', retiresAt: '2026-12-01', replacement: 'gemini-3.8-flash' },
      ],
      retired: ['gemini-2.0-flash*', 'gemini-3-pro-preview', 'gemini-3.1-flash-lite-preview'],
    },
    openrouter: {
      preferences: {
        comment: ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna', 'google/gemini-3.8-flash', 'anthropic/claude-haiku-*'],
        chat: ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna', 'google/gemini-3.8-flash', 'anthropic/claude-haiku-*'],
        research: ['anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-terra', 'google/gemini-3.8-flash', 'anthropic/claude-sonnet-*'],
        deepResearch: [],
      },
      deprecated: [],
      retired: ['openai/o3-deep-research*', 'openai/o4-mini-deep-research*'],
    },
  },
};

const MODEL_ID = /^[A-Za-z0-9._:/-]{1,128}\*?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ENTRIES = 50;
/** Complete by construction: the bundled catalog's type requires every provider. */
const PROVIDERS = Object.keys(BUNDLED_MODEL_CATALOG.providers) as ByokProviderId[];

/** Strict: any violation → null (the caller keeps its last good or the bundled catalog). Unknown fields are dropped. */
export function parseModelCatalog(value: unknown): ByokModelCatalog | null {
  const root = asRecord(value);
  const providersIn = asRecord(root?.providers);
  if (root?.schemaVersion !== 1 || !isDate(root.updatedAt) || !providersIn) return null;
  const providers = {} as Record<ByokProviderId, ByokProviderModels>;
  for (const provider of PROVIDERS) {
    const parsed = parseProviderModels(providersIn[provider]);
    if (!parsed) return null;
    providers[provider] = parsed;
  }
  return { schemaVersion: 1, updatedAt: root.updatedAt, providers };
}

function parseProviderModels(value: unknown): ByokProviderModels | null {
  const raw = asRecord(value);
  const preferencesIn = asRecord(raw?.preferences);
  if (!raw || !preferencesIn) return null;
  const preferences = {} as Record<ByokTask, string[]>;
  for (const task of BYOK_TASKS) {
    const list = idList(preferencesIn[task]);
    if (!list) return null;
    preferences[task] = list;
  }
  const retired = idList(raw.retired);
  if (!retired || !Array.isArray(raw.deprecated) || raw.deprecated.length > MAX_ENTRIES) return null;
  const deprecated: ByokProviderModels['deprecated'] = [];
  for (const item of raw.deprecated as unknown[]) {
    const entry = asRecord(item);
    if (!entry || !isModelId(entry.id)) return null;
    const { retiresAt, replacement } = entry;
    if (retiresAt !== undefined && !isDate(retiresAt)) return null;
    if (replacement !== undefined && !isModelId(replacement)) return null;
    deprecated.push({
      id: entry.id,
      ...(retiresAt === undefined ? {} : { retiresAt }),
      ...(replacement === undefined ? {} : { replacement }),
    });
  }
  return { preferences, deprecated, retired };
}

export function matchesModelPattern(id: string, pattern: string): boolean {
  return pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}

export interface ByokModelLifecycle {
  /** active = a catalog preference matches it; unknown = the catalog does not know it. */
  status: 'active' | 'deprecated' | 'retired' | 'unknown';
  retiresAt?: string;
  replacement?: string;
}

export function modelLifecycle(catalog: ByokModelCatalog, provider: ByokProviderId, id: string): ByokModelLifecycle {
  const models = catalog.providers[provider];
  const deprecated = models.deprecated.find((entry) => matchesModelPattern(id, entry.id));
  const notes = {
    ...(deprecated?.retiresAt ? { retiresAt: deprecated.retiresAt } : {}),
    ...(deprecated?.replacement ? { replacement: deprecated.replacement } : {}),
  };
  if (models.retired.some((pattern) => matchesModelPattern(id, pattern))) return { status: 'retired', ...notes };
  if (deprecated) return { status: 'deprecated', ...notes };
  const known = BYOK_TASKS.some((task) => models.preferences[task].some((pattern) => matchesModelPattern(id, pattern)));
  return { status: known ? 'active' : 'unknown' };
}

export type ByokModelSource = 'preferred' | 'replacement' | 'catalog' | 'first-available';

export type ByokModelResolution =
  | {
      model: string;
      source: ByokModelSource;
      /** Set when the user's model was retired or missing; the client tells the user once. */
      replaced?: { from: string; reason: 'retired' | 'missing'; retiresAt?: string };
    }
  | { error: 'no_model' };

export interface ResolveModelInput {
  provider: ByokProviderId;
  task: ByokTask;
  /** The user's chosen model (ignored for deepResearch). */
  preferred?: string | null | undefined;
  /** The provider's live list (`parseListModels`). */
  available: readonly ByokModelInfo[];
  catalog: ByokModelCatalog;
}

/**
 * PRD §5.7 resolution, for every engine and every run:
 * 1. the user's model, while listed, not retired and fit for the task (deprecated still runs);
 * 2. retired or missing → its replacement;
 * 3. the task's catalog preferences in order;
 * 4. not deepResearch: the highest listed model that fits;
 * 5. `no_model` (the client sends the user to settings).
 * Patterns and step 4 skip `-preview`/`-exp` builds and `-pro` tiers unless the pattern names them.
 */
export function resolveModel(input: ResolveModelInput): ByokModelResolution {
  const { provider, task, available, catalog } = input;
  const models = catalog.providers[provider];
  const isRetired = (id: string) => models.retired.some((pattern) => matchesModelPattern(id, pattern));
  const usable = available.filter((model) => !isRetired(model.id) && fitsTask(task, model)).map((model) => model.id);
  const pick = (pattern: string) =>
    usable.filter((id) => matchesModelPattern(id, pattern) && !hiddenVariant(id, pattern)).sort(descending)[0];

  const preferred = input.preferred || undefined;
  let replaced: { from: string; reason: 'retired' | 'missing'; retiresAt?: string } | undefined;
  if (preferred && task !== 'deepResearch') {
    const lifecycle = modelLifecycle(catalog, provider, preferred);
    const listed = available.some((model) => model.id === preferred);
    if (listed && lifecycle.status !== 'retired') {
      if (usable.includes(preferred)) return { model: preferred, source: 'preferred' };
      // Listed but unfit (no web search for research): the catalog picks, no notice.
    } else {
      replaced = {
        from: preferred,
        reason: lifecycle.status === 'retired' ? 'retired' : 'missing',
        ...(lifecycle.retiresAt ? { retiresAt: lifecycle.retiresAt } : {}),
      };
      const replacement = lifecycle.replacement ? pick(lifecycle.replacement) : undefined;
      if (replacement) return { model: replacement, source: 'replacement', replaced };
    }
  }
  const notice = replaced ? { replaced } : {};

  for (const pattern of models.preferences[task]) {
    const model = pick(pattern);
    if (model) return { model, source: 'catalog', ...notice };
  }

  if (task === 'deepResearch') {
    const agent = models.preferences.deepResearch.find((entry) => !entry.endsWith('*') && !isRetired(entry));
    return agent ? { model: agent, source: 'catalog' } : { error: 'no_model' };
  }

  const fallback = usable.filter((id) => !hiddenVariant(id, '')).sort(descending)[0];
  return fallback ? { model: fallback, source: 'first-available', ...notice } : { error: 'no_model' };
}

export interface CapabilityModelOptions {
  /** ≤ 20; the resolved defaults first. */
  models: { id: string; label: string; recommended?: boolean }[];
  defaultModel?: string;
}

/**
 * Model options an executor advertises for one BYOK provider: the resolved
 * comment, chat and research models, then catalog matches, then the rest.
 */
export function capabilityModelOptions(input: Omit<ResolveModelInput, 'task'>): CapabilityModelOptions {
  const { provider, available, catalog } = input;
  const models = catalog.providers[provider];
  const resolved = (task: ByokTask) => {
    const resolution = resolveModel({ ...input, task });
    return 'model' in resolution ? resolution.model : undefined;
  };
  const defaultModel = resolved('comment');
  const listed = available
    .map((model) => model.id)
    .filter((id) => !models.retired.some((pattern) => matchesModelPattern(id, pattern)));
  const catalogMatches = (['comment', 'chat', 'research'] as const).flatMap((task) =>
    models.preferences[task].flatMap((pattern) =>
      listed.filter((id) => matchesModelPattern(id, pattern) && !hiddenVariant(id, pattern)).sort(descending),
    ),
  );
  const labels = new Map(available.map((model) => [model.id, model.label ?? model.id]));
  const order = [defaultModel, resolved('chat'), resolved('research'), ...catalogMatches, ...[...listed].sort(descending)];
  const ids = [...new Set(order.filter((id): id is string => id !== undefined && labels.has(id)))].slice(0, 20);
  return {
    models: ids.map((id) => ({ id, label: labels.get(id) ?? id, ...(id === defaultModel ? { recommended: true } : {}) })),
    ...(defaultModel ? { defaultModel } : {}),
  };
}

function fitsTask(task: ByokTask, model: ByokModelInfo): boolean {
  return task === 'research' || task === 'deepResearch' ? model.webSearch !== false : true;
}

/** Preview/experimental builds and `-pro` tiers (several times the price) are picked only by name. */
const VARIANT_MARKERS = ['-preview', '-exp', '-pro'] as const;

function hiddenVariant(id: string, pattern: string): boolean {
  return VARIANT_MARKERS.some((marker) => id.includes(marker) && !pattern.includes(marker));
}

/**
 * Highest first, in natural order (`gpt-10` above `gpt-9`). Hand-rolled instead
 * of `localeCompare(…, { numeric: true })`: the same order for model ids, with
 * no ICU or locale behind it, so Hermes, V8 and Node pick the same model.
 */
function descending(a: string, b: string): number {
  const left = a.match(/\d+|\D+/g) ?? [];
  const right = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i] ?? '';
    const y = right[i] ?? '';
    if (x === y) continue;
    const numeric = /^\d/.test(x) && /^\d/.test(y) ? Number(y) - Number(x) : 0;
    if (numeric !== 0) return numeric;
    return x < y ? 1 : -1;
  }
  return right.length - left.length;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID.test(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value);
}

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null;
  const ids = value as unknown[];
  return ids.every(isModelId) ? [...ids] : null;
}
