import { TFile, normalizePath, type App } from 'obsidian';
import type { ManagedArchiveTagRule } from '@/types/settings';
import { AUTHOR_NOTE_TYPE } from '@/types/author-note';
import { AuthorVaultScanner } from '@/services/AuthorVaultScanner';
import { AuthorDeduplicator } from '@/services/AuthorDeduplicator';
import type { AuthorNoteService } from '@/services/AuthorNoteService';
import {
  buildManagedArchiveTag,
  getManagedArchiveTagCandidates,
} from '@/utils/archive-tag-rules';
import { buildAuthorNoteLinkForCatalogEntry } from '@/utils/author-note-links';

export interface BackfillResult {
  scanned: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface MainTagBackfillOptions {
  currentRule: ManagedArchiveTagRule;
  history: ManagedArchiveTagRule[];
}

export interface AuthorLinkPreview {
  scanned: number;
  authors: number;
  eligibleFiles: number;
  missingAuthorNotes: number;
  skipped: number;
  failed: number;
}

export interface AuthorLinkBackfillResult extends BackfillResult {
  authors: number;
  authorNotesCreated: number;
}

interface MainTagPlan {
  status: 'update' | 'unchanged' | 'skip';
  tags?: string[];
}

export class ArchiveNoteBackfillService {
  constructor(
    private readonly app: App,
    private readonly archivePath: string,
  ) {}

  async previewMainTag(options: MainTagBackfillOptions): Promise<BackfillResult> {
    const result: BackfillResult = {
      scanned: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    };

    for (const file of this.getArchiveFiles()) {
      result.scanned++;
      try {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const plan = this.planMainTagUpdate(frontmatter, options);
        if (plan.status === 'update') result.updated++;
        else if (plan.status === 'unchanged') result.unchanged++;
        else result.skipped++;
      } catch {
        result.failed++;
      }
    }
    return result;
  }

