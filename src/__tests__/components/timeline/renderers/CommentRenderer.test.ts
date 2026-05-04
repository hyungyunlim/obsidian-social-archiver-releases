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
});
