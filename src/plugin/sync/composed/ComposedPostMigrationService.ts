/**
 * One-time move of existing composed notes onto two-way sync, and the actions
 * for the notes it could not decide (prd-plugin-my-posts-two-way-sync §5.6).
 *
 * Per server row with a note and no baseline yet:
 * - same text (normalized) → adopt: baseline only, the body is not touched
 * - the plugin's post, unchanged since its last push → pull (only the server moved)
 * - anything else → `syncState: diverged`, for the user to choose
 *
 * Rows are idempotent, so a failed row is retried on the next load; the flag
 * is set only after a run with no failure.
 */

import type { App, TFile } from 'obsidian';
import type { UserArchive, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../../services/ArchiveLookupService';
import type { SocialArchiverSettings } from '../../../types/settings';
import { PostDataParser } from '../../../components/timeline/parsers/PostDataParser';
import { stripHighlightMarks } from '../../../components/timeline/reader/ReaderHighlightManager';
import { LocationBodyBlock } from '../../../services/markdown/LocationBodyBlock';
import { ProductBodyBlock } from '../../../services/markdown/ProductBodyBlock';
import { COMPOSED_MEDIA_NOTE_TYPES, isComposedPostNote } from '../../../utils/composedPostNote';
import {
  djb2,
  isComposedServerRow,
  isSyncableComposedNote,
  readComposedNote,
  readNoteFrontmatter,
  sameComposedText,
  serverComposedText,
} from './composedNote';
import type { ComposedPostPullWriter } from './ComposedPostPullWriter';
import type { ComposedConflictCopyWriter } from './ComposedConflictCopyWriter';

const LOG_PREFIX = '[Social Archiver] [ComposedMigration]';
const PAGE_SIZE = 100;

export type ComposedMigrationAction = 'skip' | 'adopt' | 'pull' | 'diverged';

export function classifyComposedMigration(i: { hasBaseline: boolean; textEqual: boolean; pluginUnchangedSincePush: boolean }): ComposedMigrationAction {
  if (i.hasBaseline) return 'skip';
  if (i.textEqual) return 'adopt';
  return i.pluginUnchangedSincePush ? 'pull' : 'diverged';
}

export interface ComposedPostMigrationDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  saveSettings: () => Promise<void>;
  apiClient: () => WorkersAPIClient | undefined;
  lookup: () => ArchiveLookupService | undefined;
  waitForLookupIndex: () => Promise<void>;
  withArchiveWriteLocks: <T>(archiveId: string, fn: () => Promise<T>) => Promise<T>;
  pullWriter: ComposedPostPullWriter;
  conflictWriter: ComposedConflictCopyWriter;
  /** PUT the note as it is, without a base revision, and stamp the baseline (ComposedPostSyncService.pushNote). Takes no locks. */
  pushNote: (file: TFile, opts: { baseContentRevision?: number }) => Promise<void>;
  /** A note open in an editor is never rewritten by the migration: that row waits for the next load. */
  isOpen?: (path: string) => boolean;
  /** Repaints highlight marks after a rewrite. */
  afterPull?: (file: TFile, archive: UserArchive) => Promise<void>;
}

