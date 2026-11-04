import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform, type App } from 'obsidian';

const notices: string[] = [];
const confirmAnswer = vi.fn(async () => true);

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  class Component {
    load(): void {}
    unload(): void {}
  }
  class Notice {
    constructor(message: string) {
      notices.push(message);
    }
  }
  return {
    ...actual,
    Component,
    Notice,
    setIcon: () => undefined,
    MarkdownRenderer: {
      render: async (_app: unknown, markdown: string, el: HTMLElement) => {
        el.textContent = markdown;
      },
    },
  };
});

vi.mock('../../utils/confirm-modal', () => ({ showConfirmModal: () => confirmAnswer() }));

import { AIChatModal, type AIChatModalOptions } from '../../modals/AIChatModal';
import type { AICommentTarget, StoredAIComment } from '../../services/ai-comment/AICommentSaver';
import { clearPostChatSessions, findPostChatSession } from '../../services/byok/postChatSessions';
import type { ByokService } from '../../services/byok/ByokService';
import type { AICommentMeta } from '../../types/ai-comment';
import type { PostData } from '../../types/post';
import { WEB_ACCESS_REQUEST, utf8ByteLength, type AICommentBudget, type ByokClient } from '../../vendor/byok-ai-core';

const POST = {
  platform: 'x',
  id: 'post-1',
  url: 'https://x.com/a/status/1',
  filePath: 'Social Archives/X/post.md',
  author: { name: 'Ada', url: '' },
  content: { text: 'Kubernetes schedules containers.' },
  media: [],
  metadata: { timestamp: '2026-11-04T00:00:00.000Z' },
} as unknown as PostData;

type ModelRequest = { messages?: { role: string; content: string }[]; webSearch?: boolean };

/**
 * A ByokService that streams `answer` in two chunks; `requests` collects what
 * the model was asked. `noWebModel`: the chat model cannot search the web.
 */
function fakeByok(answer = 'It schedules containers.', requests: ModelRequest[] = [], noWebModel: string | null = null): ByokService {
  return {
    readyProviders: () => ['openai'],
    modelWithoutWebSearch: vi.fn(async () => noWebModel),
    run: vi.fn(async (input: { run: (client: ByokClient, model: string) => Promise<unknown> }) => {
      const client = {
        generate: async (req: ModelRequest, handlers?: { onDelta?: (text: string) => void }) => {
          requests.push(req);
          handlers?.onDelta?.(answer.slice(0, 3));
          handlers?.onDelta?.(answer.slice(3));
          return { text: answer, model: 'gpt-6-luna-2026-10-01', usage: {}, citations: [], finishReason: 'stop' };
        },
      } as unknown as ByokClient;
      return { value: await input.run(client, 'gpt-6-luna'), model: 'gpt-6-luna' };
    }),
  } as unknown as ByokService;
}

function setup(
  options: Partial<AIChatModalOptions> & { budget?: AICommentBudget | null; savedChat?: () => Promise<StoredAIComment | null> } = {},
) {
  const { budget, savedChat, ...modalOptions } = options;
  const saved: { meta: AICommentMeta; content: string; replaceId?: string }[] = [];
  const target: AICommentTarget = {
    post: POST,
    budget: vi.fn(async () => (budget === undefined ? { maxChars: 40_000, maxJsonBytes: 600_000 } : budget)),
    save: vi.fn(async (meta: AICommentMeta, content: string, replaceId?: string) => {
      saved.push({ meta, content, ...(replaceId ? { replaceId } : {}) });
    }),
    ...(savedChat ? { savedChat } : {}),
  };
  const askChatAI = vi.fn(async () => ({ text: 'Cloud answer.', provider: 'workers-ai' as const, model: '@cf/zai-org/glm-4.7-flash' }));
  const getChatAIAvailability = vi.fn(async () => ({ cloud: { available: true, consentRequired: false, credits: 0.5 } }));
  const openSettings = vi.fn();
  const onClosed = vi.fn();
  const modalSettings: AIChatModalOptions = {
    target,
    byok: fakeByok(),
    cloud: () => ({ askChatAI, getChatAIAvailability }),
    archiveId: 'archive-1',
    signedIn: true,
    openSettings,
    onClosed,
    ...modalOptions,
  };
  /** Chat about the same post again (the card's menu, a new modal). */
  const reopen = (): AIChatModal => {
    const again = new AIChatModal({} as App, modalSettings);
    again.open();
    return again;
  };
  const modal = reopen();
  return { modal, reopen, saved, target, askChatAI, getChatAIAvailability, openSettings, onClosed };
}

