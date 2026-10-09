/**
 * CaptionVariantSyncService
 *
 * Single Responsibility: keep a note's caption marker sections in step with
 * the server's caption language set (prd-youtube-transcript-languages T11/T13).
 *
 * - Set-based: target = server languages minus the note's original language.
 *   A default-language swap never moves or deletes sections; only
 *   `transcriptDefaultLanguage` flips (L10).
 * - Only `social-archiver-caption` blocks are added or removed. AI-translated
 *   and original sections are never touched; an AI section of a target language
 *   blocks the insert (one Notice per archive+language per session).
 */

import type { App, TFile } from 'obsidian';
import type { WorkersAPIClient, UserArchive } from '../../services/WorkersAPIClient';
import type {
  ArchiveTranscriptJson,
  AvailableTranscriptTrack,
  AvailableTranscriptTracksResponse,
  TranscriptKind,
  TranscriptLanguageSummary,
  TranscriptVariantsUpdatedEventData,
} from '../../types/transcript-languages';
import { TRANSCRIPT_UNKNOWN_LANGUAGE } from '../../types/transcript-languages';
import {
  extractTranscriptLanguages,
  findUnmarkedSection,
  insertCaptionSection,
  listCaptionSections,
  parseSectionSegments,
  parseTranscriptSections,
  removeCaptionSection,
  resolveNoteTranscriptLanguages,
} from '../../services/markdown/TranscriptSectionManager';
import { TranscriptFormatter } from '../../services/markdown/formatters/TranscriptFormatter';
import { knownTranscriptLanguage, normalizeTranscriptLanguage, transcriptLanguageDisplayName } from '../../constants/languages';
import { extractYouTubeVideoId } from '../../components/timeline/renderers/PreviewableHelpers';
import { currentLang, t, type TranslationKey } from '../../i18n';

type CaptionApi = Pick<
  WorkersAPIClient,
  | 'getUserArchive'
  | 'getAvailableArchiveTranscripts'
  | 'getArchiveTranscript'
  | 'addArchiveTranscript'
  | 'deleteArchiveTranscript'
  | 'setPrimaryArchiveTranscript'
>;

export interface CaptionVariantSyncDeps {
  app: App;
  apiClient: () => CaptionApi | undefined;
  findBySourceArchiveId: (archiveId: string) => TFile | null;
  withMarkdownWriteLock: <T>(archiveId: string, fn: () => Promise<T>) => Promise<T>;
  /** This vault's sync client id (`X-Client-Id`), for self-echo skipping. */
  getClientId: () => string | undefined;
  refreshTimelineView: () => void;
  notify: (message: string) => void;
}

/** Thrown to callers; already shown to the user as a Notice. */
export class CaptionLanguageError extends Error {}

const ERROR_KEYS: Record<string, TranslationKey> = {
  TRANSCRIPT_LANGUAGE_UNAVAILABLE: 'tlang.error.unavailable',
  TRANSCRIPT_VARIANT_LIMIT: 'tlang.error.limit',
  TRANSCRIPT_PRIMARY_NOT_DELETABLE: 'tlang.error.primaryNotDeletable',
  TRANSCRIPT_LANGUAGE_IS_PRIMARY: 'tlang.error.isPrimary',
  TRANSCRIPT_TOO_LARGE: 'tlang.error.tooLarge',
  TRANSCRIPT_PRIMARY_MISSING: 'tlang.error.primaryMissing',
  RATE_LIMITED: 'tlang.error.rateLimited',
  NOT_YOUTUBE: 'tlang.error.videoUnavailable',
  VIDEO_UNAVAILABLE: 'tlang.error.videoUnavailable',
};

/** Notice text for an API failure (contract C4); unknown codes read generic. */
export function captionErrorMessage(error: unknown, language?: string): string {
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
  const key = (typeof code === 'string' && ERROR_KEYS[code]) || 'tlang.error.generic';
  return t(key, { language: language ? transcriptLanguageDisplayName(language) : '' });
}

/** `[Music]`, `(Applause)`, `♪` — identical across tracks, so they prove nothing. */
const CAPTION_FILLER = /\[[^\]]*\]|\([^)]*\)|[♪♫♬♩🎵🎶]/gu;
/** Comparable characters required before two openings count as the same track. */
const MIN_COMPARABLE_CHARS = 20;
const OPENING_SEGMENTS = 5;

/** Spoken text of the first segments, filler removed. */
function openingText(texts: string[]): string {
  return texts
    .map((text) => text.replace(CAPTION_FILLER, ' ').replace(/\s+/g, ' ').trim())
    .filter((text) => /[\p{L}\p{N}]/u.test(text))
    .slice(0, OPENING_SEGMENTS)
    .join(' ');
}

/** True when a caption body and a note section open with the same spoken text. */
export function sameOpeningText(body: ArchiveTranscriptJson, sectionBody: string): boolean {
  const bodyText = openingText((body.formatted ?? []).map((segment) => segment.text));
  return [...bodyText.replace(/\s/g, '')].length >= MIN_COMPARABLE_CHARS &&
    bodyText === openingText(parseSectionSegments(sectionBody).map((s) => s.text));
}

