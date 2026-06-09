import { beforeEach, describe, expect, it } from 'vitest';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import type { Comment } from '@/types/post';

/**
 * Phase 4: CommentRenderer pinned ordering + collapse survival (PRD R3 / R10).
 *
 * - Pinned root threads sort above unpinned ones.
 * - Pinned roots survive the default "show last 2" collapse (slice(-2) fix).
 * - A pinned node shows a "Pinned" badge; a root with a pinned reply shows a
 *   "Pinned reply" indicator. Reply order inside a thread is preserved.
 */

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

function comment(id: string, name: string, extra: Partial<Comment> = {}): Comment {
  return { id, author: { name, url: `https://www.reddit.com/user/${name}` }, content: id, ...extra };
}

/** Document order of root-thread author names that are actually rendered. */
function renderedRootAuthors(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-depth="0"]'))
    .map((el) => el.querySelector('.sa-font-semibold')?.textContent ?? '')
    .filter(Boolean);
}

describe('CommentRenderer — pinned ordering and collapse', () => {
  it('sorts pinned root threads above unpinned and shows a Pinned badge', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      comment('u1', 'Unpinned1'),
      comment('p1', 'PinnedOne', { pinnedAt: '2026-06-09T04:00:00.000Z' }),
    ];

    new CommentRenderer().render(container, comments, 'reddit');

    // Pinned root renders first.
    const roots = renderedRootAuthors(container);
    expect(roots[0]).toBe('PinnedOne');
    // Pinned badge present.
    const badge = container.querySelector('.cr-pinned-badge');
    expect(badge?.textContent).toBe('Pinned');
  });

  it('always shows pinned roots even under the default show-last-2 collapse', () => {
    const container = document.createElement('div');
    // 4 roots → collapsed preview shows only 2. The single pinned root is the
    // OLDEST (index 0) — a blind tail slice would hide it; the fix must surface it.
    const comments: Comment[] = [
      comment('p-old', 'PinnedOldest', { pinnedAt: '2026-06-01T00:00:00.000Z' }),
      comment('u1', 'Unpinned1'),
      comment('u2', 'Unpinned2'),
      comment('u3', 'Unpinned3'),
    ];

    new CommentRenderer().render(container, comments, 'reddit');

    // Collapsed by default — pinned root must be visible, plus the most recent unpinned.
    const text = container.textContent ?? '';
    expect(text).toContain('PinnedOldest');
    expect(text).toContain('Unpinned3');
    // View-all control reflects the full count.
    expect(text).toContain('View all 4 comments');
  });

  it('shows a "Pinned reply" root indicator for a depth-1 pin while keeping reply order', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [
      comment('root', 'RootAuthor', {
        replies: [
          comment('r1', 'FirstReply'),
          comment('r2', 'PinnedReply', { pinnedAt: '2026-06-09T04:00:00.000Z' }),
        ],
      }),
    ];

    new CommentRenderer().render(container, comments, 'reddit');

    // Root-level indicator surfaces the pinned reply before expansion logic.
    const indicator = container.querySelector('.cr-pinned-reply-badge');
    expect(indicator?.textContent).toBe('Pinned reply');

    // Reply order inside the thread is preserved (FirstReply before PinnedReply).
    const replyAuthors = Array.from(
      container.querySelectorAll<HTMLElement>('[data-depth="1"]'),
    ).map((el) => el.querySelector('.sa-font-semibold')?.textContent ?? '');
    expect(replyAuthors).toEqual(['FirstReply', 'PinnedReply']);

    // The pinned reply itself carries the Pinned badge.
    const pinnedBadge = container.querySelector('.cr-pinned-badge');
    expect(pinnedBadge?.textContent).toBe('Pinned');
  });

  it('does not reorder when no comment is pinned (stable original order)', () => {
    const container = document.createElement('div');
    const comments: Comment[] = [comment('a', 'Alpha'), comment('b', 'Bravo')];

    new CommentRenderer().render(container, comments, 'reddit');

    expect(renderedRootAuthors(container)).toEqual(['Alpha', 'Bravo']);
    expect(container.querySelector('.cr-pinned-badge')).toBeNull();
    expect(container.querySelector('.cr-pinned-reply-badge')).toBeNull();
  });
});
