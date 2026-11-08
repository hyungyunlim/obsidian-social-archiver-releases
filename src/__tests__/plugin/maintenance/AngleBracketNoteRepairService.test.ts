import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  AngleBracketNoteRepairService,
  isRepairableArchiveNote,
  repairArchiveNoteBody,
} from '@/plugin/maintenance/AngleBracketNoteRepairService';
import type { SocialArchiverSettings } from '@/types/settings';

const IG = '---\nplatform: instagram\nsourceArchiveId: a1\n---\n';
const TAIL = '---\n\n<!-- sa:media:start id=a1 -->\n![image 1](a.jpg)\n<!-- sa:media:end -->\n\n---\n\n**Author:** <b>x</b>\n';

describe('repairArchiveNoteBody', () => {
  it('fixes the post text only, never the media markers or what follows', () => {
    const note = `${IG}\nWorkshop\n<Brass clip customisation workshop>\nDate: 28th July\n\n${TAIL}`;
    expect(repairArchiveNoteBody(note))
      .toBe(`${IG}\nWorkshop\n\\<Brass clip customisation workshop>\nDate: 28th July\n\n${TAIL}`);
  });

  it('keeps media markers a template wrote inside the post text (YouTube)', () => {
    const note = `${IG}\n<!-- sa:media:start id=a1 -->\n![video](v.mp4)\n<!-- sa:media:end -->\n\n<Hang On>\n\n${TAIL}`;
    expect(repairArchiveNoteBody(note))
      .toBe(`${IG}\n<!-- sa:media:start id=a1 -->\n![video](v.mp4)\n<!-- sa:media:end -->\n\n\\<Hang On>\n\n${TAIL}`);
  });

  it('turns an `&lt;` the 4.7.11 writer left into `\\<`', () => {
    expect(repairArchiveNoteBody(`${IG}\n&lt;untitled>\n\n${TAIL}`)).toBe(`${IG}\n\\<untitled>\n\n${TAIL}`);
  });

  it('returns null with nothing to fix, or without the rule that ends the post text', () => {
    expect(repairArchiveNoteBody(`${IG}\nI <3 it\n\n${TAIL}`)).toBeNull();
    expect(repairArchiveNoteBody(`${IG}\n<untitled>\n`)).toBeNull();
    expect(repairArchiveNoteBody('<untitled>\n---\n')).toBeNull();
  });
});

describe('isRepairableArchiveNote', () => {
  it('takes archived social posts only', () => {
    expect(isRepairableArchiveNote({ platform: 'instagram', sourceArchiveId: 'a' })).toBe(true);
    expect(isRepairableArchiveNote({ platform: 'x', originalUrl: 'https://x.com/a/status/1' })).toBe(true);
    expect(isRepairableArchiveNote({ platform: 'web', originalUrl: 'https://a.com' })).toBe(false);
    expect(isRepairableArchiveNote({ platform: 'post', sourceArchiveId: 'a' })).toBe(false);
    expect(isRepairableArchiveNote({ platform: 'instagram' })).toBe(false);
    expect(isRepairableArchiveNote({ platform: 'x', originalUrl: 'u', social_archiver_import_source: 'browser-clip:reader' })).toBe(false);
    expect(isRepairableArchiveNote({ platform: 'instagram', sourceArchiveId: 'a', userHighlightCount: 2 })).toBe(false);
  });
});

describe('AngleBracketNoteRepairService', () => {
  function harness(files: Record<string, string>, open: string[] = []) {
    const tfiles = Object.keys(files).map((path) => ({ path }) as TFile);
    const settings = { angleBracketRepairDone: undefined } as Partial<SocialArchiverSettings>;
    const app = {
      vault: {
        getMarkdownFiles: () => tfiles,
        cachedRead: async (file: TFile) => files[file.path],
        process: async (file: TFile, fn: (text: string) => string) => {
          files[file.path] = fn(files[file.path] ?? '');
          return files[file.path];
        },
      },
      metadataCache: {
        getFileCache: (file: TFile) => ({
          frontmatter: files[file.path]?.startsWith(IG) ? { platform: 'instagram', sourceArchiveId: 'a1' } : { platform: 'web', originalUrl: 'u' },
        }),
      },
    } as unknown as App;
    const saveSettings = vi.fn(async () => undefined);
    const service = new AngleBracketNoteRepairService({
      app,
      settings: () => settings as SocialArchiverSettings,
      saveSettings,
      waitForIndex: async () => undefined,
      isOpen: (path) => open.includes(path),
    });
    return { files, settings, saveSettings, service };
  }

  it('repairs once, leaves other notes byte for byte, then remembers it is done', async () => {
    const web = '---\nplatform: web\n---\n<div>kept</div>\n---\n';
    const h = harness({ 'a.md': `${IG}\n<Hang On>\n\n${TAIL}`, 'w.md': web });
    await h.service.runIfNeeded();
    expect(h.files['a.md']).toBe(`${IG}\n\\<Hang On>\n\n${TAIL}`);
    expect(h.files['w.md']).toBe(web);
    expect(h.settings.angleBracketRepairDone).toBe(true);
    expect(h.saveSettings).toHaveBeenCalledTimes(1);

    await h.service.runIfNeeded();
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('skips a note open in the editor and runs again next load', async () => {
    const h = harness({ 'a.md': `${IG}\n<Hang On>\n\n${TAIL}` }, ['a.md']);
    await h.service.runIfNeeded();
    expect(h.files['a.md']).toContain('\n<Hang On>');
    expect(h.settings.angleBracketRepairDone).toBeUndefined();
  });
});
