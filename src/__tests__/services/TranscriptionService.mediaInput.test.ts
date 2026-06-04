import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { TranscriptionService } from '@/services/TranscriptionService';

vi.mock('@/utils/nodeRequire', async () => {
  const { createRequire } = await import('module');
  const testRequire = createRequire(import.meta.url);
  return {
    default: (moduleName: string) => testRequire(moduleName),
  };
});

describe('TranscriptionService media input preparation', () => {
  it('copies extensionless mp3 input to a temporary .mp3 file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'social-archiver-transcription-'));
    const source = join(dir, 'episode-audio');
    writeFileSync(source, Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]));

    const service = new TranscriptionService();
    const prepared = await (service as unknown as {
      prepareInputForTranscription(path: string): Promise<{ path: string; cleanup: () => Promise<void> }>;
    }).prepareInputForTranscription(source);

    try {
      expect(prepared.path).not.toBe(source);
      expect(prepared.path).toMatch(/\.mp3$/);
      expect(existsSync(prepared.path)).toBe(true);
    } finally {
      await prepared.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }

    expect(existsSync(prepared.path)).toBe(false);
  });
});
