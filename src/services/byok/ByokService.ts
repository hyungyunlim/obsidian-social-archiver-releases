/**
 * BYOK hub for the plugin: the byok-ai-core engine wired to Obsidian (keys
 * from SecretStorage, requestUrl/window.fetch, device-local cache), the
 * per-device consent gate, key validation state, the one-time notice and
 * persisted replacement when a model is retired, and the provider list an
 * executor advertises. Modals and generators run everything through `run`.
 *
 * Settings are read through a getter on every call: saveSettingsPartial
 * swaps the settings object, so holding one would go stale.
 */
import {
  BYOK_EXECUTOR_COMMENT_TYPES,
  BYOK_PROVIDERS,
  BYOK_PROVIDER_IDS,
  ByokError,
  capabilityModelOptions,
  createByokEngine,
  modelLifecycle,
  toStoredProviderId,
  type ByokClient,
  type ByokEngine,
  type ByokErrorCode,
  type ByokKeyValueStore,
  type ByokModelInfo,
  type ByokProviderId,
  type ByokRunResult,
  type ByokTask,
  type ByokTransport,
} from '../../vendor/byok-ai-core';
import type { SocialArchiverSettings } from '../../types/settings';
import type { ByokProviderSettings, ByokSettings } from '../../types/byok-settings';
import type { AICommentProviderCapability } from '../WorkersAPIClient';
import type { ByokKeyStore } from './ByokKeyStore';
import { t } from '../../i18n';

const CONSENT_KEY = 'byok.consent.v1';
const VALIDATION_KEY = 'byok.validation.v1';
const NOTICES_KEY = 'byok.notices.v1';

export interface ByokValidationState {
  ok: boolean;
  /** Why the last check or run failed. */
  code?: ByokErrorCode;
  /** Epoch ms. */
  at: number;
  /** OpenRouter: the key is on the free tier. */
  freeTier?: boolean;
}

export interface ByokServiceDeps {
  settings: () => SocialArchiverSettings;
  /** Persists a settings patch (data.json). */
  saveSettings: (partial: Partial<SocialArchiverSettings>) => Promise<void>;
  keyStore: ByokKeyStore;
  /** Device-local, unsynced (catalog and model caches, consent, validation, notices). */
  store: ByokKeyValueStore;
  transport: ByokTransport;
  fetchRemoteCatalog?: () => Promise<unknown>;
  /** The consent sheet. Resolves true when the user accepts. */
  requestConsent: (provider: ByokProviderId) => Promise<boolean>;
  notify: (message: string) => void;
  /** Something an executor advertises changed outside settings (consent, validation, key cleared). */
  onChange?: () => void;
  now?: () => number;
}

export type ByokModelLifecycle = ReturnType<typeof modelLifecycle>;
export type ByokModelResolution = Awaited<ReturnType<ByokEngine['resolve']>>;

export class ByokService {
  readonly engine: ByokEngine;
  private readonly consentInFlight = new Map<ByokProviderId, Promise<boolean>>();