  async applyMainTag(options: MainTagBackfillOptions): Promise<BackfillResult> {
    const result: BackfillResult = {
      scanned: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    };

    for (const file of this.getArchiveFiles()) {
      result.scanned++;
      try {
        const initialPlan = this.planMainTagUpdate(
          this.app.metadataCache.getFileCache(file)?.frontmatter,
          options,
        );
        if (initialPlan.status === 'skip') {
          result.skipped++;
          continue;
        }
        if (initialPlan.status === 'unchanged') {
          result.unchanged++;
          continue;
        }

        const outcome: { status: MainTagPlan['status'] } = { status: 'skip' };
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          const plan = this.planMainTagUpdate(frontmatter, options);
          outcome.status = plan.status;
          if (plan.status !== 'update' || !plan.tags) return;
          if (plan.tags.length > 0) frontmatter.tags = plan.tags;
          else delete frontmatter.tags;
        });
        if (outcome.status === 'update') result.updated++;
        else if (outcome.status === 'unchanged') result.unchanged++;
        else result.skipped++;
      } catch (error) {
        console.warn('[ArchiveNoteBackfillService] Main tag update failed:', file.path, error);
        result.failed++;
      }
    }
    return result;
  }

  async previewAuthorLinks(noteService: AuthorNoteService): Promise<AuthorLinkPreview> {
    const { scanResult, authors } = await this.scanAuthors();
    let missingAuthorNotes = 0;
    let eligibleFiles = 0;
    for (const author of authors) {
      eligibleFiles += author.filePaths?.length ?? 0;
      const existing = noteService.findNote(author.authorUrl, author.authorName, author.platform)
        || noteService.findNote(undefined, author.authorName, author.platform);
      if (!existing) missingAuthorNotes++;
    }
    return {
      scanned: scanResult.totalFilesScanned,
      authors: authors.length,
      eligibleFiles,
      missingAuthorNotes,
      skipped: Math.max(0, scanResult.filesSkipped - scanResult.errors.length),
      failed: scanResult.errors.length,
    };
  }

  async applyAuthorLinks(
    noteService: AuthorNoteService,
    aliasFormat: string,
  ): Promise<AuthorLinkBackfillResult> {
    const { scanResult, authors } = await this.scanAuthors();
    const result: AuthorLinkBackfillResult = {
      scanned: scanResult.totalFilesScanned,
      authors: authors.length,
      authorNotesCreated: 0,
      updated: 0,
      unchanged: 0,
      skipped: Math.max(0, scanResult.filesSkipped - scanResult.errors.length),
      failed: scanResult.errors.length,
    };

    for (const author of authors) {
      try {
        const existing = noteService.findNote(author.authorUrl, author.authorName, author.platform)
          || noteService.findNote(undefined, author.authorName, author.platform);
        const noteFile = await noteService.upsertFromCatalogEntry(author);
        if (!noteFile) {
          result.skipped += author.filePaths?.length ?? 0;
          continue;
        }
        if (!existing) result.authorNotesCreated++;

        const link = buildAuthorNoteLinkForCatalogEntry(
          author,
          noteFile.path,
          noteService.readNote(noteFile),
          aliasFormat,
        );
        for (const filePath of author.filePaths ?? []) {
          const file = this.app.vault.getFileByPath(normalizePath(filePath));
          if (!(file instanceof TFile)) {
            result.skipped++;
            continue;
          }
          try {
            const cachedFrontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (cachedFrontmatter?.type === AUTHOR_NOTE_TYPE) {
              result.skipped++;
              continue;
            }
            if (cachedFrontmatter?.authorNote === link) {
              result.unchanged++;
              continue;
            }
            let changed = false;
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
              if (frontmatter.type === AUTHOR_NOTE_TYPE) return;
              if (frontmatter.authorNote === link) return;
              frontmatter.authorNote = link;
              changed = true;
            });
            if (changed) result.updated++;
            else result.unchanged++;
          } catch (error) {
            console.warn('[ArchiveNoteBackfillService] Author link update failed:', file.path, error);
            result.failed++;
          }
        }
      } catch (error) {
        console.warn('[ArchiveNoteBackfillService] Author link author failed:', author.authorName, error);
        result.failed += Math.max(1, author.filePaths?.length ?? 0);
      }
    }
    return result;
  }

  private async scanAuthors() {
    const scanner = new AuthorVaultScanner({
      app: this.app,
      archivePath: this.archivePath,
      includeEmbeddedArchives: false,
      yieldToUi: true,
    });
    const scanResult = await scanner.scanVault();
    const authors = new AuthorDeduplicator().deduplicate(scanResult.authors, new Map()).authors;
    return { scanResult, authors };
  }

  private getArchiveFiles(): TFile[] {
    const prefix = normalizePath(this.archivePath).replace(/\/+$/, '');
    return this.app.vault.getMarkdownFiles().filter((file) =>
      file.path.startsWith(`${prefix}/`)
    );
  }

  private planMainTagUpdate(
    frontmatter: Record<string, unknown> | undefined,
    options: MainTagBackfillOptions,
  ): MainTagPlan {
    if (!frontmatter || frontmatter.type === AUTHOR_NOTE_TYPE) return { status: 'skip' };
    if (typeof frontmatter.platform !== 'string' || !frontmatter.platform.trim()) {
      return { status: 'skip' };
    }

    const source = { platform: frontmatter.platform, published: frontmatter.published };
    const nextTag = buildManagedArchiveTag(options.currentRule, source, {
      strictYearMonth: true,
    });
    if (
      options.currentRule.tagRoot.trim()
      && options.currentRule.tagOrganization === 'platform-year-month'
      && !nextTag
    ) {
      return { status: 'skip' };
    }

    const tags = this.normalizeTags(frontmatter.tags);
    const candidates = getManagedArchiveTagCandidates(options.currentRule, options.history, source);
    const nextTags = tags.filter((tag) => !candidates.has(tag.toLowerCase()));
    if (nextTag && !nextTags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      nextTags.push(nextTag);
    }

    if (tags.length === nextTags.length && tags.every((tag, index) => tag === nextTags[index])) {
      return { status: 'unchanged' };
    }
    return { status: 'update', tags: nextTags };
  }

  private normalizeTags(value: unknown): string[] {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return values
      .map((tag) => typeof tag === 'string' ? tag.trim() : '')
      .filter(Boolean);
  }
}
