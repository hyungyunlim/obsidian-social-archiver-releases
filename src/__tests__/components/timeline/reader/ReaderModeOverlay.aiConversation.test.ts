import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, TFile, type App } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  class Component {
    load(): void {}
    unload(): void {}
  }
  class Notice {}
  return {
    ...actual,
    Component,
    Notice,
    setIcon: (): void => undefined,
    MarkdownRenderer: {
      render: async (_app: unknown, markdown: string, el: HTMLElement): Promise<void> => {
        el.textContent = markdown;
      },
    },
  };
});

const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/utils/confirm-modal', () => ({ showConfirmModal: confirm }));

import { ReaderModeOverlay } from '@/components/timeline/reader/ReaderModeOverlay';
import { AIChatModal } from '@/modals/AIChatModal';
import type { ReaderChatDock, ReaderChatDockOptions } from '@/components/timeline/reader/ReaderChatDock';
import { setByokService, type ByokService } from '@/services/byok/ByokService';
import { clearPostChatSessions, findPostChatSession } from '@/services/byok/postChatSessions';
import type { ByokClient } from '@/vendor/byok-ai-core';

const PATH = 'Social Archives/X/post.md';

function makeOverlay() {
  const file = new (TFile as unknown as new (p: string) => TFile)(PATH);
  const note = { content: 'Body' };
  const frontmatter: Record<string, unknown> = { sourceArchiveId: 'archive-1' };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (path === PATH ? file : null),
      read: vi.fn(async () => note.content),
      process: vi.fn(async (_f: TFile, fn: (content: string) => string) => (note.content = fn(note.content))),
    },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: { processFrontMatter: vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => fn(frontmatter)) },
    loadLocalStorage: () => null,
  } as unknown as App;
  const plugin = {
    app,
    manifest: { id: 'social-archiver' },
    settings: { aiComment: { outputLanguage: 'auto' }, isVerified: true, authToken: 'token', workerUrl: '', username: 'me' },
    workersApiClient: { updateArchiveActions: vi.fn(async () => ({ success: true })), getUserArchives: vi.fn() },
  } as unknown as SocialArchiverPlugin;
  const post = {
    platform: 'x',
    id: 'post-1',
    url: 'https://x.com/a/status/1',
    filePath: PATH,
    sourceArchiveId: 'archive-1',
    author: { name: 'Ada', url: '' },
    content: { text: 'Body' },
    media: [],
    metadata: { timestamp: '2026-11-04T00:00:00.000Z' },
  } as unknown as PostData;
  const onUIModify = vi.fn();
  const overlay = new ReaderModeOverlay({
    posts: [post],
    currentIndex: 0,
    app,
    plugin,
    mediaGalleryRenderer: {} as never,
    linkPreviewRenderer: {} as never,
    onUIModify,
  });
  const internals = overlay as unknown as {
    openAIActionMenu(post: PostData, anchor: HTMLElement): void;
    handleKeyDown(e: KeyboardEvent): void;
    deletePost(post: PostData): Promise<void>;
    syncChatResume(): void;
    modalOpen: boolean;
    dirty: boolean;
    dirtyPaths: Set<string>;
    container: HTMLElement | null;
    _isActive: boolean;
    chatDock: ReaderChatDock | null;
  };
  return { overlay, internals, post, note, onUIModify };
}

/** Reader mode as open() leaves it, without rendering a post. */
function openReader(internals: { container: HTMLElement | null; _isActive: boolean }): HTMLElement {
  const container = document.body.createDiv({ cls: 'sa-reader-mode-container' });
  internals.container = container;
  internals._isActive = true;
  return container;
}

function chooseChat(internals: { openAIActionMenu(post: PostData, anchor: HTMLElement): void }, post: PostData): void {
  Menu.last = null;
  internals.openAIActionMenu(post, document.createElement('button'));
  Menu.last?.select('Chat about this post');
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** An OpenAI key that answers every question with `answer`. */
function answeringByok(answer = 'It schedules containers.'): ByokService {
  return {
    readyProviders: () => ['openai'],
    run: vi.fn(async (input: { run: (client: ByokClient, model: string) => Promise<unknown> }) => {
      const client = {
        generate: async () => ({ text: answer, model: 'gpt-6-luna', usage: {}, citations: [], finishReason: 'stop' }),
      } as unknown as ByokClient;
      return { value: await input.run(client, 'gpt-6-luna'), model: 'gpt-6-luna' };
    }),
  } as unknown as ByokService;
}

async function askInDock(container: HTMLElement, question: string): Promise<void> {
  (container.querySelector('.sa-ai-chat-input') as HTMLTextAreaElement).value = question;
  (container.querySelector('.sa-ai-chat-send') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(container.querySelector('.sa-ai-chat-message.is-pending')).toBeNull());
}

const dockMessages = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('.sa-reader-chat-dock .sa-ai-chat-message')].map((el) => el.textContent);

