import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  setIcon: (el: HTMLElement, iconName: string) => {
    el.setAttribute('data-icon', iconName);
  },
}));

import { CrossPostStatusBanner } from '@/components/timeline/CrossPostStatusBanner';

type ObsidianElement = HTMLElement & {
  createDiv: (opts?: CreateElOpts) => HTMLDivElement;
  createSpan: (opts?: CreateElOpts) => HTMLSpanElement;
  createEl: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: CreateElOpts
  ) => HTMLElementTagNameMap[K];
  empty: () => void;
  addClass: (...names: string[]) => void;
  removeClass: (...names: string[]) => void;
  setText: (text: string) => void;
};

interface CreateElOpts {
  text?: string;
  cls?: string;
  attr?: Record<string, string>;
}

function enrich<T extends HTMLElement>(el: T): T & ObsidianElement {
  const anyEl = el as T & ObsidianElement;
  anyEl.createEl = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: CreateElOpts
  ): HTMLElementTagNameMap[K] => {
    const child = enrich(document.createElement(tag));
    if (opts?.text !== undefined) child.textContent = opts.text;
    if (opts?.cls) child.classList.add(...opts.cls.split(/\s+/).filter(Boolean));
    if (opts?.attr) {
      for (const [key, value] of Object.entries(opts.attr)) {
        child.setAttribute(key, value);
      }
    }
    el.appendChild(child);
    return child;
  };
  anyEl.createDiv = (opts?: CreateElOpts) => anyEl.createEl('div', opts);
  anyEl.createSpan = (opts?: CreateElOpts) => anyEl.createEl('span', opts);
  anyEl.empty = () => {
    while (el.firstChild) el.removeChild(el.firstChild);
  };
  anyEl.addClass = (...names: string[]) => el.classList.add(...names.flatMap((n) => n.split(/\s+/).filter(Boolean)));
  anyEl.removeClass = (...names: string[]) => el.classList.remove(...names.flatMap((n) => n.split(/\s+/).filter(Boolean)));
  anyEl.setText = (text: string) => {
    el.textContent = text;
  };
  return anyEl;
}

describe('CrossPostStatusBanner', () => {
  let parent: ObsidianElement;

  beforeEach(() => {
    parent = enrich(document.createElement('div'));
    document.body.appendChild(parent);
  });

  afterEach(() => {
    parent.remove();
  });

  it('renders a dismissible warning without a posting state first', () => {
    const banner = new CrossPostStatusBanner(parent);

    banner.warn('Cannot reach Social Archiver API. Threads status could not be checked.');

    const container = parent.querySelector<HTMLElement>('.crosspost-status-banners');
    const row = parent.querySelector<HTMLElement>('.crosspost-banner');
    expect(container?.classList.contains('xpb-visible')).toBe(true);
    expect(row?.classList.contains('banner-warning')).toBe(true);
    expect(row?.getAttribute('role')).toBe('alert');
    expect(parent.querySelector<HTMLElement>('.banner-icon')?.getAttribute('data-icon')).toBe('alert-triangle');
    expect(parent.querySelector<HTMLElement>('.banner-text')?.textContent).toContain('Cannot reach');

    parent.querySelector<HTMLButtonElement>('.xpb-dismiss-btn')?.click();

    expect(parent.querySelector('.crosspost-banner')).toBeNull();
    expect(container?.classList.contains('xpb-visible')).toBe(false);
  });

  it('renders a failed state even when show was not called first', () => {
    const banner = new CrossPostStatusBanner(parent);

    banner.fail('Token expired');

    expect(parent.querySelector<HTMLElement>('.crosspost-banner')?.classList.contains('banner-failed')).toBe(true);
    expect(parent.querySelector<HTMLElement>('.banner-icon')?.getAttribute('data-icon')).toBe('x-circle');
    expect(parent.querySelector<HTMLElement>('.banner-text')?.textContent).toBe('Cross-post failed: Token expired');
  });
});
