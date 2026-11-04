import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  setIcon: (el: HTMLElement, icon: string): void => {
    el.dataset.icon = icon;
  },
}));

import { ReaderChatResumeButton } from '@/components/timeline/reader/ReaderChatResumeButton';
import { PostChatSession, type PostChatSessionDeps } from '@/services/byok/PostChatSession';

type CloudAnswer = { text: string; provider: 'workers-ai'; model: string };

function cloudSession(askChatAI: () => Promise<CloudAnswer>): PostChatSession {
  const deps: PostChatSessionDeps = {
    byok: () => null,
    cloud: () => ({ askChatAI }),
    article: () => ({ title: 'T', authorName: 'Ada', platform: 'x', body: 'Body.' }),
    archiveId: 'archive-1',
  };
  const session = new PostChatSession(deps);
  session.setEngine({ kind: 'cloud' });
  return session;
}

describe('ReaderChatResumeButton', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows only for a post with a chat, spins while an answer is coming, and reopens the chat', async () => {
    const container = document.body.createDiv();
    const onOpen = vi.fn();
    const button = new ReaderChatResumeButton(container, onOpen);
    const hidden = (): boolean => button.el.hasClass('is-hidden');
    const icon = (): string | undefined => button.el.querySelector<HTMLElement>('.sa-reader-chat-resume-icon')?.dataset.icon;
    expect(hidden()).toBe(true);
    expect(button.el.textContent).toBe('AI chat');
    expect(button.el.getAttribute('aria-label')).toBe('Chat about this post');

    let answer!: (value: CloudAnswer) => void;
    const session = cloudSession(() => new Promise((resolve) => (answer = resolve)));
    button.show(session);
    expect(hidden()).toBe(true); // nothing said yet

    const turn = session.send('Why?');
    expect(hidden()).toBe(false);
    expect(button.el.hasClass('is-busy')).toBe(true);
    expect(button.el.getAttribute('aria-busy')).toBe('true');
    expect(icon()).toBe('loader-2');

    answer({ text: 'Because.', provider: 'workers-ai', model: 'm' });
    await turn;
    expect(hidden()).toBe(false);
    expect(button.el.hasClass('is-busy')).toBe(false);
    expect(icon()).toBe('message-circle');

    button.el.click();
    expect(onOpen).toHaveBeenCalledTimes(1);

    // The dock opened: hidden, and no longer following the session.
    button.show(null);
    expect(hidden()).toBe(true);
    void session.send('Again?');
    expect(hidden()).toBe(true);

    button.destroy();
    expect(container.contains(button.el)).toBe(false);
  });

  it('goes away again when the only question failed', async () => {
    const button = new ReaderChatResumeButton(document.body.createDiv(), vi.fn());
    const session = cloudSession(async () => {
      throw Object.assign(new Error('offline'), { code: 'SERVER_AI_FAILED' });
    });
    button.show(session);
    const turn = session.send('Why?');
    expect(button.el.hasClass('is-hidden')).toBe(false);
    await turn;
    expect(button.el.hasClass('is-hidden')).toBe(true);
  });
});
