import type { App, TFile } from 'obsidian';

/** Frontmatter key written by FrontmatterGenerator for clip provenance. */
export const IMPORT_MODE_FRONTMATTER_KEY = 'social_archiver_import_mode';
export const IMPORT_SOURCE_FRONTMATTER_KEY = 'social_archiver_import_source';

/** Import-mode value identifying a note that has never been on the server. */
export const IMPORT_MODE_LOCAL_ONLY = 'local-only';
/** Import-mode value set once a local-only note has been imported (S4.6). */
export const IMPORT_MODE_IMPORTED = 'imported';

export interface LocalOnlyNoteRef {
  file: TFile;
  importSource?: string;
}

/**
 * Finds local-only archive notes (clips and other client-side imports that
 * were never uploaded to the server) via the metadata cache.
 *
 * Matching is an exact `social_archiver_import_mode === 'local-only'` check —
 * never key presence — so notes marked `'imported'` participate in sync and
 * are excluded here. See prd-plugin-anonymous-local-mode.md (S5.1, Resolved
 * Decisions).
 */
export class LocalArchiveScanner {
  constructor(private readonly app: App) {}

  scan(): LocalOnlyNoteRef[] {
    const results: LocalOnlyNoteRef[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;
      if (frontmatter[IMPORT_MODE_FRONTMATTER_KEY] !== IMPORT_MODE_LOCAL_ONLY) continue;
      const importSource: unknown = frontmatter[IMPORT_SOURCE_FRONTMATTER_KEY];
      results.push({
        file,
        ...(typeof importSource === 'string' ? { importSource } : {}),
      });
    }
    return results;
  }

  count(): number {
    return this.scan().length;
  }
}
