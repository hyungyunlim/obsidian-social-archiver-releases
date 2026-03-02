import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginTTSProvider } from '@/services/tts/types';
import { TTSService } from '@/services/tts/TTSService';

type MockProvider = PluginTTSProvider & {
  synthesize: ReturnType<typeof vi.fn>;
  supportsLanguage: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  cancelPendingSynthesis: ReturnType<typeof vi.fn>;
};

function createMockProvider(
  id: 'supertonic' | 'azure',
  supportedLanguages: string[],
): MockProvider {
  const supported = new Set(supportedLanguages);
  return {
    id,
    synthesize: vi.fn(async () => new ArrayBuffer(16)),
    getVoices: vi.fn(async () => []),
    isAvailable: vi.fn(async () => true),
    supportsLanguage: vi.fn((lang: string) => supported.has(lang)),
    cancelPendingSynthesis: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

describe('TTSService provider fallback', () => {
  let service: TTSService;
  let supertonic: MockProvider;
  let azure: MockProvider;

  beforeEach(() => {
    service = new TTSService();
    supertonic = createMockProvider('supertonic', ['en-US', 'ko-KR']);
    azure = createMockProvider('azure', ['en-US', 'ko-KR', 'ja-JP']);

    service.setProvider(supertonic);
    service.setFallbackProvider(azure);

    const player = (service as unknown as { player: Record<string, unknown> }).player;
    vi.spyOn(player, 'decode').mockResolvedValue({ duration: 1 } as AudioBuffer);
    vi.spyOn(player, 'play').mockResolvedValue(undefined);
  });

  it('falls back only for the current post and restores primary provider for the next supported post', async () => {
    const longSpeakableText =
      'One two three four five six seven eight nine ten eleven twelve thirteen fourteen.';

    await service.startPlayback({
      fullContent: longSpeakableText,
    }, {
      lang: 'ja-JP',
    });

    expect(supertonic.synthesize).not.toHaveBeenCalled();
    expect(azure.synthesize).toHaveBeenCalledTimes(1);

    service.stop();

    await service.startPlayback({
      fullContent: longSpeakableText,
    }, {
      lang: 'en-US',
    });

    expect(supertonic.synthesize).toHaveBeenCalledTimes(1);
    expect(azure.synthesize).toHaveBeenCalledTimes(1);
  });
});
