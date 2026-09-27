import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, Component } from 'obsidian';
import { TFile } from 'obsidian';
import type SocialArchiverPlugin from '../../../main';
import type { PostData } from '../../../types/post';

const parseFile = vi.fn();
const readers: Array<{ posts: PostData[]; currentIndex: number }> = [];

vi.mock('../../../components/timeline/parsers/PostDataParser', () => ({
  PostDataParser: class {
    parseFile = parseFile;
  },
}));
vi.mock('../../../components/timeline/reader/ReaderModeOverlay', () => ({
  ReaderModeOverlay: class {
    constructor(context: { posts: PostData[]; currentIndex: number }) {
      readers.push(context);
    }
    open = vi.fn();
  },
}));
vi.mock('../../../components/timeline/renderers/PreviewableCardRenderer', () => ({
  PreviewableCardRenderer: class {
    render = vi.fn(async (container: HTMLElement) => {
      const card = container.createDiv({ cls: 'pcr-card' });
      card.createDiv({ cls: 'pcr-media-hero pcr-preview-media pcr-preview-media--text' });
      return card;
    });
  },
}));
vi.mock('../../../components/timeline/renderers/MediaGalleryRenderer', () => ({ MediaGalleryRenderer: class {} }));
vi.mock('../../../components/timeline/renderers/LinkPreviewRenderer', () => ({ LinkPreviewRenderer: class {} }));

const { ReviewCardHost } = await import('../ReviewCardHost');

/** The obsidian mock's TFile takes its path. */
const MockFile = TFile as unknown as new (path: string) => TFile;
const note = (path: string): TFile => new MockFile(path);

function setup(notes: Record<string, TFile>): {
  host: InstanceType<typeof ReviewCardHost>;
  fire: (name: string, ...args: unknown[]) => void;
} {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const app = {
    vault: {
      on: (name: string, callback: (...args: unknown[]) => void): object => {
        handlers.set(name, callback);
        return {};
      },
      adapter: { getResourcePath: (path: string): string => `app://${path}` },
      getAbstractFileByPath: (): null => null,
    },
    workspace: {},
    metadataCache: {},
  } as unknown as App;
  const host = new ReviewCardHost({
    app,
    plugin: { settings: { workerUrl: '' } } as unknown as SocialArchiverPlugin,
    component: { registerEvent: vi.fn() } as unknown as Component,
    noteFor: (archiveId): TFile | null => notes[archiveId] ?? null,
  });
  return { host, fire: (name, ...args): void => handlers.get(name)?.(...args) };
}

describe('ReviewCardHost', () => {
  beforeEach(() => {
    parseFile.mockReset();
    parseFile.mockImplementation(async (file: TFile) => ({ filePath: file.path, media: [] }) as unknown as PostData);
    readers.length = 0;
  });

  it('reads a note once, and again after the note changes', async () => {
    const { host, fire } = setup({ a: note('Social Archives/a.md'), b: note('Social Archives/b.md') });

    await host.postFor('a');
    await host.postFor('a');
    expect(parseFile).toHaveBeenCalledTimes(1);

    // An AI comment written into another note leaves this one cached.
    fire('modify', note('Social Archives/b.md'));
    await host.postFor('a');
    expect(parseFile).toHaveBeenCalledTimes(1);

    fire('modify', note('Social Archives/a.md'));
    await host.postFor('a');
    expect(parseFile).toHaveBeenCalledTimes(2);

    fire('rename', note('Social Archives/renamed.md'), 'Social Archives/a.md');
    await host.postFor('a');
    expect(parseFile).toHaveBeenCalledTimes(3);
  });

  it('has no post for an archive that is not in this vault', async () => {
    const { host } = setup({});
    await expect(host.postFor('elsewhere')).resolves.toBeNull();
    expect(parseFile).not.toHaveBeenCalled();
  });

  it('opens the reader on the asked post, over the posts that are in this vault', async () => {
    const { host } = setup({ a: note('a.md'), c: note('c.md') });

    await host.openReader(['a', 'missing', 'a', 'c'], 'c');

    expect(readers).toHaveLength(1);
    expect(readers[0]?.posts.map((post) => post.filePath)).toEqual(['a.md', 'c.md']);
    expect(readers[0]?.currentIndex).toBe(1);
  });

  it('opens no reader when the asked post is not in this vault', async () => {
    const { host } = setup({ a: note('a.md') });
    await host.openReader(['a', 'missing'], 'missing');
    expect(readers).toHaveLength(0);
  });

  it('drops the gallery’s text-only frame from a single card', async () => {
    const { host } = setup({});
    const container = activeWindow.createDiv();

    await host.renderCard(container, { media: [] } as unknown as PostData);

    expect(container.querySelector('.pcr-card')).not.toBeNull();
    expect(container.querySelector('.pcr-preview-media--text')).toBeNull();
  });
});
