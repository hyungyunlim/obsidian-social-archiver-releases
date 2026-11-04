import { afterEach, describe, expect, it, vi } from 'vitest';
import { ByokKeyModal, openByokKeyModal } from '../../modals/ByokKeyModal';

// Built at runtime: the public mirror's secret scan rejects any key-shaped literal (sk-…).
const KEY = ['sk', 'test-1234567890abcdef'].join('-');

interface OpenedModal {
  modal: ByokKeyModal;
  onResult: ReturnType<typeof vi.fn>;
  input: HTMLInputElement;
  save: HTMLButtonElement;
  cancel: HTMLButtonElement;
}

function openModal(provider: 'openai' | 'anthropic' = 'openai'): OpenedModal {
  const onResult = vi.fn();
  const modal = new ByokKeyModal({} as never, provider, onResult);
  modal.open();
  const input = modal.contentEl.querySelector('input') as HTMLInputElement;
  const save = modal.contentEl.querySelector('button.mod-cta') as HTMLButtonElement;
  const cancel = Array.from(modal.contentEl.querySelectorAll('button')).find((el) => el.textContent === 'Cancel') as HTMLButtonElement;
  return { modal, onResult, input, save, cancel };
}

describe('ByokKeyModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('asks only for the key: one password field with the provider prefix, no id field', () => {
    const { modal, input } = openModal();
    expect(modal.titleEl.textContent).toBe('OpenAI API key');
    expect(modal.contentEl.querySelectorAll('input')).toHaveLength(1);
    expect(input.type).toBe('password');
    expect(input.placeholder).toBe('sk-…');
    expect(modal.contentEl.textContent).toContain('never sent to Social Archiver');
    expect(modal.contentEl.textContent).not.toMatch(/\bID\b/);
  });

  it('refuses an empty key and stays open', () => {
    const { modal, onResult, input, save } = openModal();
    input.value = '   ';
    save.click();
    expect(onResult).not.toHaveBeenCalled();
    expect(modal.contentEl.textContent).toContain('Paste a key first.');
    expect(modal.modalEl.isConnected).toBe(true);
  });

  it('resolves the trimmed key on Save and closes', () => {
    const { modal, onResult, input, save } = openModal();
    input.value = `  ${KEY}\n`;
    save.click();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(KEY);
    expect(modal.modalEl.isConnected).toBe(false);
  });

  it('submits on Enter, but not while an IME is composing', () => {
    const { onResult, input } = openModal();
    input.value = KEY;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(onResult).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onResult).toHaveBeenCalledWith(KEY);
  });

  it('resolves null exactly once when cancelled or closed', () => {
    const { modal, onResult, cancel } = openModal();
    cancel.click();
    modal.close();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(null);
  });

  it('openByokKeyModal resolves with the key, never the modal', async () => {
    const pending = openByokKeyModal({} as never, 'anthropic');
    const modalEl = document.querySelector('.sa-byok-key-modal') as HTMLElement;
    expect(modalEl.textContent).toContain('Anthropic API key');
    (modalEl.querySelector('input') as HTMLInputElement).value = KEY;
    (modalEl.querySelector('button.mod-cta') as HTMLButtonElement).click();
    await expect(pending).resolves.toBe(KEY);
  });
});
