import { describe, expect, it } from 'vitest';
import { __createMockApp, type App } from 'obsidian';
import { ByokKeyStore } from '../../../services/byok/ByokKeyStore';
import { DEFAULT_SETTINGS, type SocialArchiverSettings } from '../../../types/settings';
import { normalizeByokSettings } from '../../../types/byok-settings';

// Built at runtime: the public mirror's secret scan rejects any key-shaped literal (sk-…).
const FAKE_KEY = ['sk', 'test-1234567890abcdef'].join('-');

function setup(secretName?: string) {
  const app = __createMockApp();
  const byok = normalizeByokSettings({ providers: secretName === undefined ? {} : { openai: { secretName } } });
  const settings = { ...DEFAULT_SETTINGS, byok } as SocialArchiverSettings;
  const store = new ByokKeyStore(app as unknown as App, () => settings);
  return { app, store, settings };
}

describe('ByokKeyStore', () => {
  it('reads the key by the secret name in settings, trimmed', () => {
    const { app, store } = setup();
    expect(store.getKey('openai')).toBeNull();
    app.secretStorage.setSecret('social-archiver-openai', `  ${FAKE_KEY}\n`);
    expect(store.getKey('openai')).toBe(FAKE_KEY);
    expect(store.hasKey('openai')).toBe(true);
    expect(store.fingerprint('openai')).toBe('…cdef');
  });

  it('treats an empty secret or no chosen secret as no key', () => {
    const { app, store } = setup('');
    app.secretStorage.setSecret('social-archiver-openai', FAKE_KEY);
    expect(store.getKey('openai')).toBeNull();

    const other = setup();
    other.app.secretStorage.setSecret('social-archiver-openai', '');
    expect(other.store.hasKey('openai')).toBe(false);
    expect(other.store.fingerprint('openai')).toBeNull();
  });

  it('is unsupported without SecretStorage (Obsidian before 1.11.4)', () => {
    const settings = { ...DEFAULT_SETTINGS } as SocialArchiverSettings;
    const store = new ByokKeyStore({} as App, () => settings);
    expect(store.isSupported()).toBe(false);
    expect(store.getKey('anthropic')).toBeNull();
    expect(store.clear('anthropic')).toBe(false);
  });

  it('wipes only its own default secret; a shared one stays for the caller to unlink', () => {
    const own = setup();
    own.app.secretStorage.setSecret('social-archiver-openai', FAKE_KEY);
    expect(own.store.clear('openai')).toBe(true);
    expect(own.app.secretStorage.getSecret('social-archiver-openai')).toBe('');

    const shared = setup('my-openai-key');
    shared.app.secretStorage.setSecret('my-openai-key', FAKE_KEY);
    expect(shared.store.clear('openai')).toBe(false);
    expect(shared.app.secretStorage.getSecret('my-openai-key')).toBe(FAKE_KEY);
  });

  it('saves a pasted key, trimmed, under its own secret and never into a linked one', () => {
    const { app, store } = setup('my-openai-key');
    app.secretStorage.setSecret('my-openai-key', ['sk', 'test-shared-0000000000'].join('-'));
    expect(store.save('openai', `  ${FAKE_KEY}\n`)).toBe('social-archiver-openai');
    expect(app.secretStorage.getSecret('social-archiver-openai')).toBe(FAKE_KEY);
    expect(app.secretStorage.getSecret('my-openai-key')).toBe(['sk', 'test-shared-0000000000'].join('-'));
    expect(store.save('openai', '   ')).toBeNull();
  });

  it('lists saved secret ids; without secret storage it saves and lists nothing', () => {
    const { app, store } = setup();
    app.secretStorage.setSecret('picked-secret', FAKE_KEY);
    expect(store.savedSecretNames()).toEqual(['picked-secret']);

    const bare = new ByokKeyStore({} as unknown as App, () => DEFAULT_SETTINGS as SocialArchiverSettings);
    expect(bare.savedSecretNames()).toEqual([]);
    expect(bare.save('openai', FAKE_KEY)).toBeNull();
  });

  it('reads settings through the getter, so a swapped settings object is seen', () => {
    const app = __createMockApp();
    let settings = { ...DEFAULT_SETTINGS } as SocialArchiverSettings;
    const store = new ByokKeyStore(app as unknown as App, () => settings);
    app.secretStorage.setSecret('picked-secret', FAKE_KEY);
    expect(store.hasKey('openai')).toBe(false);
    settings = { ...settings, byok: normalizeByokSettings({ providers: { openai: { secretName: 'picked-secret' } } }) };
    expect(store.getKey('openai')).toBe(FAKE_KEY);
  });
});
