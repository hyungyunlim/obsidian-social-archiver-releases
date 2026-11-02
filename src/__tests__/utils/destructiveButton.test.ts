import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiVersion } from 'obsidian';
import { setDestructive } from '../../utils/destructiveButton';

function fakeButton(): { buttonEl: HTMLButtonElement; setDestructive: () => unknown; setCta: () => unknown } {
  const button = {
    buttonEl: createEl('button'),
    setDestructive: vi.fn(() => button),
    setCta: vi.fn(() => button),
  };
  return button;
}

describe('setDestructive', () => {
  afterEach(() => __setApiVersion('1.10.0'));

  it('uses setDestructive().setCta() on 1.13+, as setWarning() does there', () => {
    __setApiVersion('1.13.0');
    const button = fakeButton();
    expect(setDestructive(button as never)).toBe(button);
    expect(button.setDestructive).toHaveBeenCalledOnce();
    expect(button.setCta).toHaveBeenCalledOnce();
    expect(button.buttonEl.classList.contains('mod-warning')).toBe(false);
  });

  it('adds mod-warning before 1.13, where setDestructive() does not exist', () => {
    __setApiVersion('1.12.7');
    const button = fakeButton();
    expect(setDestructive(button as never)).toBe(button);
    expect(button.setDestructive).not.toHaveBeenCalled();
    expect(button.buttonEl.classList.contains('mod-warning')).toBe(true);
  });
});
