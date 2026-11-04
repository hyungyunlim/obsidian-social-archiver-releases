import { describe, expect, it } from 'vitest';
import { DEFAULT_BYOK_SETTINGS, normalizeByokSettings } from '../../types/byok-settings';
import { DEFAULT_SETTINGS, migrateSettings } from '../../types/settings';

describe('BYOK settings in data.json', () => {
  it('defaults every provider off with its own secret name', () => {
    expect(DEFAULT_SETTINGS.byok).toEqual(DEFAULT_BYOK_SETTINGS);
    expect(migrateSettings({}).byok.providers.gemini).toEqual({ secretName: 'social-archiver-gemini', enabled: false });
  });

  it('keeps valid names, switches and models; drops anything else', () => {
    const byok = normalizeByokSettings({
      providers: {
        openai: { secretName: 'my-openai', enabled: true, model: 'gpt-6-luna', apiKey: ['sk', 'test-1234567890abcdef'].join('-') },
        anthropic: { secretName: 'Not Valid!', enabled: 'yes', model: 'x'.repeat(200) },
        openrouter: { secretName: '' },
      },
      baseUrl: 'https://attacker.example',
    });
    expect(byok.providers.openai).toEqual({ secretName: 'my-openai', enabled: true, model: 'gpt-6-luna' });
    expect(byok.providers.anthropic).toEqual({ secretName: 'social-archiver-anthropic', enabled: false });
    expect(byok.providers.openrouter.secretName).toBe('');
    expect(JSON.stringify(byok)).not.toContain('sk-test');
    expect(byok).not.toHaveProperty('baseUrl');
  });

  it('survives garbage from an old or hand-edited data.json', () => {
    for (const value of [undefined, null, 'x', [], { providers: 'x' }]) {
      expect(migrateSettings({ byok: value as never }).byok).toEqual(DEFAULT_BYOK_SETTINGS);
    }
  });
});