const $ = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};
const select = () => $<HTMLSelectElement>('.sa-ai-chat-modal select');
const input = () => $<HTMLTextAreaElement>('.sa-ai-chat-input');
const errorText = () => $('.sa-ai-chat-error').textContent ?? '';
const messages = () => [...document.querySelectorAll('.sa-ai-chat-message')].map((el) => el.textContent);
const saveShown = (): boolean => !$('.sa-ai-chat-footer').hasClass('is-hidden');
type CloudAnswer = { text: string; provider: 'workers-ai'; model: string };
const SAVED_CHAT: StoredAIComment = { id: 'openai-api-chat-saved', content: '> [!question] First?\n\nSaved answer.' };

async function ask(question: string): Promise<void> {
  input().value = question;
  $<HTMLButtonElement>('.sa-ai-chat-send').click();
  await vi.waitFor(() => expect(document.querySelector('.sa-ai-chat-message.is-pending')).toBeNull());
}

async function changeEngine(id: string): Promise<void> {
  select().value = id;
  select().dispatchEvent(new Event('change'));
}

describe('AIChatModal', () => {
  beforeEach(() => {
    notices.length = 0;
    confirmAnswer.mockResolvedValue(true);
  });

  afterEach(() => {
    clearPostChatSessions();
    (Platform as { isMobile: boolean }).isMobile = false;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('offers own keys first, then Cloud AI, and locks the engine after the first answer', async () => {
    const { getChatAIAvailability } = setup();
    expect([...select().options].map((option) => option.textContent)).toEqual(['OpenAI (my key)', 'Cloud AI']);
    expect(select().disabled).toBe(false);
    await vi.waitFor(() => expect(getChatAIAvailability).toHaveBeenCalled());

    await ask('What does it do?');
    expect(messages()).toEqual(['What does it do?', 'It schedules containers.']);
    expect(select().disabled).toBe(true);
    expect($('.sa-ai-chat-note').textContent).toBe('Start a new chat to switch engines.');

    $<HTMLButtonElement>('.sa-ai-chat-new').click();
    await vi.waitFor(() => expect(select().disabled).toBe(false));
    expect(messages()).toEqual([]);
  });

  it('shows the Cloud AI price and maps its errors, giving the question back', async () => {
    const { askChatAI } = setup();
    await changeEngine('cloud');
    await vi.waitFor(() => expect($('.sa-ai-chat-note').textContent).toBe('0.5 Cloud AI credits per question.'));

    askChatAI.mockRejectedValueOnce(Object.assign(new Error('consent'), { code: 'SERVER_AI_CONSENT_REQUIRED', status: 409 }));
    await ask('Why?');
    expect(errorText()).toBe('Cloud AI is off for this account. Turn it on in the Social Archiver app, or use your own API key.');
    expect(messages()).toEqual([]);
    expect(input().value).toBe('Why?');
    expect(select().disabled).toBe(false);

    askChatAI.mockRejectedValueOnce(Object.assign(new Error('slow'), { code: 'CHAT_AI_RATE_LIMITED', status: 429 }));
    await ask('Why?');
    expect(errorText()).toBe('Too many Cloud AI questions. Try again in a minute.');

    await ask('Why?');
    expect(errorText()).toBe('');
    expect(messages()).toEqual(['Why?', 'Cloud answer.']);
  });

  it('drops Cloud AI for an account that keeps it off', async () => {
    const getChatAIAvailability = vi.fn(async () => ({ cloud: { available: false, consentRequired: false } }));
    setup({ cloud: () => ({ askChatAI: vi.fn(), getChatAIAvailability }) });
    await vi.waitFor(() => expect([...select().options].map((option) => option.value)).toEqual(['openai-api']));
  });

  it('saves the conversation as a chat comment within the budget and closes', async () => {
    const budget = { maxChars: 40_000, maxJsonBytes: 1_200 };
    const { saved, onClosed } = setup({ byok: fakeByok('답변 '.repeat(120)), budget });
    await ask('첫 질문?');
    await ask('두 번째 질문?');
    $<HTMLButtonElement>('.sa-ai-chat-save').click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));

    const [{ meta, content }] = saved as [{ meta: AICommentMeta; content: string }];
    expect(meta).toMatchObject({ cli: 'openai-api', type: 'chat', model: 'gpt-6-luna', executedModel: 'gpt-6-luna-2026-10-01' });
    expect(utf8ByteLength(JSON.stringify(content))).toBeLessThanOrEqual(budget.maxJsonBytes);
    expect(content).toContain('> [!question] 두 번째 질문?');
    expect(content).not.toContain('첫 질문?');
    expect(notices).toEqual(['Chat saved to the note without its oldest 1 question(s), which did not fit.']);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('asks the user to delete AI comments when the note has no room', async () => {
    const { target } = setup({ budget: null });
    await ask('Why?');
    $<HTMLButtonElement>('.sa-ai-chat-save').click();
    await vi.waitFor(() => expect(errorText()).toBe('This note has too much AI comment text. Delete some AI comments and try again.'));
    expect(target.save).not.toHaveBeenCalled();
  });

  it('closes without asking, and chat on the post again shows the conversation and the half-typed question', async () => {
    const { modal, reopen, onClosed } = setup();
    await ask('Why?');
    input().value = 'And then';
    input().dispatchEvent(new Event('input'));
    modal.close();
    expect(confirmAnswer).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.sa-ai-chat-input')).toBeNull();

    reopen();
    expect(messages()).toEqual(['Why?', 'It schedules containers.']);
    expect(input().value).toBe('And then');
    expect(select().disabled).toBe(true);
    expect(saveShown()).toBe(true);
  });

  it('keeps an answer coming after the chat closed: a reopened chat shows it streaming, then landed', async () => {
    let answer!: (value: CloudAnswer) => void;
    const askChatAI = vi.fn(() => new Promise<CloudAnswer>((resolve) => (answer = resolve)));
    const { modal, reopen } = setup({
      byok: null,
      cloud: () => ({ askChatAI, getChatAIAvailability: vi.fn(async () => ({ cloud: { available: true, consentRequired: false } })) }),
    });
    input().value = 'Why?';
    $<HTMLButtonElement>('.sa-ai-chat-send').click();
    expect(askChatAI).toHaveBeenCalledTimes(1);
    modal.close();

    const again = reopen();
    expect(messages()).toEqual(['Why?', 'Thinking…']);
    expect($<HTMLButtonElement>('.sa-ai-chat-send').getAttribute('aria-label')).toBe('Stop');
    again.close();

    answer({ text: 'Because.', provider: 'workers-ai', model: 'm' });
    await vi.waitFor(() => expect(findPostChatSession(POST)?.pending).toBeNull());
    reopen();
    expect(messages()).toEqual(['Why?', 'Because.']);
  });

  it('continues a chat saved to the note, and saving it again replaces that comment', async () => {
    const requests: ModelRequest[] = [];
    const { reopen, saved, target } = setup({ byok: fakeByok('Second answer.', requests), savedChat: async () => SAVED_CHAT });
    await vi.waitFor(() => expect(messages()).toEqual(['First?', 'Saved answer.']));
    expect(saveShown()).toBe(false);
    expect(select().disabled).toBe(false);

    await ask('Second?');
    expect(requests.at(-1)?.messages).toEqual([
      { role: 'user', content: 'First?' },
      { role: 'assistant', content: 'Saved answer.' },
      { role: 'user', content: 'Second?' },
    ]);
    expect(saveShown()).toBe(true);
    $<HTMLButtonElement>('.sa-ai-chat-save').click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(target.budget).toHaveBeenCalledWith('chat', SAVED_CHAT.id);
    expect(saved[0]?.replaceId).toBe(SAVED_CHAT.id);
    expect(saved[0]?.content).toContain('> [!question] First?');
    expect(saved[0]?.content).toContain('> [!question] Second?');

    // Saved: nothing new to save; one more turn replaces the comment just written.
    reopen();
    expect(saveShown()).toBe(false);
    await ask('Third?');
    $<HTMLButtonElement>('.sa-ai-chat-save').click();
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]?.replaceId).toBe(saved[0]?.meta.id);
  });

  it('asks before New chat only when turns would be lost, and a new chat saves beside the saved one', async () => {
    const { saved } = setup({ savedChat: async () => SAVED_CHAT });
    await vi.waitFor(() => expect(messages()).toHaveLength(2));
    $<HTMLButtonElement>('.sa-ai-chat-new').click();
    await vi.waitFor(() => expect(messages()).toEqual([]));
    expect(confirmAnswer).not.toHaveBeenCalled();

    await ask('Why?');
    confirmAnswer.mockResolvedValueOnce(false);
    $<HTMLButtonElement>('.sa-ai-chat-new').click();
    await vi.waitFor(() => expect(confirmAnswer).toHaveBeenCalledTimes(1));
    expect(messages()).toEqual(['Why?', 'It schedules containers.']);

    $<HTMLButtonElement>('.sa-ai-chat-save').click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.replaceId).toBeUndefined();
  });

  it('puts the keyboard away on phones after sending, and keeps the focus on desktop', async () => {
    setup();
    const blur = vi.spyOn(input(), 'blur');
    await ask('Why?');
    expect(blur).not.toHaveBeenCalled();

    (Platform as { isMobile: boolean }).isMobile = true;
    input().value = 'And then?';
    $<HTMLButtonElement>('.sa-ai-chat-send').click();
    expect(blur).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(messages()).toHaveLength(4));
  });

  it('stops a pending answer and gives the question back', async () => {
    let answer!: (value: { text: string; provider: 'workers-ai'; model: string }) => void;
    const askChatAI = vi.fn(() => new Promise<{ text: string; provider: 'workers-ai'; model: string }>((resolve) => (answer = resolve)));
    setup({ byok: null, cloud: () => ({ askChatAI, getChatAIAvailability: vi.fn(async () => ({ cloud: { available: true, consentRequired: false } })) }) });
    input().value = 'Why?';
    $<HTMLButtonElement>('.sa-ai-chat-send').click();
    await vi.waitFor(() => expect(document.querySelector('.sa-ai-chat-message.is-pending')).not.toBeNull());

    $<HTMLButtonElement>('.sa-ai-chat-send').click(); // Stop
    expect(input().value).toBe('Why?');
    expect(messages()).toEqual([]);
    answer({ text: 'Late.', provider: 'workers-ai', model: 'm' });
    await Promise.resolve();
    expect(messages()).toEqual([]);
  });

  it('keeps the question, then the web search chip and send, in one composer box', () => {
    setup();
    const composer = $('.sa-ai-chat-composer');
    const actions = $('.sa-ai-chat-composer > .sa-ai-chat-composer-actions');
    expect(composer.firstElementChild).toBe(input());
    expect(actions.firstElementChild).toBe($('.sa-ai-chat-web'));
    expect(actions.lastElementChild).toBe($('.sa-ai-chat-send'));
  });

  it('searches the web only for the next question, when the user turns it on', async () => {
    const requests: ModelRequest[] = [];
    setup({ byok: fakeByok('Answer.', requests) });
    const web = (): HTMLButtonElement => $<HTMLButtonElement>('.sa-ai-chat-web');
    const note = (): HTMLElement => $<HTMLElement>('.sa-ai-chat-web-note');
    expect(web().hasClass('is-hidden')).toBe(false);
    expect(web().textContent).toBe('Search the web');
    expect(web().getAttribute('aria-pressed')).toBe('false');
    expect(web().getAttribute('aria-label')).toBe('Search the web for the next question');
    expect(note().hasClass('is-hidden')).toBe(true);

    web().click();
    expect(web().getAttribute('aria-pressed')).toBe('true');
    expect(web().hasClass('is-active')).toBe(true);
    expect(note().hasClass('is-hidden')).toBe(false);
    expect(note().textContent).toBe('Web searches may cost extra on your OpenAI account.');

    await ask('What happened since?');
    expect(requests[0]?.webSearch).toBe(true);
    expect(requests[0]?.messages?.at(-1)?.content).toBe(`What happened since?\n\n${WEB_ACCESS_REQUEST}`);
    expect(web().getAttribute('aria-pressed')).toBe('false');
    expect(note().hasClass('is-hidden')).toBe(true);

    await ask('And then?');
    expect(requests[1]?.webSearch).toBe(false);
    expect(requests[1]?.messages?.at(-1)?.content).toBe('And then?');
    expect(messages()).toEqual(['What happened since?', 'Answer.', 'And then?', 'Answer.']);
  });

  it('hides the web toggle on Cloud AI and turns it off there', async () => {
    setup();
    $<HTMLButtonElement>('.sa-ai-chat-web').click();
    await changeEngine('cloud');
    expect($('.sa-ai-chat-web').hasClass('is-hidden')).toBe(true);
    expect($('.sa-ai-chat-web-note').hasClass('is-hidden')).toBe(true);
    expect(findPostChatSession(POST)?.web).toBe(false);

    document.body.innerHTML = '';
    clearPostChatSessions();
    setup({ byok: null });
    expect($('.sa-ai-chat-web').hasClass('is-hidden')).toBe(true);
  });

  it('greys out web search, saying why, when the chat model cannot search', async () => {
    const byok = fakeByok('Answer.', [], 'Claude Haiku 3');
    setup({ byok });
    const web = (): HTMLButtonElement => $<HTMLButtonElement>('.sa-ai-chat-web');
    await vi.waitFor(() => expect(web().disabled).toBe(true));
    expect(byok.modelWithoutWebSearch).toHaveBeenCalledWith('openai', 'chat');
    expect(web().getAttribute('aria-label')).toBe('Claude Haiku 3 cannot search the web.');
    expect(web().getAttribute('aria-pressed')).toBe('false');
    expect($('.sa-ai-chat-web-note').textContent).toBe('Claude Haiku 3 cannot search the web.');
  });

  it('points to settings when nothing can answer', () => {
    const { openSettings } = setup({ byok: null, signedIn: false });
    expect(document.querySelector('.sa-ai-chat-input')).toBeNull();
    expect($('.sa-ai-chat-no-engine').textContent).toContain('add an AI API key');
    $<HTMLButtonElement>('.sa-ai-chat-no-engine button').click();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
