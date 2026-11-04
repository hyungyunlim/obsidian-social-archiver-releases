import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, Platform, TFile, type App, type Vault } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';
import type { AICommentMeta } from '@/types/ai-comment';

/**
 * Chat and research made outside the AI banner save through the banner's own
 * path (note → frontmatter → server snapshot), and the card's AI menus offer
 * them only when an engine can run them.
 */

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  Object.assign(actual.MenuItem.prototype, { setWarning(this: unknown) { return this; } });
  class Component {
    register(): void {}
    registerEvent(): void {}
    addChild(): void {}
    load(): void {}
    unload(): void {}
  }
  class Notice {
    hide(): void {}
  }
  return { ...actual, Component, Notice, setIcon: () => undefined };
});

import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import { parseAIComments } from '@/services/ai-comment/markdown-handler';
import { setByokService, type ByokService } from '@/services/byok/ByokService';
import { AIChatModal } from '@/modals/AIChatModal';
import { AICliDetector } from '@/utils/ai-cli';

const PATH = 'Social Archives/X/2026/11/post.md';

function makeRenderer(options: { signedIn?: boolean } = {}) {
  const file = new (TFile as unknown as new (p: string) => TFile)(PATH);
  const note = { content: '# Post\n\nKubernetes schedules containers.' };
  const frontmatter: Record<string, unknown> = { sourceArchiveId: 'archive-1' };
  const vault = {
    getAbstractFileByPath: (path: string) => (path === PATH ? file : null),
    getFileByPath: (path: string) => (path === PATH ? file : null),
    read: vi.fn(async () => note.content),
    process: vi.fn(async (_file: TFile, fn: (content: string) => string) => {
      note.content = fn(note.content);
      return note.content;
    }),
  } as unknown as Vault;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: { processFrontMatter: vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => fn(frontmatter)) },
    workspace: {},
  } as unknown as App;
  const updateArchiveActions = vi.fn(async () => ({ success: true }));
  const plugin = {
    app,
    events: { on: () => ({}) },
    manifest: { id: 'social-archiver', version: '0.0.0-test' },
    settings: {
      aiComment: { enabled: true, defaultCli: 'claude', outputLanguage: 'auto', platformVisibility: { socialMedia: true, blogNews: true, videoAudio: true, excludedPlatforms: [] } },
      isVerified: options.signedIn ?? true,
      authToken: options.signedIn === false ? '' : 'token',
      workerUrl: 'https://api.test.com',
      username: 'me',
    },
    workersApiClient: { updateArchiveActions, getUserArchives: vi.fn(), getArchiveContentVariants: async () => ({ variants: [] }) },
  } as unknown as SocialArchiverPlugin;
  const renderer = new PostCardRenderer(
    vault, app, plugin,
    new MediaGalleryRenderer((path) => path),
    new CommentRenderer(),
    new YouTubeEmbedRenderer(),
    new LinkPreviewRenderer(),
    new Map(),
  );
  const onUIModify = vi.fn();
  renderer.onUIModify(onUIModify);
  return { renderer, note, frontmatter, updateArchiveActions, onUIModify };
}

const post = (overrides: Partial<PostData> = {}): PostData => ({
  platform: 'x',
  id: 'post-1',
  url: 'https://x.com/a/status/1',
  filePath: PATH,
  sourceArchiveId: 'archive-1',
  author: { name: 'Ada', url: '' },
  content: { text: 'Kubernetes schedules containers.' },
  media: [],
  metadata: { timestamp: '2026-11-04T00:00:00.000Z' },
  ...overrides,
}) as PostData;

const chatMeta: AICommentMeta = {
  id: 'openai-api-chat-20261104T000000000',
  cli: 'openai-api',
  model: 'gpt-6-luna',
  type: 'chat',
  generatedAt: '2026-11-04T00:00:00.000Z',
  processingTime: 1200,
  contentHash: 'abcd1234',
};

function openMobileAIMenu(renderer: PostCardRenderer, target: PostData): Menu {
  const bar = document.createElement('div');
  (renderer as unknown as {
    renderMobileAIActionButton(parent: HTMLElement, post: PostData, root: HTMLElement): void;
  }).renderMobileAIActionButton(bar, target, document.createElement('div'));
  Menu.last = null;
  (bar.lastElementChild as HTMLElement).click();
  if (!Menu.last) throw new Error('no menu');
  return Menu.last;
}

const titles = (menu: Menu) => menu.items.map((item) => item.title);
const readyByok = (providers: string[]) => ({ readyProviders: () => providers }) as unknown as ByokService;

