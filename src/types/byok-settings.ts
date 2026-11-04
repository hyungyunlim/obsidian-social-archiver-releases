/**
 * BYOK settings that live in data.json. Never a key: only the NAME of the
 * Obsidian secret (SecretStorage) holding it, the on/off switch and the
 * chosen model. data.json syncs across devices; each device's SecretStorage
 * keeps its own key under that name.
 */
import { BYOK_PROVIDER_IDS, type ByokProviderId } from '../vendor/byok-ai-core';

export interface ByokProviderSettings {
  /** SecretStorage id; '' = none chosen. */
  secretName: string;
  enabled: boolean;
  /** The user's model; unset = the catalog's pick per task. */
  model?: string;
}

export interface ByokSettings {
  providers: Record<ByokProviderId, ByokProviderSettings>;
}

/** SecretStorage ids: lowercase alphanumeric with optional dashes. */
const SECRET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,128}$/;

export function defaultByokSecretName(provider: ByokProviderId): string {
  return `social-archiver-${provider}`;
}

function defaultProviderSettings(provider: ByokProviderId): ByokProviderSettings {
  return { secretName: defaultByokSecretName(provider), enabled: false };
}

export const DEFAULT_BYOK_SETTINGS: ByokSettings = {
  providers: {
    openai: defaultProviderSettings('openai'),
    anthropic: defaultProviderSettings('anthropic'),
    gemini: defaultProviderSettings('gemini'),
    openrouter: defaultProviderSettings('openrouter'),
  },
};

/** Whatever data.json holds → a complete, valid ByokSettings (unknown fields dropped). */
export function normalizeByokSettings(value: unknown): ByokSettings {
  const providersIn = asRecord(asRecord(value)?.providers);
  const providers = {} as Record<ByokProviderId, ByokProviderSettings>;
  for (const provider of BYOK_PROVIDER_IDS) {
    const raw = asRecord(providersIn?.[provider]);
    const fallback = defaultProviderSettings(provider);
    const secretName = typeof raw?.secretName === 'string' && (raw.secretName === '' || SECRET_NAME.test(raw.secretName))
      ? raw.secretName
      : fallback.secretName;
    const model = typeof raw?.model === 'string' && MODEL_ID.test(raw.model) ? raw.model : undefined;
    providers[provider] = {
      secretName,
      enabled: raw?.enabled === true,
      ...(model ? { model } : {}),
    };
  }
  return { providers };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
