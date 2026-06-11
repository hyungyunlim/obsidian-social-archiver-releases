/**
 * localOnlyNoteGuard — Unit Tests
 *
 * Verifies the sync-exclusion contract primitives (PRD S5.1):
 * - Exact match on 'local-only' only — 'imported' and absent keys pass through
 * - MetadataCache-based check (isLocalOnlyNote)
 * - Raw-content check (isLocalOnlyNoteByContent): frontmatter-block scoping,
 *   optional YAML quoting, CRLF tolerance
 */

import { describe, it, expect, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  isLocalOnlyImportMode,
  isLocalOnlyFrontmatter,
  isLocalOnlyNote,
  isLocalOnlyNoteByContent,
} from '../localOnlyNoteGuard';
import {
  IMPORT_MODE_FRONTMATTER_KEY,
  IMPORT_MODE_LOCAL_ONLY,
  IMPORT_MODE_IMPORTED,
} from '../../../services/import/local/LocalArchiveScanner';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFileWithContent(content: string): TFile {
  return {
    path: 'Social Archives/clip.md',
    extension: 'md',
    vault: { cachedRead: vi.fn().mockResolvedValue(content) },
  } as unknown as TFile;
}

function makeAppWithFrontmatter(frontmatter: Record<string, unknown> | undefined): App {
  return {
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue(frontmatter !== undefined ? { frontmatter } : null),
    },
  } as unknown as App;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isLocalOnlyImportMode', () => {
  it("returns true for the exact 'local-only' value", () => {
    expect(isLocalOnlyImportMode(IMPORT_MODE_LOCAL_ONLY)).toBe(true);
  });

  it("returns false for 'imported'", () => {
    expect(isLocalOnlyImportMode(IMPORT_MODE_IMPORTED)).toBe(false);
  });

  it('returns false for undefined / null / non-string values', () => {
    expect(isLocalOnlyImportMode(undefined)).toBe(false);
    expect(isLocalOnlyImportMode(null)).toBe(false);
    expect(isLocalOnlyImportMode(true)).toBe(false);
  });

  it('never matches by mere key presence (case-variant value)', () => {
    expect(isLocalOnlyImportMode('LOCAL-ONLY')).toBe(false);
  });
});

describe('isLocalOnlyFrontmatter', () => {
  it('returns true when the import-mode key is local-only', () => {
    expect(
      isLocalOnlyFrontmatter({ [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY }),
    ).toBe(true);
  });

  it('returns false when the import-mode key is imported', () => {
    expect(
      isLocalOnlyFrontmatter({ [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_IMPORTED }),
    ).toBe(false);
  });

  it('returns false when the key is absent or frontmatter is missing', () => {
    expect(isLocalOnlyFrontmatter({ originalUrl: 'https://example.com/p/1' })).toBe(false);
    expect(isLocalOnlyFrontmatter(undefined)).toBe(false);
    expect(isLocalOnlyFrontmatter(null)).toBe(false);
  });

  it('treats a note with a sourceArchiveId as server-backed even when marked local-only', () => {
    // sourceArchiveId wins (module header): otherwise the marker would skip
    // outbound sync while inbound by-id sync keeps writing — divergence.
    expect(
      isLocalOnlyFrontmatter({
        [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY,
        sourceArchiveId: 'arch-1',
      }),
    ).toBe(false);
    expect(
      isLocalOnlyFrontmatter({
        [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY,
        sourceArchiveId: '',
      }),
    ).toBe(true);
  });
});

describe('isLocalOnlyNote', () => {
  const file = { path: 'note.md' } as unknown as TFile;

  it('returns true for a cached local-only note', () => {
    const app = makeAppWithFrontmatter({ [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY });
    expect(isLocalOnlyNote(app, file)).toBe(true);
  });

  it('returns false for an imported note', () => {
    const app = makeAppWithFrontmatter({ [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_IMPORTED });
    expect(isLocalOnlyNote(app, file)).toBe(false);
  });

  it('returns false when there is no cache entry', () => {
    const app = makeAppWithFrontmatter(undefined);
    expect(isLocalOnlyNote(app, file)).toBe(false);
  });
});

describe('isLocalOnlyNoteByContent', () => {
  it('detects an unquoted local-only value', async () => {
    const file = makeFileWithContent(
      `---\noriginalUrl: https://example.com/p/1\n${IMPORT_MODE_FRONTMATTER_KEY}: local-only\n---\n\nBody`,
    );
    await expect(isLocalOnlyNoteByContent(file)).resolves.toBe(true);
  });

  it('detects single- and double-quoted local-only values', async () => {
    const single = makeFileWithContent(
      `---\n${IMPORT_MODE_FRONTMATTER_KEY}: 'local-only'\n---\nBody`,
    );
    const double = makeFileWithContent(
      `---\n${IMPORT_MODE_FRONTMATTER_KEY}: "local-only"\n---\nBody`,
    );
    await expect(isLocalOnlyNoteByContent(single)).resolves.toBe(true);
    await expect(isLocalOnlyNoteByContent(double)).resolves.toBe(true);
  });

  it('tolerates CRLF line endings', async () => {
    const file = makeFileWithContent(
      `---\r\n${IMPORT_MODE_FRONTMATTER_KEY}: local-only\r\n---\r\n\r\nBody`,
    );
    await expect(isLocalOnlyNoteByContent(file)).resolves.toBe(true);
  });

  it("returns false for an 'imported' note", async () => {
    const file = makeFileWithContent(
      `---\n${IMPORT_MODE_FRONTMATTER_KEY}: imported\n---\nBody`,
    );
    await expect(isLocalOnlyNoteByContent(file)).resolves.toBe(false);
  });

  it('returns false when the key is absent', async () => {
    const file = makeFileWithContent('---\noriginalUrl: https://example.com/p/1\n---\nBody');
    await expect(isLocalOnlyNoteByContent(file)).resolves.toBe(false);
  });

  it('returns false when there is no frontmatter block', async () => {
    const file = makeFileWithContent('Just a body mentioning local-only.');
    await expect(isLocalOnlyNoteByContent(file)).resolves.toBe(false);
  });

  it('ignores the key when it only appears in the body', async () => {
    const file = makeFileWithContent(
      `---\noriginalUrl: https://example.com/p/1\n---\n${IMPORT_MODE_FRONTMATTER_KEY}: local-only`,
    );
    await expect(isLocalOnlyNoteByContent(file)).resolves.toBe(false);
  });

  it('treats a note with a sourceArchiveId as server-backed even when marked local-only', async () => {
    const file = makeFileWithContent(
      `---\nsourceArchiveId: arch-1\n${IMPORT_MODE_FRONTMATTER_KEY}: local-only\n---\nBody`,
    );
    await expect(isLocalOnlyNoteByContent(file)).resolves.toBe(false);
  });
});