describe('PostCardRenderer chat and research', () => {
  afterEach(() => {
    setByokService(null);
    (Platform as { isMobile: boolean }).isMobile = false;
    vi.restoreAllMocks();
  });

  it('saves an external AI comment through the standard path', async () => {
    const { renderer, note, frontmatter, updateArchiveActions, onUIModify } = makeRenderer();
    const content = '> [!question] What does it do?\n\nIt schedules containers.';
    // The card on screen (refreshed after the save).
    const root = document.body.createDiv();
    await renderer.saveExternalAIComment(post(), chatMeta, content, root);

    expect(onUIModify).toHaveBeenCalledWith(PATH);
    const parsed = parseAIComments(note.content);
    expect(parsed.comments.map((comment) => comment.id)).toEqual([chatMeta.id]);
    expect(parsed.commentTexts.get(chatMeta.id)).toBe(content);
    expect(frontmatter.aiComments).toEqual([chatMeta.id]);
    expect(updateArchiveActions).toHaveBeenCalledWith('archive-1', {
      aiComments: [expect.objectContaining({ meta: expect.objectContaining({ id: chatMeta.id, cli: 'openai-api', type: 'chat' }), content })],
    });
  });

  it('gives modals a target with the note budget, its saved chat, and a save that replaces it', async () => {
    const { renderer, note } = makeRenderer();
    const target = renderer.aiCommentTarget(post(), document.createElement('div'));
    await expect(target?.budget('chat')).resolves.toMatchObject({ maxChars: 40_000 });
    expect(renderer.aiCommentTarget(post({ filePath: 'missing.md' }), document.createElement('div'))).toBeNull();

    await expect(target?.savedChat?.()).resolves.toBeNull();
    await target?.save(chatMeta, '> [!question] Why?\n\nBecause.');
    await expect(target?.savedChat?.()).resolves.toEqual({ id: chatMeta.id, content: '> [!question] Why?\n\nBecause.' });
    const continued = { ...chatMeta, id: 'openai-api-chat-20261104T010000000' };
    await target?.save(continued, '> [!question] Why?\n\nBecause.\n\n> [!question] And?\n\nSo.', chatMeta.id);
    expect(parseAIComments(note.content).comments.map((comment) => comment.id)).toEqual([continued.id]);
  });

  it('puts chat and research first in the phone AI menu when a key is ready', () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    setByokService(readyByok(['openai']));
    const { renderer } = makeRenderer();
    const menu = openMobileAIMenu(renderer, post());
    expect(titles(menu).slice(0, 3)).toEqual(['Chat about this post', 'Research this post', 'Summary · OpenAI (my key)']);

    const open = vi.spyOn(AIChatModal.prototype, 'open').mockImplementation(() => undefined);
    menu.select('Chat about this post');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens reader mode with the chat docked when the card can open the reader', () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    setByokService(readyByok(['openai']));
    const { renderer } = makeRenderer();
    const openReader = vi.fn();
    renderer.onReaderMode(openReader);
    const open = vi.spyOn(AIChatModal.prototype, 'open').mockImplementation(() => undefined);
    const target = post();
    openMobileAIMenu(renderer, target).select('Chat about this post');
    expect(openReader).toHaveBeenCalledWith(target, { chat: true });
    expect(open).not.toHaveBeenCalled();
  });

  it('offers Cloud AI chat without a key, and a hint instead of research', () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    const { renderer } = makeRenderer();
    expect(titles(openMobileAIMenu(renderer, post())).slice(0, 2)).toEqual(['Chat about this post', 'Research: add your own API key']);
  });

  it('shows one settings hint when nothing can run', () => {
    (Platform as { isMobile: boolean }).isMobile = true;
    const { renderer } = makeRenderer({ signedIn: false });
    expect(titles(openMobileAIMenu(renderer, post())).slice(0, 2)).toEqual(['Chat and research: add an API key', 'Summary']);
  });

  it('offers research on desktop once a CLI is found, through its own AI button', () => {
    vi.spyOn(AICliDetector, 'getCachedResults').mockReturnValue(new Map([
      ['claude', { available: true, authenticated: true, version: '1', path: '/bin/claude', cli: 'claude' }],
    ]) as never);
    const { renderer } = makeRenderer({ signedIn: false });
    const bar = document.createElement('div');
    (renderer as unknown as {
      renderAIConversationButton(parent: HTMLElement, post: PostData, root: HTMLElement): void;
    }).renderAIConversationButton(bar, post(), document.createElement('div'));
    Menu.last = null;
    (bar.lastElementChild as HTMLElement).dispatchEvent(new MouseEvent('click'));
    expect(Menu.last && titles(Menu.last)).toEqual(['Research this post']);
  });
});
