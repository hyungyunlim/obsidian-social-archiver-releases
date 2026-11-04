import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { PostData } from '@/types/post';

interface FakePanel {
  post: PostData;
  options: { onDone: () => void; onDialog?: (open: boolean) => void };
  destroyed: boolean;
}

const panels: FakePanel[] = [];

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  setIcon: (): void => undefined,
}));

vi.mock('@/components/ai-chat/AIChatPanel', () => ({
  AIChatPanel: class {
    destroyed = false;
    constructor(_app: unknown, _host: HTMLElement, public options: FakePanel['options'] & { target: { post: PostData } }) {
      panels.push(this as unknown as FakePanel);
    }
    get post(): PostData {
      return this.options.target.post;
    }
    focus(): void {}
    destroy(): void {
      this.destroyed = true;
    }
  },
}));

import { ReaderChatDock, READER_CHAT_WIDTH_KEY, chatPostLabel, type ReaderChatDockOptions } from '@/components/timeline/reader/ReaderChatDock';

function post(id: string, text = `Post ${id}`, title?: string): PostData {
  return { id, filePath: `${id}.md`, title, content: { text }, author: { name: 'Ada' } } as unknown as PostData;
}

interface Setup {
  app: App & { saveLocalStorage: ReturnType<typeof vi.fn> };
  container: HTMLElement;
  onClosed: ReturnType<typeof vi.fn>;
  onDialog: ReturnType<typeof vi.fn>;
  options: ReaderChatDockOptions;
}

function setup(stored: unknown = null): Setup {
  const storage = new Map<string, unknown>([[READER_CHAT_WIDTH_KEY, stored]]);
  const app = {
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: vi.fn((key: string, value: unknown) => storage.set(key, value)),
  } as unknown as App & { saveLocalStorage: ReturnType<typeof vi.fn> };
  const container = document.body.createDiv();
  const onClosed = vi.fn();
  const onDialog = vi.fn();
  const options: ReaderChatDockOptions = {
    app,
    container,
    panelOptions: (p) => ({ target: { post: p } }) as unknown as ReturnType<ReaderChatDockOptions['panelOptions']>,
    onDialog,
    onClosed,
  };
  return { app, container, onClosed, onDialog, options };
}

describe('ReaderChatDock', () => {
  beforeEach(() => {
    panels.length = 0;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('docks beside the article with a header naming the post, and passes the reader its dialogs', () => {
    const { container, options, onDialog } = setup();
    const dock = new ReaderChatDock(options, post('a', 'First line\nsecond line'));
    expect(container.hasClass('has-chat-dock')).toBe(true);
    expect(dock.el.querySelector('.sa-reader-chat-title')?.textContent).toBe('Chat about this post');
    expect(dock.el.querySelector('.sa-reader-chat-subtitle')?.textContent).toBe('First line');
    expect(panels).toHaveLength(1);
    panels[0]?.options.onDialog?.(true);
    expect(onDialog).toHaveBeenCalledWith(true);
  });

  it('closes from its button without asking (the chat stays with its post)', () => {
    const { container, options, onClosed, onDialog } = setup();
    const dock = new ReaderChatDock(options, post('a'));
    (dock.el.querySelector('.sa-reader-chat-close') as HTMLButtonElement).click();
    expect(container.contains(dock.el)).toBe(false);
    expect(container.hasClass('has-chat-dock')).toBe(false);
    expect(panels[0]?.destroyed).toBe(true);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onDialog).not.toHaveBeenCalled();

    dock.destroy();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('goes away when the chat is done (saved)', () => {
    const { container, options, onClosed } = setup();
    const dock = new ReaderChatDock(options, post('a'));
    panels[0]?.options.onDone();
    expect(container.contains(dock.el)).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('shows the chat of whichever post the reader shows', () => {
    const { options } = setup();
    const dock = new ReaderChatDock(options, post('a'));
    dock.followPost(post('b'));
    expect(panels).toHaveLength(2);
    expect(panels[0]?.destroyed).toBe(true);
    expect(panels[1]?.post.id).toBe('b');
    expect(dock.el.querySelector('.sa-reader-chat-subtitle')?.textContent).toBe('Post b');

    // The same post re-rendered keeps its panel; another post always gets its own chat.
    dock.followPost(post('b'));
    expect(panels).toHaveLength(2);
    dock.followPost(post('c'));
    expect(panels).toHaveLength(3);
    expect(dock.el.querySelector('.sa-reader-chat-subtitle')?.textContent).toBe('Post c');
  });

  it('says so when the post has no note to save to', () => {
    const { options } = setup();
    const dock = new ReaderChatDock({ ...options, panelOptions: (): null => null }, post('a'));
    expect(panels).toHaveLength(0);
    expect(dock.el.textContent).toContain('no note to save a chat to');
  });

  it('remembers a dragged width on this device, within bounds', () => {
    const { app, container, options } = setup('500');
    const dock = new ReaderChatDock(options, post('a'));
    expect(container.style.getPropertyValue('--sa-reader-chat-width')).toBe('500px');
    container.getBoundingClientRect = (): DOMRect => ({ right: 1200 }) as DOMRect;

    const handle = dock.el.querySelector('.sa-reader-chat-resize') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 750 }));
    expect(container.style.getPropertyValue('--sa-reader-chat-width')).toBe('450px');
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100 }));
    expect(container.style.getPropertyValue('--sa-reader-chat-width')).toBe('720px');
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(app.saveLocalStorage).toHaveBeenCalledWith(READER_CHAT_WIDTH_KEY, '720');

    const fallback = setup('not-a-number');
    new ReaderChatDock(fallback.options, post('b'));
    expect(fallback.container.style.getPropertyValue('--sa-reader-chat-width')).toBe('400px');
  });

  it('toggles the phone sheet between half and full height', () => {
    const { options } = setup();
    const dock = new ReaderChatDock(options, post('a'));
    const handle = dock.el.querySelector('.sa-reader-chat-sheet-handle') as HTMLButtonElement;
    handle.click();
    expect(dock.el.hasClass('is-expanded')).toBe(true);
    handle.click();
    expect(dock.el.hasClass('is-expanded')).toBe(false);
  });

  it('labels the post by title, first line, then author, clipped', () => {
    expect(chatPostLabel(post('a', 'Body', 'A title'))).toBe('A title');
    expect(chatPostLabel(post('a', '  \n'))).toBe('Ada');
    expect(chatPostLabel(post('a', 'x'.repeat(100)))).toHaveLength(80);
  });
});
