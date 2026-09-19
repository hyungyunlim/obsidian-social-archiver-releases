import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopCapabilityReporter } from '../../../plugin/ai-comment/DesktopCapabilityReporter';
import { AICliDetector } from '../../../utils/ai-cli';
import { DEFAULT_SETTINGS } from '../../../types/settings';

describe('DesktopCapabilityReporter while the CLI executor is delegated', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AICliDetector, 'detect').mockResolvedValue({
      available: true,
      authenticated: true,
      path: '/usr/local/bin/ai',
    });
  });

  it('advertises the built-in executor as disabled so the server routes AI jobs to the CLI client', async () => {
    const settings = { ...DEFAULT_SETTINGS, aiComment: { ...DEFAULT_SETTINGS.aiComment, enabled: true } };
    const build = (delegated: boolean) =>
      new DesktopCapabilityReporter({
        apiClient: () => undefined,
        settings: () => settings,
        pluginVersion: '4.7.8',
        schedule: vi.fn(),
        clearSchedule: vi.fn(),
        delegatedToCli: () => delegated,
      }).buildCapabilityPayload();

    const delegated = await build(true);
    expect(delegated?.enabled).toBe(false);
    expect(delegated?.status).toBe('settings_disabled');

    const own = await build(false);
    expect(own?.enabled).toBe(true);
    expect(own?.status).toBe('ready');
  });
});
