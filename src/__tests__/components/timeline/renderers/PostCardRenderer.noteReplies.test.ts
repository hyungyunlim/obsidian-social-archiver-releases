import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal, TFile, type App, type Vault } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';
import type { AICommentMeta } from '@/types/ai-comment';

/**
 * "@Claude …" in "My Note" on a post card: the picker in the inline editor,
 * the ask on save with "Claude is replying…" under the note, and the answer
 * landing there as a reply, never among the card's AI comments.
 */

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  class Component {
    register(): void {}
    registerEvent(): void {}
    addChild(): void {}
    load(): void {}
    unload(): void {}
  }
  class Scope {
    constructor(readonly parent?: Scope) {}
    register(): void {}
  }
  class Notice {}
  return {
    ...actual,
    Component,
    Scope,
    Notice,
    MarkdownRenderer: {
      render: async (_app: unknown, source: string, element: HTMLElement): Promise<void> => {
        element.textContent = source;
      },
    },
    setIcon: (): void => undefined,
  };
});

import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import { appendAIComment, parseAIComments } from '@/services/ai-comment/markdown-handler';
import { setByokService, type ByokService } from '@/services/byok/ByokService';
import { NoteMentionAsker, pluginNoteId } from '@/services/byok/NoteMentionAsker';
import { noteReplyCommentId, type ByokClient } from '@/vendor/byok-ai-core';

// Obsidian's `el.appendText()` (the note text renders through it).
if (!('appendText' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'appendText', {
    configurable: true,
    writable: true,
    value(this: Element, text: string) {
      this.appendChild(document.createTextNode(text));
    },
  });
}

const PATH = 'Social Archives/X/2026/11/post.md';
const NOTE_ID = pluginNoteId('client-1');
const REPLY_ID = noteReplyCommentId('anthropic-api-chat-20261105T000000000-abcd', NOTE_ID);
const MOBILE_REPLY_ID = noteReplyCommentId('openai-api-chat-20261105T000000000-efgh', 'mobile-note-1');

const meta = (id: string, cli: AICommentMeta['cli'] = 'openai-api'): AICommentMeta => ({
  id,
  cli,
  model: cli === 'anthropic-api' ? 'claude-sonnet-5' : 'gpt-6-luna',
  type: 'chat',
  generatedAt: '2026-11-05T00:00:00.000Z',
  processingTime: 1000,
  contentHash: 'abcd1234',
});

/** A note holding an ordinary saved chat, a reply to "My Note" and a reply to a note from the phone. */
function noteWithReplies(): string {
  let note = '# Post\n\nKubernetes schedules containers.';
  note = appendAIComment(note, meta('openai-api-chat-1'), '> [!question] Ordinary?\n\nOrdinary answer.');
  note = appendAIComment(note, meta(REPLY_ID, 'anthropic-api'), '> [!question] What is this based on? @Claude\n\nIt cites the CNCF survey.');
  note = appendAIComment(note, meta(MOBILE_REPLY_ID), '> [!question] From the phone?\n\nPhone answer.');
  return note;
}

/** An Anthropic key whose answers wait for `gate`. */
function gatedByok(gate: Promise<void>): ByokService {
  return {
    readyProviders: () => ['anthropic'],
    run: vi.fn(async (input: { run: (client: ByokClient, model: string) => Promise<unknown> }) => {
      await gate;
      const client = {
        generate: async () => ({ text: 'It cites the CNCF survey.', model: 'claude-sonnet-5-20261001', usage: {}, citations: [], finishReason: 'stop' }),
      } as unknown as ByokClient;
      return { value: await input.run(client, 'claude-sonnet-5'), model: 'claude-sonnet-5' };
    }),
  } as unknown as ByokService;
}

