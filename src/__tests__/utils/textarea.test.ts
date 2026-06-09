import { describe, expect, it, vi } from 'vitest';
import { attachAutosizingTextarea, resizeTextareaToContent } from '../../utils/textarea';

function makeTextarea(scrollHeight: number, renderedHeight = 0): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({
    width: 320,
    height: renderedHeight,
    top: 0,
    right: 320,
    bottom: renderedHeight,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return textarea;
}

describe('textarea autosize utilities', () => {
  it('grows a textarea to its scroll height', () => {
    const textarea = makeTextarea(180, 80);

    resizeTextareaToContent(textarea);

    expect(textarea.classList.contains('sa-autosizing-textarea')).toBe(true);
    expect(textarea.style.getPropertyValue('--sa-autosizing-textarea-height')).toBe('180px');
  });

  it('preserves a larger manually resized height', () => {
    const textarea = makeTextarea(120, 240);

    resizeTextareaToContent(textarea);

    expect(textarea.style.getPropertyValue('--sa-autosizing-textarea-height')).toBe('240px');
  });

  it('updates height after input events', () => {
    const textarea = makeTextarea(160, 80);
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = undefined as unknown as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = undefined as unknown as typeof window.cancelAnimationFrame;

    try {
      const detach = attachAutosizingTextarea(textarea, { resizeOnAttach: false });
      textarea.dispatchEvent(new Event('input'));

      expect(textarea.style.getPropertyValue('--sa-autosizing-textarea-height')).toBe('160px');
      detach();
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});
