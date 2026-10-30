import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { PostShareSettings } from '@/types/collections';

/**
 * A post with no link: the share modal shows the settings, defaulted, and
 * publishes only on "Create link and copy" — with what was picked.
 */

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  const Base = actual['Setting'] as new (el: HTMLElement) => { controlEl: HTMLElement };
  class Setting extends Base {
    addDropdown(cb: (d: unknown) => void): this {
      const select = this.controlEl.createEl('select');
      cb({
        addOption: (value: string, label: string) => select.createEl('option', { value, text: label }),
        setValue: (value: string) => { select.value = value; },
        setDisabled: (disabled: boolean) => { select.disabled = disabled; },
        onChange: (fn: (value: string) => void) => select.addEventListener('change', () => fn(select.value)),
      });
      return this;
    }
    addToggle(cb: (t: unknown) => void): this {
      const input = this.controlEl.createEl('input', { type: 'checkbox' });
      cb({
        setValue: (value: boolean) => { input.checked = value; },
        setDisabled: (disabled: boolean) => { input.disabled = disabled; },
        onChange: (fn: (value: boolean) => void) => input.addEventListener('change', () => fn(input.checked)),
      });
      return this;
    }
    addButton(cb: (b: unknown) => void): this {
      const button = this.controlEl.createEl('button');
      const api = {
        setButtonText: (text: string) => { button.textContent = text; return api; },
        setCta: () => api,
        setDisabled: (disabled: boolean) => { button.disabled = disabled; return api; },
        onClick: (fn: () => void) => button.addEventListener('click', fn),
      };
      cb(api);
      return this;
    }
  }
  return { ...actual, Setting, setIcon: () => undefined };
});

import { NewPostShareModal } from '@/components/timeline/collections/PostShareSettingsModal';

const SHARE_URL = 'https://social-archive.org/owner/share-1';
const INITIAL: PostShareSettings = { visibility: 'public', displayMode: 'reader', includeAnnotations: true };

function open(create: (settings: PostShareSettings) => Promise<string | null>) {
  const onClosed = vi.fn();
  const modal = new NewPostShareModal({} as App, { initial: INITIAL, create, onClosed });
  modal.open();
  const el = modal.contentEl;
  return {
    onClosed,
    radio: (label: string) => [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((b) => b.textContent?.includes(label)),
    select: () => el.querySelector('select')!,
    toggle: () => el.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
    createButton: () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Create link and copy')!,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('NewPostShareModal', () => {
  it('shows the defaults and publishes only on Create, with the picked settings', async () => {
    const create = vi.fn(async () => SHARE_URL);
    const ui = open(create);

    expect(ui.radio('Public')?.getAttribute('aria-checked')).toBe('true');
    expect(ui.select().value).toBe('reader');
    expect(ui.toggle().checked).toBe(true);

    ui.radio('Anyone with the link')?.click();
    ui.select().value = 'card';
    ui.select().dispatchEvent(new Event('change'));
    ui.toggle().checked = false;
    ui.toggle().dispatchEvent(new Event('change'));
    expect(create).not.toHaveBeenCalled();
    // The re-render keeps what was picked.
    expect(ui.radio('Anyone with the link')?.getAttribute('aria-checked')).toBe('true');

    ui.createButton().click();
    await settle();

    expect(create).toHaveBeenCalledWith({ visibility: 'unlisted', displayMode: 'card', includeAnnotations: false });
    expect(ui.onClosed).toHaveBeenCalledWith(SHARE_URL);
  });

  it('stays open to try again when the create fails', async () => {
    const create = vi.fn(async () => null);
    const ui = open(create);

    ui.createButton().click();
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(ui.onClosed).not.toHaveBeenCalled();
    expect(ui.createButton().disabled).toBe(false);
  });
});