export class CaptionVariantSyncService {
  private readonly formatter = new TranscriptFormatter();
  /** `${archiveId}:${language}` already warned about an AI-section conflict this session. */
  private readonly conflictNoticed = new Set<string>();

  constructor(private readonly deps: CaptionVariantSyncDeps) {}

  // ── Inbound sync ─────────────────────────────────────

  /**
   * Library-sync hook; the caller already holds the archive write locks.
   * `originalLanguage` is known for a note written from this very archive
   * (its `## Transcript` is the server primary) while the metadata cache
   * has not indexed the new file yet.
   */
  async reconcileFromLibrarySync(file: TFile, archive: UserArchive, originalLanguage?: string): Promise<void> {
    if (!archive.transcriptLanguages?.length) return;
    await this.applySummary(file, archive.id, archive.transcriptLanguages, {
      originalLanguage: knownTranscriptLanguage(originalLanguage),
      originalUrl: archive.originalUrl,
    });
  }

  /** `ws:transcript_variants_updated` (C5). */
  async handleUpdatedEvent(data: TranscriptVariantsUpdatedEventData | undefined): Promise<void> {
    if (!data?.archiveId) return;
    if (data.sourceClientId && data.sourceClientId === this.deps.getClientId()) return;
    const file = this.deps.findBySourceArchiveId(data.archiveId);
    const api = this.deps.apiClient();
    if (!file || !api) return;

    const { archive } = await api.getUserArchive(data.archiveId);
    await this.deps.withMarkdownWriteLock(archive.id, () => this.reconcileFromLibrarySync(file, archive));
    this.deps.refreshTimelineView();
  }

  // ── User actions ─────────────────────────────────────

