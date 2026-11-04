import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ByokSecretPickerModal } from '../../modals/ByokSecretPickerModal';

describe('ByokSecretPickerModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('filters saved secret ids, case-insensitively', () => {
    const modal = new ByokSecretPickerModal({} as never, ['my-openai', 'work-openai', 'copilot-anthropic'], vi.fn());
    expect(modal.getSuggestions('OPENAI')).toEqual(['my-openai', 'work-openai']);
    expect(modal.getSuggestions('')).toHaveLength(3);
  });

  it('reports the choice even though Obsidian closes the modal before choosing', () => {
    const onResult = vi.fn();
    const modal = new ByokSecretPickerModal({} as never, ['my-openai'], onResult);
    modal.open();
    modal.close();
    modal.onChooseSuggestion('my-openai');
    vi.runAllTimers();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('my-openai');
  });

  it('reports null when closed without a choice', () => {
    const onResult = vi.fn();
    const modal = new ByokSecretPickerModal({} as never, ['my-openai'], onResult);
    modal.open();
    modal.close();
    vi.runAllTimers();
    expect(onResult).toHaveBeenCalledWith(null);
  });
});
