import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  CaptionLanguageError,
  CaptionVariantSyncService,
  captionErrorMessage,
  sameOpeningText,
  type CaptionVariantSyncDeps,
} from '../../../plugin/transcription/CaptionVariantSyncService';
import {
  insertCaptionSection,
  insertTranscriptSection,
  listCaptionSections,
  parseTranscriptSections,
} from '../../../services/markdown/TranscriptSectionManager';
import type { UserArchive } from '../../../services/WorkersAPIClient';
import type { ArchiveTranscriptJson, TranscriptLanguageSummary } from '../../../types/transcript-languages';

const NOTE = `---
platform: youtube
---

Description

---

## Transcript

[00:00](https://www.youtube.com/watch?v=vid&t=0s) Hello and welcome

[00:04](https://www.youtube.com/watch?v=vid&t=4s) Nice to meet you

---

**Platform:** youtube
`;

const BODIES: Record<string, ArchiveTranscriptJson> = {
  ko: { formatted: [{ start_time: 0, text: '안녕하세요' }], language: 'ko', kind: 'asr' },
  ja: { formatted: [{ start_time: 0, text: 'こんにちは' }], language: 'ja', kind: 'manual' },
  en: { formatted: [{ start_time: 0, text: 'Hello there' }], language: 'en', kind: 'manual' },
  es: { formatted: [{ start_time: 0, text: 'Hola y bienvenidos' }, { start_time: 4, text: 'Mucho gusto' }], language: 'es', kind: 'manual' },
};