// ponytail: delete once every vault has migrated. The pre-two-way fingerprint
// formula, so a plugin post untouched since its last push is recognised.
// Contract C6 keeps PostDataParser.extractContentText and parseFile().media stable.
async function legacyComposedPost(
  app: App,
  file: TFile,
  raw: string,
  fm: Record<string, unknown>,
): Promise<{ fingerprint: string; text: string } | null> {
  const parser = new PostDataParser(app.vault, app);
  const parsed = await parser.parseFile(file);
  if (!parsed) return null;
  const withoutLocations = LocationBodyBlock.parse(raw) ? LocationBodyBlock.strip(raw) : raw;
  const content = ProductBodyBlock.has(withoutLocations) ? ProductBodyBlock.strip(withoutLocations) : withoutLocations;
  const fmTitle = typeof fm['title'] === 'string' && fm['title'] ? fm['title'] : undefined;
  const title = fmTitle
    ?? content.replace(/^---\n[\s\S]*?\n---\n?/, '').match(/^\s*#\s+([^\n]+)(?:\n|$)/)?.[1]?.trim()
    ?? null;
  const text = stripHighlightMarks(parser.extractContentText(content)).canonical
    .replace(/(?:(?:^|\n)\s*---)+$/, '')
    .trimEnd();
  return { fingerprint: djb2(JSON.stringify([title, text, parsed.media.map((m) => m.url)])), text };
}

export class ComposedPostMigrationService {
  private running: Promise<void> | null = null;

  constructor(private readonly deps: ComposedPostMigrationDeps) {}

  /** Once per account and vault; skipped when composedPostMigrationDoneFor is this user. */
  runIfNeeded(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Composed notes waiting on the user. */
  listDivergedNotes(): TFile[] {
    return this.deps.app.vault.getMarkdownFiles().filter((file) => {
      const fm = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
      return isComposedPostNote(fm) && fm?.['syncState'] === 'diverged';
    });
  }

  /** Keeps the vault text as a conflict copy, then writes the server version. */
  async useServerVersion(file: TFile): Promise<void> {
    const archiveId = this.archiveIdOf(file);
    const api = this.requireApi();
    const { archive } = await api.getUserArchive(archiveId);
    await this.deps.withArchiveWriteLocks(archiveId, async () => {
      await this.deps.conflictWriter.write(file);
      await this.pull(file, archive);
    });
  }

  /** Replaces the server copy with the note: PUT without a base revision, then adopt. */
  async sendVaultVersion(file: TFile): Promise<void> {
    const archiveId = this.archiveIdOf(file);
    this.requireApi();
    await this.deps.withArchiveWriteLocks(archiveId, () => this.deps.pushNote(file, {}));
  }

  private async run(): Promise<void> {
    const settings = this.deps.settings();
    const username = settings.username;
    const api = this.deps.apiClient();
    if (!username || !api || settings.composedPostMigrationDoneFor === username) return;

    await this.deps.waitForLookupIndex();
    let failed = 0;
    let offset = 0;
    try {
      for (;;) {
        const page = await api.getUserArchives({ archiveSource: 'composed', limit: PAGE_SIZE, offset });
        for (const row of page.archives) {
          if (!isComposedServerRow(row)) continue;
          try {
            if (!(await this.migrateRow(row))) failed += 1;
          } catch (error) {
            failed += 1;
            console.warn(`${LOG_PREFIX} Row failed, retried next load: ${row.id}`, error);
          }
        }
        if (!page.hasMore || page.archives.length === 0) break;
        offset += page.archives.length;
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} Listing composed posts failed, retried next load:`, error);
      return;
    }

    if (failed > 0) return;
    // Fresh object: saveSettingsPartial swaps it on every save.
    this.deps.settings().composedPostMigrationDoneFor = username;
    await this.deps.saveSettings();
  }

  /** False when the row must wait for the next load (its note is open in an editor). */
  private async migrateRow(row: UserArchive): Promise<boolean> {
    const lookup = this.deps.lookup();
    const file = lookup?.findBySourceArchiveId(row.id) ?? lookup?.findByClientPostId(row.postId) ?? null;
    // No note: library sync's Tier 3 creates one, already stamped.
    if (!file) return true;

    return this.deps.withArchiveWriteLocks(row.id, async () => {
      const raw = await this.deps.app.vault.read(file);
      const parts = readComposedNote(raw);
      if (!isSyncableComposedNote(parts)) {
        console.warn(`${LOG_PREFIX} CRLF note or note without its author line left out of two-way sync: ${file.path}`);
        return true;
      }
      const fm: Record<string, unknown> = readNoteFrontmatter(raw)
        ?? this.deps.app.metadataCache.getFileCache(file)?.frontmatter
        ?? {};
      const contentType = fm['contentType'];
      if (typeof contentType === 'string' && COMPOSED_MEDIA_NOTE_TYPES.has(contentType)) return true;

      const hasBaseline = typeof fm['syncedContentRevision'] === 'number';
      const serverText = serverComposedText(row);
      const textEqual = !hasBaseline && sameComposedText(parts.text, serverText);
      const legacy = !hasBaseline && !textEqual && typeof fm['syncedContentHash'] === 'string'
        ? await legacyComposedPost(this.deps.app, file, raw, fm)
        : null;
      const pluginUnchangedSincePush = legacy?.fingerprint === fm['syncedContentHash'];

      switch (classifyComposedMigration({ hasBaseline, textEqual, pluginUnchangedSincePush })) {
        case 'skip':
          return true;
        case 'adopt':
          if (parts.text === serverText) {
            await this.deps.pullWriter.stampBaseline(file, row);
            return true;
          }
          // Equal only once normalized: the 4.11 writer's escapes (\#, 1\., &lt;,
          // [#tag](…)) or whitespace. The note takes the server's bytes, or the
          // next edit would push those escapes to every other client (§5.5).
          if (this.deps.isOpen?.(file.path)) return false;
          await this.pull(file, row);
          return true;
        case 'pull':
          if (this.deps.isOpen?.(file.path)) return false;
          // The old sync never sent some of the note (a leading heading, text
          // after a mid-body media section): keep it as a conflict copy.
          if (legacy && !sameComposedText(parts.text, legacy.text)) await this.deps.conflictWriter.write(file);
          await this.pull(file, row);
          return true;
        case 'diverged':
          await this.deps.app.fileManager.processFrontMatter(file, (target: Record<string, unknown>) => {
            target['syncState'] = 'diverged';
            target['postOrigin'] = 'composer';
            target['clientPostId'] = row.postId;
            target['sourceArchiveId'] = row.id;
          });
          return true;
      }
    });
  }

  private async pull(file: TFile, archive: UserArchive): Promise<void> {
    await this.deps.pullWriter.write(file, archive);
    await this.deps.afterPull?.(file, archive);
  }

  private archiveIdOf(file: TFile): string {
    const id: unknown = this.deps.app.metadataCache.getFileCache(file)?.frontmatter?.['sourceArchiveId'];
    if (typeof id !== 'string' || !id) throw new Error(`No server post for ${file.path}`);
    return id;
  }

  private requireApi(): WorkersAPIClient {
    const api = this.deps.apiClient();
    if (!api) throw new Error('Not signed in');
    return api;
  }
}
