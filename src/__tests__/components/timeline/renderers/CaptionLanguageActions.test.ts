import { TFile, type App } from 'obsidian';
import { buildCaptionActions } from '@/components/timeline/renderers/CaptionLanguageActions';
import { resolvePostArchiveId } from '@/components/timeline/renderers/postArchiveId';
import type { CaptionVariantSyncService } from '@/plugin/transcription/CaptionVariantSyncService';
import type { PostData } from '@/types/post';

function makeApp(frontmatter: Record<string, unknown> | undefined): App {
  const file = new TFile('Social Archives/video.md');
  return {
    vault: {
      getAbstractFileByPath: (path: string) => (path === file.path ? file : null),
      getFileByPath: (path: string) => (path === file.path ? file : null),
    },
    metadataCache: { getFileCache: () => (frontmatter ? { frontmatter } : null) },
  } as unknown as App;
}

const post = (overrides: Partial<PostData> = {}): PostData => ({
  platform: 'youtube',
  filePath: 'Social Archives/video.md',
  whisperTranscript: { segments: [{ id: 0, start: 0, end: 1, text: 'Hi' }], language: 'en', source: 'original' },
  ...overrides,
}) as PostData;

describe('buildCaptionActions', () => {
  const service = (): CaptionVariantSyncService | undefined => undefined;

  it('offers caption controls only on YouTube notes with a caption section', () => {
    const app = makeApp({ sourceArchiveId: 'a1' });
    const build = (p: PostData) => buildCaptionActions({ app, post: p, service, onChanged: vi.fn() });

    expect(build(post())).toBeDefined();
    expect(build(post({
      whisperTranscript: { segments: [], language: 'ko', source: 'whisper' },
      multilangTranscript: { defaultLanguage: 'ko', byLanguage: {}, sources: { ko: 'whisper', 'ko:ai': 'ai' } },
    }))).toBeUndefined();
    expect(build(post({
      whisperTranscript: { segments: [], language: 'ko', source: 'whisper' },
      multilangTranscript: { defaultLanguage: 'ko', byLanguage: {}, sources: { ko: 'whisper', en: 'caption' } },
    }))).toBeDefined();
    expect(build(post({ platform: 'tiktok' }))).toBeUndefined();
    expect(build(post({ filePath: undefined }))).toBeUndefined();
  });
});

describe('resolvePostArchiveId', () => {
  it('prefers the parsed id, then the current frontmatter (note uploaded after parsing)', () => {
    expect(resolvePostArchiveId(makeApp({ sourceArchiveId: 'fm-id' }), post({ sourceArchiveId: 'post-id' }))).toBe('post-id');
    expect(resolvePostArchiveId(makeApp({ sourceArchiveId: 'fm-id' }), post())).toBe('fm-id');
    expect(resolvePostArchiveId(makeApp({}), post())).toBeNull();
    expect(resolvePostArchiveId(makeApp({ sourceArchiveId: 'fm-id' }), post({ filePath: 'elsewhere.md' }))).toBeNull();
  });
});