  /** Live caption tracks; also backfills `transcriptLanguage` (L11). */
  async listAvailable(file: TFile, archiveId: string): Promise<AvailableTranscriptTracksResponse> {
    const response = await this.call(undefined, (api) => api.getAvailableArchiveTranscripts(archiveId, currentLang()));
    const primary = normalizeTranscriptLanguage(response.primary?.language);
    if (
      primary &&
      primary !== TRANSCRIPT_UNKNOWN_LANGUAGE &&
      !response.tracks.some((track) => track.state === 'added') &&
      !this.frontmatter(file)?.transcriptLanguage
    ) {
      // ponytail: no `added` track = no swap evidence, so the server primary is the note's original section.
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm.transcriptLanguage = primary;
      });
    }
    return response;
  }

  async addLanguage(file: TFile, archiveId: string, track: AvailableTranscriptTrack): Promise<void> {
    const response = await this.call(track.language, (api) =>
      api.addArchiveTranscript(archiveId, { language: track.language, kind: track.kind }));
    await this.deps.withMarkdownWriteLock(archiveId, () =>
      this.applySummary(file, archiveId, response.transcriptLanguages, {
        bodies: new Map([[normalizeTranscriptLanguage(response.language) ?? response.language, response.transcript]]),
      }));
    this.deps.notify(t('tlang.added', { language: transcriptLanguageDisplayName(response.language) }));
  }

  async deleteLanguage(file: TFile, archiveId: string, language: string): Promise<void> {
    const response = await this.call(language, (api) => api.deleteArchiveTranscript(archiveId, language));
    await this.deps.withMarkdownWriteLock(archiveId, () =>
      this.applySummary(file, archiveId, response.transcriptLanguages));
    this.deps.notify(t('tlang.removed', { language: transcriptLanguageDisplayName(language) }));
  }

  async setDefault(file: TFile, archiveId: string, language: string): Promise<void> {
    const response = await this.call(language, (api) => api.setPrimaryArchiveTranscript(archiveId, language));
    // A null summary means the archive never had an added language: `language` is the primary.
    const summary = response.transcriptLanguages ?? [{ language, kind: null, primary: true as const }];
    await this.deps.withMarkdownWriteLock(archiveId, () => this.applySummary(file, archiveId, summary));
    this.deps.notify(t('tlang.defaultSet', { language: transcriptLanguageDisplayName(language) }));
  }

  // ── Note edits ───────────────────────────────────────

  /**
   * Make the note's caption blocks match `summary`. `bodies` (keyed by
   * normalized language) are caption bodies already in hand (POST response) —
   * those languages are rewritten in place even when a block exists (re-add =
   * replace, T5). `originalLanguage` overrides the note's resolved original
   * language when the metadata cache cannot know it yet.
   */
  private async applySummary(
    file: TFile,
    archiveId: string,
    summary: TranscriptLanguageSummary[],
    options: { bodies?: Map<string, ArchiveTranscriptJson>; originalLanguage?: string; originalUrl?: string } = {}
  ): Promise<void> {
    const { vault, fileManager } = this.deps.app;
    const bodies = options.bodies ?? new Map<string, ArchiveTranscriptJson>();
    const content = await vault.read(file);
    const fm = this.frontmatter(file);
    const resolved = resolveNoteTranscriptLanguages(fm, content);
    const languages = options.originalLanguage ? { ...resolved, original: options.originalLanguage } : resolved;
    const originalIsExplicit = !!options.originalLanguage || !!knownTranscriptLanguage(fm?.transcriptLanguage);

    const serverLanguages = new Set(
      summary.map((entry) => normalizeTranscriptLanguage(entry.language)).filter((lang): lang is string => !!lang)
    );
    const present = new Set(listCaptionSections(content).map((c) => c.language));
    const toRemove = [...present].filter((lang) => !serverLanguages.has(lang));
    const toAdd = summary.flatMap((entry) => {
      const language = normalizeTranscriptLanguage(entry.language);
      return language &&
        language !== TRANSCRIPT_UNKNOWN_LANGUAGE &&
        language !== languages.original &&
        (!present.has(language) || bodies.has(language))
        ? [{ language, kind: entry.kind }]
        : [];
    });

    const originalSection = originalIsExplicit
      ? undefined
      : parseTranscriptSections(content, languages).find((s) => s.source === 'original');
    const videoId = this.videoId(fm, options.originalUrl);
    const inserts: Array<{ language: string; kind: TranscriptKind; lines: string }> = [];
    for (const { language, kind } of toAdd) {
      if (findUnmarkedSection(content, language, languages)) {
        this.noticeConflictOnce(archiveId, language);
        continue;
      }
      const body = bodies.get(language) ?? (await this.fetchBody(archiveId, language));
      if (originalSection && sameOpeningText(body, originalSection.body)) {
        // Legacy note whose original section was guessed wrong: this IS its language.
        await fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
          frontmatter.transcriptLanguage = language;
        });
        return this.applySummary(file, archiveId, summary, { ...options, originalLanguage: language });
      }
      const lines = this.formatLines(body, videoId);
      if (lines) inserts.push({ language, kind: body.kind ?? kind ?? 'manual', lines });
    }

    let finalContent = content;
    if (toRemove.length > 0 || inserts.length > 0) {
      await vault.process(file, (current) => {
        let next = current;
        for (const lang of toRemove) next = removeCaptionSection(next, lang) ?? next;
        for (const insert of inserts) next = insertCaptionSection(next, insert);
        finalContent = next;
        return next;
      });
    }

    const primary = normalizeTranscriptLanguage(summary[0]?.language);
    const defaultLanguage =
      primary && primary !== TRANSCRIPT_UNKNOWN_LANGUAGE && primary !== languages.original ? primary : undefined;
    const sectionsChanged = finalContent !== content;
    if (!sectionsChanged && fm?.transcriptDefaultLanguage === defaultLanguage) return;

    await fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      if (sectionsChanged) frontmatter.transcriptLanguages = extractTranscriptLanguages(finalContent, languages);
      if (defaultLanguage) frontmatter.transcriptDefaultLanguage = defaultLanguage;
      else delete frontmatter.transcriptDefaultLanguage;
    });
  }

  private async fetchBody(archiveId: string, language: string): Promise<ArchiveTranscriptJson> {
    const api = this.deps.apiClient();
    if (!api) return {};
    return (await api.getArchiveTranscript(archiveId, language)).transcript;
  }

  private formatLines(body: ArchiveTranscriptJson, videoId: string | undefined): string {
    const formatted = (body.formatted ?? []).map((segment) => ({
      start_time: segment.start_time,
      end_time: segment.end_time ?? segment.start_time,
      duration: segment.duration ?? 0,
      text: segment.text,
    }));
    return this.formatter.formatBrightDataTranscript(formatted, videoId) || body.raw?.trim() || '';
  }

  private noticeConflictOnce(archiveId: string, language: string): void {
    const key = `${archiveId}:${language}`;
    if (this.conflictNoticed.has(key)) return;
    this.conflictNoticed.add(key);
    this.deps.notify(t('tlang.aiConflict', { language: transcriptLanguageDisplayName(language) }));
  }

  private frontmatter(file: TFile): Record<string, unknown> | undefined {
    return this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
  }

  private videoId(fm: Record<string, unknown> | undefined, fallbackUrl?: string): string | undefined {
    const direct = fm?.videoId;
    if (typeof direct === 'string' && direct) return direct;
    const url = typeof fm?.originalUrl === 'string' ? fm.originalUrl : fallbackUrl;
    return extractYouTubeVideoId(url) ?? undefined;
  }

  /** Runs an API call; failures become a Notice + CaptionLanguageError. */
  private async call<T>(language: string | undefined, fn: (api: CaptionApi) => Promise<T>): Promise<T> {
    const api = this.deps.apiClient();
    if (!api) {
      this.deps.notify(t('tlang.signIn'));
      throw new CaptionLanguageError('API client unavailable');
    }
    try {
      return await fn(api);
    } catch (error) {
      this.deps.notify(captionErrorMessage(error, language));
      throw new CaptionLanguageError(error instanceof Error ? error.message : String(error));
    }
  }
}
