import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopCapabilityReporter } from '../../../plugin/ai-comment/DesktopCapabilityReporter';
import { AICliDetector } from '../../../utils/ai-cli';
import { DEFAULT_SETTINGS } from '../../../types/settings';

describe('DesktopCapabilityReporter place extraction capability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AICliDetector, 'detect').mockResolvedValue({
      available: true,
      authenticated: true,
      path: '/usr/local/bin/ai',
    });
  });

  it('makes Obsidian eligible for local place extraction jobs', async () => {
    const reporter = new DesktopCapabilityReporter({
      apiClient: () => undefined,
      settings: () => DEFAULT_SETTINGS,
      pluginVersion: '4.3.1',
      schedule: vi.fn(),
      clearSchedule: vi.fn(),
    });

    const payload = await reporter.buildAIActionCapabilityPayload();

    expect(payload?.capabilities).toContain('place-extract-v1');
    expect(payload?.capabilities).toContain('place-kind-suggestion-v1');
  });
});
