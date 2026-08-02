import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ACCOUNT_SECTION_CLS, focusAccountSection } from '../../utils/accountGate';

/**
 * The "Sign in" CTA every account-gated settings section shows when logged out.
 * It used to scroll the tab container, which is not the scrolling element on
 * mobile or under Obsidian 1.13's native renderer — the button read as dead
 * (feedback #108). Pin that it targets the Account section itself.
 */
describe('focusAccountSection', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  const mountAccountSection = () => {
    const section = document.createElement('div');
    section.classList.add(ACCOUNT_SECTION_CLS);
    const email = document.createElement('input');
    email.type = 'email';
    section.appendChild(email);
    root.appendChild(section);

    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    return { section, email, scrollIntoView };
  };

  it('scrolls the account section into view and focuses the email field', () => {
    const { email, scrollIntoView } = mountAccountSection();

    focusAccountSection(root);

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(email);
  });

  it('leaves focus alone when the account section is not mounted', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    expect(() => focusAccountSection(root)).not.toThrow();
    expect(document.activeElement).toBe(outside);
  });
});
