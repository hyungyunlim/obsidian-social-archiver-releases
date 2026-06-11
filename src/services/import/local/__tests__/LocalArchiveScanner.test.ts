/**
 * Unit tests for LocalArchiveScanner — exact `'local-only'` matching over the
 * metadata cache (prd-plugin-anonymous-local-mode.md S5.1, Resolved Decisions).
 */

import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import {
  LocalArchiveScanner,
  IMPORT_MODE_FRONTMATTER_KEY,
  IMPORT_SOURCE_FRONTMATTER_KEY,
  IMPORT_MODE_LOCAL_ONLY,
  IMPORT_MODE_IMPORTED,
} from '@/services/import/local/LocalArchiveScanner';

function makeApp(
  files: Array<{ path: string; frontmatter?: Record<string, unknown> }>,
): App {
  const tfiles = files.map((spec) => ({ file: new TFile(spec.path), spec }));
  return {
    vault: {
      getMarkdownFiles: () => tfiles.map((t) => t.file),
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const entry = tfiles.find((t) => t.file === file);
        return entry?.spec.frontmatter ? { frontmatter: entry.spec.frontmatter } : null;
      },
    },
  } as unknown as App;
}

describe('LocalArchiveScanner', () => {
  it('matches only notes whose import mode is exactly local-only', () => {
    const app = makeApp([
      {
        path: 'Social Archives/X/local.md',
        frontmatter: {
          [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY,
          [IMPORT_SOURCE_FRONTMATTER_KEY]: 'browser-clip:chrome-extension',
        },
      },
      {
        path: 'Social Archives/X/imported.md',
        frontmatter: {
          [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_IMPORTED,
          [IMPORT_SOURCE_FRONTMATTER_KEY]: 'browser-clip:chrome-extension',
        },
      },
      {
        path: 'Social Archives/X/server.md',
        frontmatter: { platform: 'x', sourceArchiveId: 'arch-1' },
      },
      { path: 'Social Archives/X/no-frontmatter.md' },
    ]);

    const results = new LocalArchiveScanner(app).scan();

    expect(results).toHaveLength(1);
    expect(results[0]!.file.path).toBe('Social Archives/X/local.md');
    expect(results[0]!.importSource).toBe('browser-clip:chrome-extension');
  });

  it('never matches on key presence alone (Resolved Decisions guard)', () => {
    const app = makeApp([
      {
        path: 'Social Archives/X/other-mode.md',
        frontmatter: { [IMPORT_MODE_FRONTMATTER_KEY]: 'server-synced' },
      },
      {
        path: 'Social Archives/X/truthy-non-string.md',
        frontmatter: { [IMPORT_MODE_FRONTMATTER_KEY]: true },
      },
    ]);

    expect(new LocalArchiveScanner(app).scan()).toHaveLength(0);
  });

  it('omits importSource when the frontmatter value is not a string', () => {
    const app = makeApp([
      {
        path: 'Social Archives/X/local.md',
        frontmatter: {
          [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY,
          [IMPORT_SOURCE_FRONTMATTER_KEY]: 42,
        },
      },
    ]);

    const results = new LocalArchiveScanner(app).scan();
    expect(results).toHaveLength(1);
    expect(results[0]!.importSource).toBeUndefined();
  });

  it('count() mirrors scan() length', () => {
    const app = makeApp([
      {
        path: 'a.md',
        frontmatter: { [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY },
      },
      {
        path: 'b.md',
        frontmatter: { [IMPORT_MODE_FRONTMATTER_KEY]: IMPORT_MODE_LOCAL_ONLY },
      },
      { path: 'c.md', frontmatter: { platform: 'x' } },
    ]);

    expect(new LocalArchiveScanner(app).count()).toBe(2);
  });
});