  constructor(private readonly deps: ByokServiceDeps) {
    this.engine = createByokEngine({
      getKey: (provider) => Promise.resolve(deps.keyStore.getKey(provider)),
      transport: deps.transport,
      store: deps.store,
      ...(deps.fetchRemoteCatalog ? { fetchRemoteCatalog: deps.fetchRemoteCatalog } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
  }

  /** False before Obsidian 1.11.4 (no SecretStorage): BYOK is unavailable. */
  isSupported(): boolean {
    return this.deps.keyStore.isSupported();
  }

  providerSettings(provider: ByokProviderId): ByokProviderSettings {
    return this.deps.settings().byok.providers[provider];
  }

  isEnabled(provider: ByokProviderId): boolean {
    return this.providerSettings(provider).enabled;
  }

  hasKey(provider: ByokProviderId): boolean {
    return this.deps.keyStore.hasKey(provider);
  }

  fingerprint(provider: ByokProviderId): string | null {
    return this.deps.keyStore.fingerprint(provider);
  }

  /** Enabled and holding a key on this device, in provider order. Synchronous: safe for menus. */
  readyProviders(): ByokProviderId[] {
    if (!this.isSupported()) return [];
    return BYOK_PROVIDER_IDS.filter((provider) => this.isEnabled(provider) && this.hasKey(provider));
  }

  // ── Settings ──────────────────────────────────────────────────────────

  async updateProvider(provider: ByokProviderId, patch: Partial<ByokProviderSettings>): Promise<void> {
    const current = this.deps.settings().byok;
    const next: ByokProviderSettings = { ...current.providers[provider], ...patch };
    if (!next.model) delete next.model;
    const byok: ByokSettings = { ...current, providers: { ...current.providers, [provider]: next } };
    await this.deps.saveSettings({ byok });
  }

  /** Turning a provider on asks for consent first; returns whether it is on. */
  async setEnabled(provider: ByokProviderId, enabled: boolean): Promise<boolean> {
    if (enabled && !(await this.ensureConsent(provider, { interactive: true }))) return false;
    await this.updateProvider(provider, { enabled });
    return enabled;
  }

  async setModel(provider: ByokProviderId, model: string | undefined): Promise<void> {
    await this.updateProvider(provider, { model });
  }

  /** A different secret chosen: drop the cached model list and check the new key. */
  async setSecretName(provider: ByokProviderId, secretName: string): Promise<ByokValidationState | null> {
    await this.updateProvider(provider, { secretName });
    await this.engine.invalidate(provider);
    return this.validate(provider);
  }

  /** A pasted key: stored under our own secret, linked, and checked. Null without SecretStorage. */
  async saveKey(provider: ByokProviderId, key: string): Promise<ByokValidationState | null> {
    const secretName = this.deps.keyStore.save(provider, key);
    return secretName ? this.setSecretName(provider, secretName) : null;
  }

  /** Secret ids already saved in Obsidian (any plugin's), for linking one instead of pasting. */
  savedSecretNames(): string[] {
    return this.deps.keyStore.savedSecretNames();
  }

  /** Removes the key from this device (see ByokKeyStore.clear) and forgets its check. */
  async clearKey(provider: ByokProviderId): Promise<void> {
    if (!this.deps.keyStore.clear(provider)) await this.updateProvider(provider, { secretName: '' });
    await this.engine.invalidate(provider);
    await this.writeValidation(provider, null);
    this.deps.onChange?.();
  }

  // ── Validation ────────────────────────────────────────────────────────

  /** Checks the stored key with a free call; null when there is no key to check. */
  async validate(provider: ByokProviderId): Promise<ByokValidationState | null> {
    const key = this.deps.keyStore.getKey(provider);
    if (!key) {
      await this.writeValidation(provider, null);
      this.deps.onChange?.();
      return null;
    }
    let state: ByokValidationState;
    try {
      const result = await this.engine.validateKey(provider, key);
      state = result.ok
        ? { ok: true, at: this.now(), ...(result.freeTier !== undefined ? { freeTier: result.freeTier } : {}) }
        : { ok: false, code: result.error.code, at: this.now() };
    } catch {
      state = { ok: false, code: 'network', at: this.now() };
    }
    await this.writeValidation(provider, state);
    this.deps.onChange?.();
    return state;
  }

  async getValidation(provider: ByokProviderId): Promise<ByokValidationState | null> {
    return (await this.readMap<ByokValidationState>(VALIDATION_KEY))[provider] ?? null;
  }

  // ── Consent ───────────────────────────────────────────────────────────

  async hasConsent(provider: ByokProviderId): Promise<boolean> {
    return typeof (await this.readMap<number>(CONSENT_KEY))[provider] === 'number';
  }

  /**
   * True when the user has agreed, on this device, to send content to the
   * provider. Interactive callers show the consent sheet once; executors
   * (nobody at the screen) get false.
   */
  async ensureConsent(provider: ByokProviderId, options: { interactive: boolean }): Promise<boolean> {
    if (await this.hasConsent(provider)) return true;
    if (!options.interactive) return false;
    const pending = this.consentInFlight.get(provider);
    if (pending) return pending;
    const ask = (async (): Promise<boolean> => {
      try {
        const accepted = await this.deps.requestConsent(provider);
        if (accepted) {
          await this.writeMap(CONSENT_KEY, provider, this.now());
          this.deps.onChange?.();
        }
        return accepted;
      } finally {
        this.consentInFlight.delete(provider);
      }
    })();
    this.consentInFlight.set(provider, ask);
    return ask;
  }

  // ── Models ────────────────────────────────────────────────────────────

  listModels(provider: ByokProviderId, options: { force?: boolean } = {}): Promise<ByokModelInfo[]> {
    return this.engine.listModels(provider, options);
  }

  /** For a model picker: "retires <date> → <replacement>". */
  async modelLifecycle(provider: ByokProviderId, modelId: string): Promise<ByokModelLifecycle> {
    return modelLifecycle(await this.engine.getCatalog(), provider, modelId);
  }

  /** The model a run of `task` would use now (the user's model unless it is gone). */
  resolveModel(provider: ByokProviderId, task: ByokTask): Promise<ByokModelResolution> {
    return this.engine.resolve(provider, task, this.providerSettings(provider).model);
  }

  /**
   * The name of the model a run of `task` would use now, when the provider
   * says it cannot search the web; null when it can or the provider does not
   * say (the request then just tries). Throws only when no model list can be read.
   */
  async modelWithoutWebSearch(provider: ByokProviderId, task: ByokTask): Promise<string | null> {
    const resolution = await this.resolveModel(provider, task);
    if (!('model' in resolution)) return null;
    const info = (await this.listModels(provider)).find((model) => model.id === resolution.model);
    return info?.webSearch === false ? info.label ?? info.id : null;
  }

  // ── Runs ──────────────────────────────────────────────────────────────

  /**
   * One BYOK run: consent gate, model resolution with the user's model as
   * the preference, one retry when the model turns out to be gone. A
   * replaced model is persisted as the user's choice and announced once.
   * Throws ByokError; a declined consent is `cancelled`, an executor without
   * consent `invalid_key` (set it up on this device first).
   */
  async run<T>(input: {
    provider: ByokProviderId;
    task: ByokTask;
    /** False for executor jobs: never prompt. Defaults to true. */
    interactive?: boolean;
    /** A model the requester picked (executor job); defaults to the user's model in settings. */
    preferred?: string;
    run: (client: ByokClient, model: string) => Promise<T>;
  }): Promise<ByokRunResult<T>> {
    const { provider, task } = input;
    const label = BYOK_PROVIDERS[provider].label;
    const interactive = input.interactive !== false;
    if (!(await this.ensureConsent(provider, { interactive }))) {
      throw interactive
        ? new ByokError('cancelled', `${label} was not allowed on this device.`, { provider })
        : new ByokError('invalid_key', `${label} is not allowed on this device yet: open Social Archiver settings there.`, { provider });
    }
    const userModel = this.providerSettings(provider).model;
    const preferred = input.preferred || userModel;
    let result: ByokRunResult<T>;
    try {
      result = await this.engine.run({ provider, task, preferred, run: input.run });
    } catch (error) {
      // Only a provider's answer proves a key bad (no status = no key stored).
      if (error instanceof ByokError && error.code === 'invalid_key' && error.status !== undefined) {
        await this.writeValidation(provider, { ok: false, code: 'invalid_key', at: this.now() });
        this.deps.onChange?.();
      }
      throw error;
    }
    // An answer proves the key works (it may have been fixed outside the app).
    if ((await this.getValidation(provider))?.ok !== true) {
      await this.writeValidation(provider, { ok: true, at: this.now() });
      this.deps.onChange?.();
    }
    // Only the user's own model is replaced in settings and announced: a
    // catalog pick that moved on (research, deep research) or a model a job
    // asked for stays silent and must not become their model for every task.
    const from = result.replaced?.from ?? result.recoveredFrom;
    if (from && from === userModel && from !== result.model) await this.adoptReplacement(provider, from, result.model);
    return result;
  }

  // ── Executor capability ───────────────────────────────────────────────

  /**
   * Providers this executor can run jobs on: enabled with a key on this
   * device. Available only after consent here; never the key or its
   * fingerprint.
   */
  async buildProviderCapabilities(): Promise<AICommentProviderCapability[]> {
    const ready = this.readyProviders();
    if (ready.length === 0) return [];
    const catalog = await this.engine.getCatalog();
    return Promise.all(
      ready.map(async (provider): Promise<AICommentProviderCapability> => {
        const [consented, validation, available] = await Promise.all([
          this.hasConsent(provider),
          this.getValidation(provider),
          this.engine.listModels(provider).catch((): ByokModelInfo[] => []),
        ]);
        const options = capabilityModelOptions({
          provider,
          available,
          catalog,
          preferred: this.providerSettings(provider).model,
        });
        return {
          id: toStoredProviderId(provider),
          available: consented,
          authenticated: validation?.code !== 'invalid_key',
          ...(options.models.length > 0 ? { models: options.models } : {}),
          ...(options.defaultModel ? { defaultModel: options.defaultModel } : {}),
          supportedTypes: [...BYOK_EXECUTOR_COMMENT_TYPES],
        };
      }),
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async adoptReplacement(provider: ByokProviderId, from: string, to: string): Promise<void> {
    if (this.providerSettings(provider).model !== to) {
      try {
        await this.updateProvider(provider, { model: to });
      } catch (error) {
        console.warn('[Social Archiver] Could not save the replacement model', error);
      }
    }
    const noticeKey = `${provider}:${from}`;
    if (typeof (await this.readMap<number>(NOTICES_KEY))[noticeKey] === 'number') return;
    await this.writeMap(NOTICES_KEY, noticeKey, this.now());
    this.deps.notify(t('byok.modelReplaced', { old: from, provider: BYOK_PROVIDERS[provider].label, new: to }));
  }

  private writeValidation(provider: ByokProviderId, state: ByokValidationState | null): Promise<void> {
    return this.writeMap(VALIDATION_KEY, provider, state);
  }

  private async readMap<T>(key: string): Promise<Record<string, T>> {
    try {
      const raw = await this.deps.store.get(key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, T>) : {};
    } catch {
      return {};
    }
  }

  private async writeMap<T>(key: string, field: string, value: T | null): Promise<void> {
    const map = await this.readMap<T>(key);
    if (value === null) delete map[field];
    else map[field] = value;
    try {
      await this.deps.store.set(key, JSON.stringify(map));
    } catch {
      // A full or unavailable store costs a repeat prompt or check, never the run.
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

let current: ByokService | null = null;

/** ponytail: one plugin instance per Obsidian window, so one module-level service. */
export function setByokService(service: ByokService | null): void {
  current = service;
}

export function getByokService(): ByokService | null {
  return current;
}