describe('Reader mode chat and research', () => {
  afterEach(() => {
    clearPostChatSessions();
    setByokService(null);
    vi.restoreAllMocks();
    confirm.mockClear();
    document.body.innerHTML = '';
  });

  it('puts chat and research first in the AI menu', () => {
    setByokService({ readyProviders: () => ['gemini'] } as unknown as ByokService);
    const { internals, post } = makeOverlay();
    Menu.last = null;
    internals.openAIActionMenu(post, document.createElement('button'));
    expect(Menu.last?.items.slice(0, 3).map((item) => item.title)).toEqual(['Chat about this post', 'Research this post', 'Summary']);
  });

  it('docks the chat beside the article instead of a modal, and saves to the note', async () => {
    setByokService({ readyProviders: () => ['openai'] } as unknown as ByokService);
    const open = vi.spyOn(AIChatModal.prototype, 'open').mockImplementation(() => undefined);
    const { internals, post, onUIModify } = makeOverlay();
    const container = openReader(internals);
    chooseChat(internals, post);

    expect(open).not.toHaveBeenCalled();
    expect(container.hasClass('has-chat-dock')).toBe(true);
    const dockEl = container.querySelector('.sa-reader-chat-dock');
    expect(dockEl?.querySelector('.sa-reader-chat-subtitle')?.textContent).toBe('Body');
    expect(dockEl?.querySelector('.sa-ai-chat-input')).not.toBeNull();

    const options = (internals.chatDock as unknown as { options: ReaderChatDockOptions }).options.panelOptions(post);
    expect(options?.archiveId).toBe('archive-1');
    await options?.target.save(
      { id: 'workers-ai-chat-1', cli: 'workers-ai', model: 'm', type: 'chat', generatedAt: '2026-11-04T00:00:00.000Z', processingTime: 0, contentHash: 'x' },
      '> [!question] Why?\n\nBecause.',
    );
    expect(onUIModify).toHaveBeenCalledWith(PATH);
    expect(internals.dirty).toBe(true);
    expect(internals.dirtyPaths.has(PATH)).toBe(true);
  });

  it('keeps typing in the chat away from reader shortcuts; Esc closes only the chat', async () => {
    setByokService({ readyProviders: () => ['openai'] } as unknown as ByokService);
    const { overlay, internals, post } = makeOverlay();
    const container = openReader(internals);
    chooseChat(internals, post);
    const deletePost = vi.spyOn(internals, 'deletePost').mockResolvedValue(undefined);
    const close = vi.spyOn(overlay, 'close').mockImplementation(() => undefined);
    const onKey = (event: KeyboardEvent): void => internals.handleKeyDown(event);
    document.addEventListener('keydown', onKey);
    try {
      const input = container.querySelector('.sa-ai-chat-input') as HTMLTextAreaElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
      expect(deletePost).not.toHaveBeenCalled();

      // Outside the chat the shortcut still works.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      expect(deletePost).toHaveBeenCalledTimes(1);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(container.querySelector('.sa-reader-chat-dock')).toBeNull();
      expect(container.hasClass('has-chat-dock')).toBe(false);
      expect(internals.chatDock).toBeNull();
      expect(close).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onKey);
    }
  });

  it('closes without asking; the chat stays with its post for the next time', async () => {
    setByokService(answeringByok());
    const { internals, post } = makeOverlay();
    const container = openReader(internals);
    chooseChat(internals, post);
    await askInDock(container, 'Why?');

    internals.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(internals._isActive).toBe(false);
    expect(internals.chatDock).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(findPostChatSession(post)?.messages.map((message) => message.content)).toEqual(['Why?', 'It schedules containers.']);
  });

  it('offers the way back to a chat put down on the post, and reopens the dock with it', async () => {
    setByokService(answeringByok());
    const { internals, post } = makeOverlay();
    const container = openReader(internals);
    const resume = (): HTMLButtonElement | null => container.querySelector<HTMLButtonElement>('.sa-reader-chat-resume');
    const resumeShown = (): boolean => resume()?.hasClass('is-hidden') === false;
    const closeDock = (): void => (container.querySelector('.sa-reader-chat-close') as HTMLButtonElement).click();

    // A post rendered with no chat this run: nothing to come back to.
    internals.syncChatResume();
    expect(resumeShown()).toBe(false);

    // A chat closed before anything was asked: still nothing.
    chooseChat(internals, post);
    closeDock();
    expect(resumeShown()).toBe(false);

    chooseChat(internals, post);
    expect(resumeShown()).toBe(false); // the dock is open
    await askInDock(container, 'Why?');
    closeDock();
    expect(internals.chatDock).toBeNull();
    expect(resumeShown()).toBe(true);

    resume()?.click();
    expect(internals.chatDock).not.toBeNull();
    expect(dockMessages(container)).toEqual(['Why?', 'It schedules containers.']);
    expect(resumeShown()).toBe(false);
  });
});