function setup(content: string, frontmatter: Record<string, unknown> = { transcriptLanguage: 'en', videoId: 'vid' }) {
  const file = { path: 'Social Archives/video.md' } as TFile;
  const state = { content, frontmatter: { ...frontmatter } };
  const app = {
    vault: {
      read: vi.fn(async () => state.content),
      process: vi.fn(async (_file: TFile, fn: (data: string) => string) => {
        state.content = fn(state.content);
        return state.content;
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (_file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        fn(state.frontmatter);
      }),
    },
    metadataCache: { getFileCache: vi.fn(() => ({ frontmatter: state.frontmatter })) },
  };
  const api = {
    getUserArchive: vi.fn(),
    getAvailableArchiveTranscripts: vi.fn(),
    getArchiveTranscript: vi.fn(async (_id: string, language: string) => ({
      language,
      kind: 'manual' as const,
      role: 'variant' as const,
      trackName: null,
      transcript: { ...BODIES[language], language },
    })),
    addArchiveTranscript: vi.fn(),
    deleteArchiveTranscript: vi.fn(),
    setPrimaryArchiveTranscript: vi.fn(),
  };
  const notify = vi.fn();
  const deps: CaptionVariantSyncDeps = {
    app: app as unknown as App,
    apiClient: () => api as unknown as ReturnType<CaptionVariantSyncDeps['apiClient']>,
    findBySourceArchiveId: (id) => (id === 'a1' ? file : null),
    withMarkdownWriteLock: (_id, fn) => fn(),
    getClientId: () => 'my-client',
    refreshTimelineView: vi.fn(),
    notify,
  };
  return { service: new CaptionVariantSyncService(deps), file, state, api, notify, deps };
}

const archive = (languages: TranscriptLanguageSummary[] | null): UserArchive =>
  ({ id: 'a1', originalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', transcriptLanguages: languages }) as UserArchive;

const summary = (...langs: string[]): TranscriptLanguageSummary[] =>
  langs.map((language, i) => (i === 0 ? { language, kind: 'manual', primary: true } : { language, kind: 'manual' }));

describe('CaptionVariantSyncService.reconcileFromLibrarySync', () => {
  it('adds missing caption sections and records the section languages', async () => {
    const { service, file, state, api } = setup(NOTE);

    await service.reconcileFromLibrarySync(file, archive(summary('en', 'ko')));

    expect(api.getArchiveTranscript).toHaveBeenCalledWith('a1', 'ko');
    expect(listCaptionSections(state.content)).toEqual([{ language: 'ko', kind: 'asr' }]);
    expect(state.content).toContain('[00:00](https://www.youtube.com/watch?v=vid&t=0s) 안녕하세요');
    expect(state.frontmatter.transcriptLanguages).toEqual(['en', 'ko']);
    expect(state.frontmatter).not.toHaveProperty('transcriptDefaultLanguage');
  });

  it('removes caption sections the server dropped and is idempotent', async () => {
    const withJa = insertCaptionSection(NOTE, { language: 'ja', kind: 'manual', lines: '[00:00] こんにちは' });
    const { service, file, state, deps } = setup(withJa);

    await service.reconcileFromLibrarySync(file, archive(summary('en')));
    expect(state.content).toBe(NOTE);

    const processCalls = (deps.app.vault.process as ReturnType<typeof vi.fn>).mock.calls.length;
    await service.reconcileFromLibrarySync(file, archive(summary('en')));
    expect((deps.app.vault.process as ReturnType<typeof vi.fn>).mock.calls.length).toBe(processCalls);
  });

  it('keeps an AI translation of the same language and notices once per session', async () => {
    const withAi = insertTranscriptSection(NOTE, 'ko', '[00:00] AI 번역', 'en')!;
    const { service, file, state, notify, api } = setup(withAi);

    await service.reconcileFromLibrarySync(file, archive(summary('en', 'ko')));
    await service.reconcileFromLibrarySync(file, archive(summary('en', 'ko')));

    expect(state.content).toBe(withAi);
    expect(api.getArchiveTranscript).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toContain('Korean');
  });

  it('treats a default-language swap as a set no-op: body untouched, only the default flips', async () => {
    const withJa = insertCaptionSection(NOTE, { language: 'ja', kind: 'manual', lines: '[00:00] こんにちは' });
    const { service, file, state, deps } = setup(withJa);

    await service.reconcileFromLibrarySync(file, archive(summary('ja', 'en')));
    expect(state.content).toBe(withJa);
    expect(deps.app.vault.process).not.toHaveBeenCalled();
    expect(state.frontmatter.transcriptDefaultLanguage).toBe('ja');

    await service.reconcileFromLibrarySync(file, archive(summary('en', 'ja')));
    expect(state.content).toBe(withJa);
    expect(state.frontmatter).not.toHaveProperty('transcriptDefaultLanguage');
  });

  it('skips archives that never had an added language', async () => {
    const { service, file, deps } = setup(NOTE);
    await service.reconcileFromLibrarySync(file, archive(null));
    expect(deps.app.vault.read).not.toHaveBeenCalled();
  });

  it('recognizes a legacy original guessed as en by its text and backfills transcriptLanguage', async () => {
    const spanish = NOTE.replace('Hello and welcome', 'Hola y bienvenidos').replace('Nice to meet you', 'Mucho gusto');
    const { service, file, state } = setup(spanish, { videoId: 'vid' });

    await service.reconcileFromLibrarySync(file, archive(summary('es', 'en')));

    expect(state.frontmatter.transcriptLanguage).toBe('es');
    expect(listCaptionSections(state.content)).toEqual([{ language: 'en', kind: 'manual' }]);
  });

  it('uses the archive primary as the original of a freshly written note', async () => {
    const { service, file, state, api } = setup(NOTE, {});

    await service.reconcileFromLibrarySync(file, archive(summary('en', 'ja')), 'en');

    expect(api.getArchiveTranscript).toHaveBeenCalledTimes(1);
    expect(listCaptionSections(state.content)).toEqual([{ language: 'ja', kind: 'manual' }]);
    expect(state.content).toContain('watch?v=dQw4w9WgXcQ&t=0s) こんにちは');
  });
});

describe('CaptionVariantSyncService.handleUpdatedEvent', () => {
  const event = { archiveId: 'a1', action: 'added' as const, language: 'ko', languages: summary('en', 'ko'), updatedAt: 'now' };

  it('skips its own echo and archives without a note', async () => {
    const { service, api } = setup(NOTE);
    await service.handleUpdatedEvent({ ...event, sourceClientId: 'my-client' });
    await service.handleUpdatedEvent({ ...event, archiveId: 'unknown' });
    expect(api.getUserArchive).not.toHaveBeenCalled();
  });

  it('refetches the archive, reconciles and refreshes the timeline', async () => {
    const { service, api, state, deps } = setup(NOTE);
    api.getUserArchive.mockResolvedValue({ archive: archive(summary('en', 'ko')) });

    await service.handleUpdatedEvent({ ...event, sourceClientId: 'mobile-1' });

    expect(api.getUserArchive).toHaveBeenCalledWith('a1');
    expect(listCaptionSections(state.content)).toHaveLength(1);
    expect(deps.refreshTimelineView).toHaveBeenCalled();
  });
});

describe('CaptionVariantSyncService user actions', () => {
  const tracks = (states: Array<'primary' | 'added' | 'available'>) =>
    states.map((state, i) => ({ language: ['en', 'ko', 'ja'][i]!, kind: 'manual' as const, name: null, state }));

  it('backfills transcriptLanguage from the available primary only without added tracks (L11)', async () => {
    const fresh = setup(NOTE, {});
    fresh.api.getAvailableArchiveTranscripts.mockResolvedValue({ primary: { language: 'en', kind: 'manual' }, tracks: tracks(['primary', 'available']) });
    await fresh.service.listAvailable(fresh.file, 'a1');
    expect(fresh.state.frontmatter.transcriptLanguage).toBe('en');

    const swapped = setup(NOTE, {});
    swapped.api.getAvailableArchiveTranscripts.mockResolvedValue({ primary: { language: 'ja', kind: 'manual' }, tracks: tracks(['primary', 'added']) });
    await swapped.service.listAvailable(swapped.file, 'a1');
    expect(swapped.state.frontmatter).not.toHaveProperty('transcriptLanguage');

    const unknown = setup(NOTE, {});
    unknown.api.getAvailableArchiveTranscripts.mockResolvedValue({ primary: { language: 'und', kind: null }, tracks: tracks(['available']) });
    await unknown.service.listAvailable(unknown.file, 'a1');
    expect(unknown.state.frontmatter).not.toHaveProperty('transcriptLanguage');
  });

  it('adds a language from the POST body without a second GET', async () => {
    const { service, file, state, api, notify } = setup(NOTE);
    api.addArchiveTranscript.mockResolvedValue({
      language: 'ko', kind: 'asr', role: 'variant', trackName: null, action: 'added',
      transcript: { ...BODIES.ko, language: 'ko' }, transcriptLanguages: summary('en', 'ko'), updatedAt: 'now',
    });

    await service.addLanguage(file, 'a1', { language: 'ko', kind: 'asr', name: null, state: 'available' });

    expect(api.addArchiveTranscript).toHaveBeenCalledWith('a1', { language: 'ko', kind: 'asr' });
    expect(api.getArchiveTranscript).not.toHaveBeenCalled();
    expect(listCaptionSections(state.content)).toEqual([{ language: 'ko', kind: 'asr' }]);
    expect(notify).toHaveBeenCalledWith('Korean captions added');
  });

  it('maps contract errors to a Notice and throws CaptionLanguageError', async () => {
    const { service, file, api, notify } = setup(NOTE);
    api.deleteArchiveTranscript.mockRejectedValue(Object.assign(new Error('no'), { code: 'TRANSCRIPT_PRIMARY_NOT_DELETABLE' }));
    api.addArchiveTranscript.mockRejectedValue(Object.assign(new Error('no'), { code: 'TRANSCRIPT_LANGUAGE_UNAVAILABLE' }));

    await expect(service.deleteLanguage(file, 'a1', 'en')).rejects.toBeInstanceOf(CaptionLanguageError);
    await expect(service.addLanguage(file, 'a1', { language: 'de', kind: 'manual', name: null, state: 'available' }))
      .rejects.toBeInstanceOf(CaptionLanguageError);

    expect(notify.mock.calls.map((call) => call[0])).toEqual([
      'Set another language as default first.',
      'This video has no German captions. Try AI translation instead.',
    ]);
  });

  it('set-default with a null summary treats the language as the primary', async () => {
    const { service, file, state, api } = setup(NOTE, { transcriptLanguage: 'en', transcriptDefaultLanguage: 'ja' });
    api.setPrimaryArchiveTranscript.mockResolvedValue({ primary: null, variants: [], transcriptLanguages: null, changed: false, updatedAt: 'now' });

    await service.setDefault(file, 'a1', 'en');

    expect(state.frontmatter).not.toHaveProperty('transcriptDefaultLanguage');
  });
});

/** A YouTube note archived while YouTube refused captions: no transcript section. */
const NO_TRANSCRIPT = `---
platform: youtube
---

Description

---

**Platform:** youtube
`;

const originals = (content: string) => parseTranscriptSections(content).filter((s) => s.source === 'original');

describe('CaptionVariantSyncService first primary (archive saved without captions)', () => {
  it('lands a plugin-added first primary as the original section, and the next sync leaves it alone', async () => {
    const { service, file, state, api, deps } = setup(NO_TRANSCRIPT, { videoId: 'vid' });
    api.addArchiveTranscript.mockResolvedValue({
      language: 'en', kind: 'manual', role: 'primary', trackName: null, action: 'added',
      transcript: { ...BODIES.en, language: 'en' }, transcriptLanguages: summary('en'), updatedAt: 'now',
    });

    // 'en' is also the guessed original language of a note without a transcript.
    await service.addLanguage(file, 'a1', { language: 'en', kind: 'manual', name: null, state: 'available' });

    expect(api.getArchiveTranscript).not.toHaveBeenCalled();
    expect(originals(state.content)).toHaveLength(1);
    expect(state.content).toContain('[00:00](https://www.youtube.com/watch?v=vid&t=0s) Hello there');
    expect(listCaptionSections(state.content)).toEqual([]);
    expect(state.frontmatter).toMatchObject({ transcriptLanguage: 'en', transcriptLanguages: ['en'] });
    expect(state.frontmatter).not.toHaveProperty('transcriptDefaultLanguage');

    const landed = state.content;
    const process = deps.app.vault.process as ReturnType<typeof vi.fn>;
    const writes = process.mock.calls.length;
    await service.reconcileFromLibrarySync(file, archive(summary('en')));
    expect(state.content).toBe(landed);
    expect(process.mock.calls.length).toBe(writes);
  });

  it('lands a first primary synced from another device; later languages and swaps reconcile around it', async () => {
    const { service, file, state, api } = setup(NO_TRANSCRIPT, { videoId: 'vid' });
    api.getUserArchive.mockResolvedValue({ archive: archive(summary('ko')) });

    await service.handleUpdatedEvent({
      archiveId: 'a1', action: 'primary_changed', language: 'ko', languages: summary('ko'), updatedAt: 'now', sourceClientId: 'mobile-1',
    });

    expect(api.getArchiveTranscript).toHaveBeenCalledWith('a1', 'ko');
    expect(originals(state.content)).toHaveLength(1);
    expect(state.frontmatter.transcriptLanguage).toBe('ko');

    await service.reconcileFromLibrarySync(file, archive(summary('ko', 'ja')));
    expect(listCaptionSections(state.content)).toEqual([{ language: 'ja', kind: 'manual' }]);

    await service.reconcileFromLibrarySync(file, archive(summary('ja', 'ko')));
    expect(state.frontmatter.transcriptDefaultLanguage).toBe('ja');

    // The old primary deleted server-side: the original section is never removed.
    await service.reconcileFromLibrarySync(file, archive(summary('ja')));
    expect(originals(state.content)).toHaveLength(1);
    expect(state.content.match(/안녕하세요/g)).toHaveLength(1);
    expect(listCaptionSections(state.content)).toEqual([{ language: 'ja', kind: 'manual' }]);
  });

  it("folds an older plugin's caption block of the primary into the original section", async () => {
    const legacy = insertCaptionSection(NO_TRANSCRIPT, { language: 'ko', kind: 'asr', lines: '[00:00] 안녕하세요' });
    const { service, file, state } = setup(legacy, { videoId: 'vid', transcriptDefaultLanguage: 'ko' });

    await service.reconcileFromLibrarySync(file, archive(summary('ko')));

    expect(listCaptionSections(state.content)).toEqual([]);
    expect(originals(state.content)).toHaveLength(1);
    expect(state.content.match(/안녕하세요/g)).toHaveLength(1);
    expect(state.frontmatter.transcriptLanguage).toBe('ko');
    expect(state.frontmatter).not.toHaveProperty('transcriptDefaultLanguage');
  });

  it('never re-lands an original the note already placed (explicit transcriptLanguage)', async () => {
    const { service, file, state } = setup(NO_TRANSCRIPT, { videoId: 'vid', transcriptLanguage: 'en' });

    await service.reconcileFromLibrarySync(file, archive(summary('en', 'ko')));

    expect(originals(state.content)).toHaveLength(0);
    expect(listCaptionSections(state.content)).toEqual([{ language: 'ko', kind: 'asr' }]);
  });

  it('reads TRANSCRIPT_TOO_LARGE on add as a size limit', async () => {
    const { service, file, api, notify } = setup(NO_TRANSCRIPT, { videoId: 'vid' });
    api.addArchiveTranscript.mockRejectedValue(Object.assign(new Error('409'), { code: 'TRANSCRIPT_TOO_LARGE' }));

    await expect(service.addLanguage(file, 'a1', { language: 'ko', kind: 'asr', name: null, state: 'available' }))
      .rejects.toBeInstanceOf(CaptionLanguageError);

    expect(notify).toHaveBeenCalledWith('Korean captions are too long to save to this archive.');
  });
});

describe('sameOpeningText (legacy original detection)', () => {
  const section = (...lines: string[]) => lines.map((line, i) => `[00:0${i}] ${line}`).join('\n\n');
  const body = (...texts: string[]): ArchiveTranscriptJson => ({ formatted: texts.map((text, i) => ({ start_time: i, text })) });

  it('matches the same spoken opening, ignoring filler on both sides', () => {
    expect(sameOpeningText(
      body('[Music]', '♪', 'Hola y bienvenidos a todos', 'Mucho gusto'),
      section('[Music]', 'Hola y bienvenidos a todos', '♪ Mucho gusto ♪')
    )).toBe(true);
  });

  it('never matches on shared filler alone', () => {
    expect(sameOpeningText(body('[Music]', '♪♪', '(Applause)'), section('[Music]', '♪♪', '(Applause)'))).toBe(false);
    expect(sameOpeningText(
      body('[Music]', '♪', 'Hello everyone'),
      section('[Music]', '♪', 'Hola a todos')
    )).toBe(false);
  });

  it('needs about 20 comparable characters', () => {
    expect(sameOpeningText(body('Hi there', 'OK'), section('Hi there', 'OK'))).toBe(false);
  });
});

describe('captionErrorMessage', () => {
  it('maps contract codes, lets a caller override one, and falls back to the generic retry text', () => {
    const tooLarge = Object.assign(new Error('409'), { code: 'TRANSCRIPT_TOO_LARGE' });
    expect(captionErrorMessage(tooLarge)).toBe('These captions are too long to set as default.');
    expect(captionErrorMessage(tooLarge, 'ja', { TRANSCRIPT_TOO_LARGE: 'tlang.error.tooLargeToAdd' }))
      .toBe('Japanese captions are too long to save to this archive.');
    expect(captionErrorMessage(new Error('boom'))).toBe("Couldn't update captions. Try again.");
  });
});
