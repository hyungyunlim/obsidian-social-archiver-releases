import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { ArchiveNoteBackfillService } from '@/services/ArchiveNoteBackfillService';

function createContext(initial: Record<string, Record<string, unknown>>) {
  const frontmatterByPath = new Map(Object.entries(initial));
  const files = Array.from(frontmatterByPath.keys()).map((path) => new TFile(path));
  const app = {
    vault: {
      getMarkdownFiles: vi.fn(() => files),
      getFileByPath: vi.fn((path: string) => files.find((file) => file.path === path) ?? null),
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => ({
        frontmatter: frontmatterByPath.get(file.path),
      })),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (file: TFile, update: (fm: Record<string, unknown>) => void) => {
        const frontmatter = frontmatterByPath.get(file.path);
        if (frontmatter) update(frontmatter);
      }),
    },
  } as unknown as App;
  return { app, frontmatterByPath };
}

describe('ArchiveNoteBackfillService main tag backfill', () => {
  it('replaces exact managed tags while preserving unrelated tags and archiveTags', async () => {
    const { app, frontmatterByPath } = createContext({
      'Social Archives/x/post.md': {
        platform: 'x',
        published: '2024-03-15 10:30',
        tags: ['old-root/x/2024/03', 'Personal', 'old-root/manual'],
        archiveTags: ['server/topic'],
      },
      'Other/note.md': {
        platform: 'x',
        tags: ['old-root'],
      },
    });
    const service = new ArchiveNoteBackfillService(app, 'Social Archives');
    const options = {
      currentRule: { tagRoot: 'new-root', tagOrganization: 'platform-only' as const },
      history: [{ tagRoot: 'old-root', tagOrganization: 'platform-year-month' as const }],
    };

    const preview = await service.previewMainTag(options);
    expect(preview).toMatchObject({ scanned: 1, updated: 1, failed: 0 });

    const result = await service.applyMainTag(options);
    expect(result.updated).toBe(1);
    expect(frontmatterByPath.get('Social Archives/x/post.md')).toMatchObject({
      tags: ['Personal', 'old-root/manual', 'new-root/x'],
      archiveTags: ['server/topic'],
    });

    const second = await service.applyMainTag(options);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  it('removes only known managed tags when the current root is empty', async () => {
    const { app, frontmatterByPath } = createContext({
      'Social Archives/post.md': {
        platform: 'instagram',
        published: '2025-01-02',
        tags: ['archive/instagram', 'archive/custom', 'Keep'],
      },
    });
    const service = new ArchiveNoteBackfillService(app, 'Social Archives');
    await service.applyMainTag({
      currentRule: { tagRoot: '', tagOrganization: 'flat' },
      history: [{ tagRoot: 'archive', tagOrganization: 'platform-only' }],
    });

    expect(frontmatterByPath.get('Social Archives/post.md')?.tags)
      .toEqual(['archive/custom', 'Keep']);
  });
});
