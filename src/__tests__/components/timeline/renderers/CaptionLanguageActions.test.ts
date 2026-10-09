import { TFile, type App } from 'obsidian';
import { buildCaptionActions } from '@/components/timeline/renderers/CaptionLanguageActions';
import { CaptionLanguageSuggestModal } from '@/components/timeline/modals/CaptionLanguageSuggestModal';
import { resolvePostArchiveId } from '@/components/timeline/renderers/postArchiveId';
import type { CaptionVariantSyncService } from '@/plugin/transcription/CaptionVariantSyncService';
import type { PostData } from '@/types/post';
import type { AvailableTranscriptTracksResponse } from '@/types/transcript-languages';

const { notices } = vi.hoisted(() => ({ notices: [] as string[] }));
vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
    hide(): void {}
  },
}));

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

  it('offers caption controls on every saved YouTube note, with or without a transcript', () => {
    const app = makeApp({ sourceArchiveId: 'a1' });
    const build = (p: PostData) => buildCaptionActions({ app, post: p, service, onChanged: vi.fn() });

    expect(build(post())).toBeDefined();
    // Whisper-only and transcript-less notes: the first pick becomes the archive's primary.
    expect(build(post({
      whisperTranscript: { segments: [], language: 'ko', source: 'whisper' },
      multilangTranscript: { defaultLanguage: 'ko', byLanguage: {}, sources: { ko: 'whisper', 'ko:ai': 'ai' } },
    }))).toBeDefined();
    expect(build(post({ whisperTranscript: undefined }))).toBeDefined();
    expect(build(post({ platform: 'tiktok' }))).toBeUndefined();
    expect(build(post({ filePath: undefined }))).toBeUndefined();
  });
});

describe('buildCaptionActions add flow', () => {
  const track = { language: 'ko', kind: 'asr' as const, name: null, state: 'available' as const };

  async function openPicker(
    available: AvailableTranscriptTracksResponse,
    onTranscribe?: () => void
  ): Promise<CaptionLanguageSuggestModal | undefined> {
    notices.length = 0;
    const opened: CaptionLanguageSuggestModal[] = [];
    const open = vi.spyOn(CaptionLanguageSuggestModal.prototype, 'open').mockImplementation(function (this: CaptionLanguageSuggestModal) {
      opened.push(this);
    });
    const listAvailable = vi.fn().mockResolvedValue(available);
    const actions = buildCaptionActions({
      app: makeApp({ sourceArchiveId: 'a1' }),
      post: post({ whisperTranscript: undefined }),
      service: () => ({ listAvailable }) as unknown as CaptionVariantSyncService,
      onChanged: vi.fn(),
      onTranscribe,
    });
    actions!.onAddLanguage();
    await vi.waitFor(() => expect(listAvailable).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    open.mockRestore();
    return opened[0];
  }

  it('offers the Whisper hand-off when YouTube has no captions', async () => {
    const onTranscribe = vi.fn();
    const picker = await openPicker({ primary: null, tracks: [] }, onTranscribe);

    expect(picker!.getSuggestions('')).toEqual(['whisper']);
    picker!.onChooseSuggestion('whisper');
    expect(onTranscribe).toHaveBeenCalledTimes(1);
  });

  it('lists the tracks plus Whisper when the archive has no primary yet', async () => {
    const picker = await openPicker({ primary: null, tracks: [track] }, vi.fn());
    expect(picker!.getSuggestions('')).toEqual([track, 'whisper']);
  });

  it('keeps Whisper out once a primary exists, and says so when nothing is offered', async () => {
    const picker = await openPicker({ primary: { language: 'en', kind: 'manual' }, tracks: [track] }, vi.fn());
    expect(picker!.getSuggestions('')).toEqual([track]);

    expect(await openPicker({ primary: null, tracks: [] })).toBeUndefined();
    expect(notices).toContain('This video has no captions on YouTube.');
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
