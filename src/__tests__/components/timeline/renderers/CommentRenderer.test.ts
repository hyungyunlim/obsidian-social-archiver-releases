import { beforeEach, describe, expect, it } from 'vitest';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import type { Comment } from '@/types/post';

beforeEach(() => {
  (HTMLElement.prototype as any).addClass = function (...classes: string[]) {
    this.classList.add(...classes);
  };
  (HTMLElement.prototype as any).removeClass = function (...classes: string[]) {
    this.classList.remove(...classes);
  };
  (HTMLElement.prototype as any).setText = function (text: string) {
    this.textContent = text;
  };
  (HTMLElement.prototype as any).empty = function () {
    this.innerHTML = '';
  };
  (HTMLElement.prototype as any).createDiv = function (options?: { cls?: string; text?: string }) {
    const el = document.createElement('div');
    if (options?.cls) el.className = options.cls;
    if (options?.text) el.textContent = options.text;
    this.appendChild(el);
    return el;
  };
  (HTMLElement.prototype as any).createSpan = function (options?: { cls?: string; text?: string }) {
    const el = document.createElement('span');
    if (options?.cls) el.className = options.cls;
    if (options?.text) el.textContent = options.text;
    this.appendChild(el);
    return el;
  };
  (HTMLElement.prototype as any).createEl = function (
    tagName: string,
    options?: { cls?: string; text?: string },
  ) {
    const el = document.createElement(tagName);
    if (options?.cls) el.className = options.cls;
    if (options?.text) el.textContent = options.text;
    this.appendChild(el);
    return el;
  };
});

describe('CommentRenderer', () => {
  it('renders LinkedIn mention anchors inside comment content as external links', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      {
        id: '1',
        author: { name: 'Commenter', url: 'https://www.linkedin.com/in/commenter' },
        content: 'Thanks <a href="/in/main-author-123abc">Main Author</a> for the post',
      },
    ];

    new CommentRenderer().render(container, comments, 'linkedin');

    const mentionLink = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.cr-link'))
      .find((link) => link.textContent === 'Main Author');
    expect(mentionLink?.getAttribute('href')).toBe('https://www.linkedin.com/in/main-author-123abc');
    expect(mentionLink?.getAttribute('target')).toBe('_blank');
    expect(mentionLink?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toContain('Thanks Main Author for the post');
    expect(container.textContent).not.toContain('<a href=');
  });

  it('renders unsafe comment anchors as plain text', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      {
        id: '1',
        author: { name: 'Commenter', url: 'https://www.linkedin.com/in/commenter' },
        content: '<a href="javascript:alert(1)">Bad Link</a>',
      },
    ];

    new CommentRenderer().render(container, comments, 'linkedin');

    expect(container.querySelectorAll('a.cr-link')).toHaveLength(0);
    expect(container.textContent).toContain('Bad Link');
  });

  it('keeps multi-paragraph comment text in the preserved-content span', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      {
        id: '1',
        author: { name: 'Commenter', url: 'https://www.reddit.com/user/commenter' },
        content: 'First paragraph.\n\nSecond paragraph with https://example.com/link',
      },
    ];

    new CommentRenderer().render(container, comments, 'reddit');

    const content = container.querySelector('.cr-comment-content');
    expect(content?.textContent).toContain('First paragraph.\n\nSecond paragraph');
    expect(content?.querySelector('a.cr-link')?.textContent).toBe('https://example.com/link');
  });

  it('renders Reddit subreddit and user references inside comment content as links', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      {
        id: '1',
        author: { name: 'Commenter', url: 'https://www.reddit.com/user/commenter' },
        content: 'Discussed in r/cycling with u/example_user.',
      },
    ];

    new CommentRenderer().render(container, comments, 'reddit');

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.cr-link'));
    const subredditLink = links.find((link) => link.textContent === 'r/cycling');
    const userLink = links.find((link) => link.textContent === 'u/example_user');
    expect(subredditLink?.getAttribute('href')).toBe('https://www.reddit.com/r/cycling/');
    expect(userLink?.getAttribute('href')).toBe('https://www.reddit.com/user/example_user/');
  });

  it('renders very deep comment trees fully by default without a visible depth control', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      {
        id: 'root',
        author: { name: 'RootAuthor', url: 'https://www.reddit.com/user/root' },
        content: 'Root comment',
        replies: [
          {
            id: 'level1',
            author: { name: 'LevelOneAuthor', url: 'https://www.reddit.com/user/one' },
            content: 'Level 1',
            replies: [
              {
                id: 'level2',
                author: { name: 'LevelTwoAuthor', url: 'https://www.reddit.com/user/two' },
                content: 'Level 2',
                replies: [
                  {
                    id: 'level3',
                    author: { name: 'LevelThreeAuthor', url: 'https://www.reddit.com/user/three' },
                    content: 'Level 3',
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    new CommentRenderer().render(container, comments, 'reddit');

    expect(container.textContent).toContain('LevelTwoAuthor');
    expect(container.textContent).toContain('LevelThreeAuthor');
    expect(container.querySelector('.cr-depth-btn')).toBeNull();
  });

  it('collapses and expands a single branch without removing the parent comment', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      {
        id: 'root',
        author: { name: 'RootAuthor', url: 'https://www.reddit.com/user/root' },
        content: 'Root comment',
        replies: [
          {
            id: 'level1',
            author: { name: 'LevelOneAuthor', url: 'https://www.reddit.com/user/one' },
            content: 'Level 1',
            replies: [
              {
                id: 'level2',
                author: { name: 'LevelTwoAuthor', url: 'https://www.reddit.com/user/two' },
                content: 'Level 2',
              },
            ],
          },
        ],
      },
    ];

    new CommentRenderer().render(container, comments, 'reddit');

    const rootToggle = container.querySelector<HTMLButtonElement>('.cr-thread-toggle');
    expect(rootToggle?.textContent).toBe('');
    expect(rootToggle?.querySelector('.cr-thread-toggle-icon')).toBeTruthy();
    rootToggle?.click();

    expect(container.textContent).toContain('RootAuthor');
    expect(container.textContent).not.toContain('LevelOneAuthor');
    expect(container.textContent).toContain('Show 2 replies');

    const showRepliesButton = container.querySelector<HTMLButtonElement>('.cr-hidden-replies');
    showRepliesButton?.click();

    expect(container.textContent).toContain('LevelOneAuthor');
    expect(container.textContent).toContain('LevelTwoAuthor');
  });
});