function setup(content: string, gate: Promise<void> = Promise.resolve()) {
  const file = new (TFile as unknown as new (p: string) => TFile)(PATH);
  const note = { content };
  const frontmatter: Record<string, unknown> = { sourceArchiveId: 'archive-1' };
  const vault = {
    adapter: { exists: vi.fn(async () => false) },
    getAbstractFileByPath: (path: string) => (path === PATH ? file : null),
    getFileByPath: (path: string) => (path === PATH ? file : null),
    read: vi.fn(async () => note.content),
    process: vi.fn(async (_file: TFile, fn: (text: string) => string) => (note.content = fn(note.content))),
  } as unknown as Vault;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: { processFrontMatter: vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => fn(frontmatter)) },
    keymap: { pushScope: vi.fn(), popScope: vi.fn() },
    workspace: {},
  } as unknown as App;
  const byok = gatedByok(gate);
  setByokService(byok);
  const plugin = {
    app,
    manifest: { id: 'social-archiver', version: '0.0.0-test' },
    settings: {
      username: 'me',
      workerUrl: 'https://api.test.com',
      authToken: '',
      isVerified: false,
      syncClientId: 'client-1',
      transcription: { enabled: false, preferredModel: 'tiny', preferredVariant: 'auto' },
    },
    tagStore: { getDisplayTagsForPost: vi.fn(() => []), getTagDefinitions: vi.fn(() => []) },
    events: { on: vi.fn(() => ({})), off: vi.fn() },
    workersApiClient: {
      updateArchiveActions: vi.fn(async () => ({ success: true })),
      getUserArchives: vi.fn(),
      getArchiveContentVariants: async () => ({ variants: [] }),
    },
  } as unknown as SocialArchiverPlugin;
  plugin.noteMentionAsker = new NoteMentionAsker({
    chat: () => ({ byok, cloud: () => null, archiveId: 'archive-1', signedIn: false }),
    noteId: () => NOTE_ID,
    notify: vi.fn(),
  });
  const renderer = new PostCardRenderer(
    vault, app, plugin,
    new MediaGalleryRenderer((path) => path),
    new CommentRenderer(),
    new YouTubeEmbedRenderer(),
    new LinkPreviewRenderer(),
    new Map(),
  );
  const container = new Modal(app).contentEl;
  document.body.appendChild(container);
  return { renderer, container, note, frontmatter };
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
  metadata: { timestamp: '2026-11-05T00:00:00.000Z' },
  ...overrides,
}) as PostData;

const ids = (elements: NodeListOf<Element>): (string | null)[] => [...elements].map((el) => el.getAttribute('data-comment-id'));

afterEach(() => {
  setByokService(null);
  document.body.empty();
});

describe('PostCardRenderer replies to My Note', () => {
  it('shows the replies to the note under it, and only the others among the AI comments', async () => {
    const { renderer, container } = setup(noteWithReplies());
    await renderer.render(container, post({ comment: 'What is this based on? @Claude' }));

    const replies = container.querySelector('.sa-note-replies');
    // Right under the note.
    expect(replies?.previousElementSibling?.textContent).toContain('What is this based on? @Claude');
    await vi.waitFor(() => expect(ids(container.querySelectorAll('.sa-note-reply'))).toEqual([REPLY_ID]));
    const reply = container.querySelector('.sa-note-reply');
    // Labelled like an AI comment (provider, model); the note itself is not repeated.
    expect([...(reply?.firstElementChild?.children ?? [])].map((label) => label.textContent)).toEqual(['Anthropic API', 'Sonnet 5']);
    expect(reply?.querySelector('.sa-note-reply-body')?.textContent).toBe('It cites the CNCF survey.');
    expect(ids(container.querySelectorAll('.ai-comment-renderer-container .ai-comment-item'))).toEqual(['openai-api-chat-1', MOBILE_REPLY_ID]);
  });

  it('lists a reply among the AI comments once its note is gone', async () => {
    const { renderer, container } = setup(noteWithReplies());
    await renderer.render(container, post());
    expect(container.querySelector('.sa-note-reply')).toBeNull();
    expect(ids(container.querySelectorAll('.ai-comment-renderer-container .ai-comment-item'))).toEqual(['openai-api-chat-1', REPLY_ID, MOBILE_REPLY_ID]);
  });

  it('asks on save, shows who is replying under the note, then the answer there', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { renderer, container, note, frontmatter } = setup('# Post\n\nKubernetes schedules containers.', gate);
    await renderer.render(container, post({ comment: 'Interesting.' }));

    const section = container.querySelector('.sa-note-replies')?.previousElementSibling as HTMLElement;
    section.click();
    const textarea = section.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Interesting. @';
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new Event('input'));
    // Only the AIs this vault can ask.
    expect([...section.querySelectorAll('.sa-ai-mention-option')].map((row) => row.textContent)).toEqual(['@ClaudeAnthropic (my key)']);

    textarea.value = 'Interesting. @Claude what is this based on?';
    textarea.dispatchEvent(new Event('input'));
    (section.querySelector('button.mod-cta') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(container.querySelector('.sa-note-reply-pending')?.textContent).toBe('Claude is replying…'));
    expect(frontmatter.comment).toBe('Interesting. @Claude what is this based on?');

    release();
    await vi.waitFor(() => expect(container.querySelector('.sa-note-reply-pending')).toBeNull());
    await vi.waitFor(() => expect(ids(container.querySelectorAll('.sa-note-reply'))).toEqual([
      expect.stringMatching(/^anthropic-api-chat-.+-re-obsidian_client-1_primary$/),
    ]));
    expect(container.querySelector('.sa-note-reply-body')?.textContent).toBe('It cites the CNCF survey.');
    expect(parseAIComments(note.content).comments.map((comment) => comment.type)).toEqual(['chat']);

    // The card's AI comments are drawn again after the save: still without the reply.
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    expect(container.querySelectorAll('.ai-comment-renderer-container .ai-comment-item')).toHaveLength(0);
  });
});
