import { beforeEach, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
}));

import { DesktopCapabilityReporter } from '../../../plugin/ai-comment/DesktopCapabilityReporter';
import { AI_ACTION_EXECUTOR_CAPABILITIES } from '../../../services/WorkersAPIClient';
import type { ByokService } from '../../../services/byok/ByokService';
import { AICliDetector } from '../../../utils/ai-cli';
import { DEFAULT_SETTINGS } from '../../../types/settings';
import { FAKE_OPENAI_KEY, byokFixture, openaiModels, readyOpenAI } from '../../services/byok/byokTestKit';

function reporter(byok: () => ByokService | null) {
  const settings = { ...DEFAULT_SETTINGS, aiComment: { ...DEFAULT_SETTINGS.aiComment, enabled: true } };
  return new DesktopCapabilityReporter({
    apiClient: () => undefined,
    settings: () => settings,
    pluginVersion: '4.11.0',
    schedule: vi.fn(),
    clearSchedule: vi.fn(),
    byok,
  });
}

describe('DesktopCapabilityReporter with the user\'s own keys', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AICliDetector, 'detect').mockResolvedValue({
      available: false,
      authenticated: false,
      cli: null,
      path: null,
      version: null,
    });
  });

  it('is ready with only a BYOK key and advertises it next to the CLIs, without the key', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna') });
    await readyOpenAI(fixture);

    const payload = await reporter(() => fixture.service).buildCapabilityPayload();

    expect(payload?.status).toBe('ready');
    expect(payload?.enabled).toBe(true);
    expect(payload?.defaultProvider).toBe('openai-api');
    expect(payload?.supportedTypes).toContain('research');
    expect(payload?.providers.map((provider) => provider.id)).toEqual(['claude', 'gemini', 'codex', 'openai-api']);
    expect(payload?.providers.at(-1)).toMatchObject({
      id: 'openai-api',
      available: true,
      authenticated: true,
      defaultModel: 'gpt-6-luna',
    });
    expect(JSON.stringify(payload)).not.toContain(FAKE_OPENAI_KEY);
  });

  it('stays provider_missing without CLIs or keys, and survives a failing BYOK lookup', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna') });
    expect((await reporter(() => fixture.service).buildCapabilityPayload())?.status).toBe('provider_missing');

    vi.spyOn(fixture.service, 'buildProviderCapabilities').mockRejectedValue(new Error('storage unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = await reporter(() => fixture.service).buildCapabilityPayload();
    expect(payload?.providers).toHaveLength(3);
  });

  it('advertises research to the AI-action router with the same list the request header sends', async () => {
    const payload = await reporter(() => null).buildAIActionCapabilityPayload();
    expect(payload?.capabilities).toContain('comment-research-v1');
    expect(payload?.capabilities).toEqual([...AI_ACTION_EXECUTOR_CAPABILITIES]);
  });
});

describe('DesktopCapabilityReporter default-tool notice with BYOK', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    notices.length = 0;
  });

  async function refresh(byok: ByokService | null, readyCli: string | null): Promise<void> {
    vi.spyOn(AICliDetector, 'detect').mockImplementation(async (cli) => ({
      available: cli === readyCli,
      authenticated: cli === readyCli,
      cli: cli === readyCli ? cli : null,
      path: null,
      version: null,
    }));
    const settings = {
      ...DEFAULT_SETTINGS,
      authToken: 'token',
      syncClientId: 'client-1',
      aiComment: { ...DEFAULT_SETTINGS.aiComment, enabled: true, defaultCli: 'claude' as const },
    };
    await new DesktopCapabilityReporter({
      apiClient: () => ({ refreshSyncClientCapabilities: vi.fn(async () => undefined) }) as never,
      settings: () => settings,
      pluginVersion: '4.11.0',
      schedule: vi.fn(),
      clearSchedule: vi.fn(),
      byok: () => byok,
    }).refreshNow();
  }

  it('stays quiet when no CLI is ready and jobs run on the user\'s key', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna') });
    await readyOpenAI(fixture);
    await refresh(fixture.service, null);
    expect(notices).toEqual([]);
  });

  it('still warns when another CLI stands in for the chosen one', async () => {
    await refresh(null, 'gemini');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('"Gemini"');
  });
});
