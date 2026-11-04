import { afterEach, describe, expect, it } from 'vitest';
import { openByokConsentModal } from '../../modals/ByokConsentModal';

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.modal-button-container button'));
}

describe('ByokConsentModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('says what goes where and resolves true on Allow', async () => {
    const answer = openByokConsentModal({} as never, 'anthropic');
    const text = document.body.textContent ?? '';
    expect(text).toContain('Use your Anthropic key?');
    expect(text).toContain('transcript');
    expect(text).toContain('Anthropic bills your own account');
    expect(text).toContain('Social Archiver never sees it');
    expect(document.querySelector('a')?.getAttribute('href')).toBe('https://www.anthropic.com/legal/privacy');

    buttons().find((button) => button.textContent === 'Allow')?.click();
    await expect(answer).resolves.toBe(true);
    expect(buttons()).toHaveLength(0);
  });

  it('resolves false on Cancel', async () => {
    const answer = openByokConsentModal({} as never, 'openai');
    buttons().find((button) => button.textContent === 'Cancel')?.click();
    await expect(answer).resolves.toBe(false);
  });
});
