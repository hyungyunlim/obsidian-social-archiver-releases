/**
 * The user's provider keys, read from Obsidian's SecretStorage (1.11.4+) by
 * the secret name kept in settings. Device-local and never synced; a key
 * never touches data.json, logs or any payload. Storage only: settings writes
 * belong to ByokService.
 */
import type { App } from 'obsidian';
import { keyFingerprint, type ByokProviderId } from '../../vendor/byok-ai-core';
import type { SocialArchiverSettings } from '../../types/settings';
import { defaultByokSecretName } from '../../types/byok-settings';

/** The SecretStorage surface used here (feature-detected: older apps lack it). */
interface SecretStore {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
  listSecrets?(): string[];
}

export class ByokKeyStore {
  constructor(
    private readonly app: App,
    private readonly settings: () => SocialArchiverSettings,
  ) {}

  isSupported(): boolean {
    return this.store() !== null;
  }

  secretName(provider: ByokProviderId): string {
    return this.settings().byok.providers[provider].secretName;
  }

  getKey(provider: ByokProviderId): string | null {
    const name = this.secretName(provider);
    const store = this.store();
    if (!name || !store) return null;
    try {
      return store.getSecret(name)?.trim() || null;
    } catch {
      return null;
    }
  }

  hasKey(provider: ByokProviderId): boolean {
    return this.getKey(provider) !== null;
  }

  /** `…abcd`, or null with no key. */
  fingerprint(provider: ByokProviderId): string | null {
    const key = this.getKey(provider);
    return key ? keyFingerprint(key) : null;
  }

  /**
   * Store a pasted key under our own default secret and return its name; the
   * user never picks an id. Never written into a secret linked from elsewhere:
   * that one may be shared with other plugins. Null without SecretStorage or
   * with an empty key.
   */
  save(provider: ByokProviderId, key: string): string | null {
    const store = this.store();
    const value = key.trim();
    if (!store || !value) return null;
    const name = defaultByokSecretName(provider);
    store.setSecret(name, value);
    return name;
  }

  /** Ids of the secrets saved in Obsidian, for "use a key already saved"; [] when unavailable. */
  savedSecretNames(): string[] {
    try {
      return this.store()?.listSecrets?.() ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Remove the key. SecretStorage has no delete, so our own default secret
   * is overwritten with ''. Any other secret may be shared with other
   * plugins: it stays, and the caller only drops the reference.
   * Returns whether the secret itself was wiped.
   */
  clear(provider: ByokProviderId): boolean {
    const name = this.secretName(provider);
    const store = this.store();
    if (!store || name !== defaultByokSecretName(provider)) return false;
    store.setSecret(name, '');
    return true;
  }

  private store(): SecretStore | null {
    const candidate = (this.app as unknown as { secretStorage?: Partial<SecretStore> }).secretStorage;
    return candidate && typeof candidate.getSecret === 'function' && typeof candidate.setSecret === 'function'
      ? (candidate as SecretStore)
      : null;
  }
}
