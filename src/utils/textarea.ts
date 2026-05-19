/**
 * Grow a textarea to fit its current content without overriding a larger
 * user-resized height.
 */
export function resizeTextareaToContent(textarea: HTMLTextAreaElement): void {
  const currentHeight = Math.ceil(textarea.getBoundingClientRect().height || textarea.offsetHeight || 0);

  textarea.style.height = 'auto';

  const contentHeight = textarea.scrollHeight;
  if (contentHeight <= 0) {
    if (currentHeight > 0) {
      textarea.style.height = `${currentHeight}px`;
    }
    return;
  }

  textarea.style.height = `${Math.max(contentHeight, currentHeight)}px`;
}

/**
 * Attach auto-grow behavior to a textarea. Returns a cleanup function for
 * callers that own short-lived DOM nodes.
 */
export function attachAutosizingTextarea(
  textarea: HTMLTextAreaElement,
  options: { resizeOnAttach?: boolean } = {}
): () => void {
  const { resizeOnAttach = true } = options;
  let frame: number | null = null;

  const run = () => {
    frame = null;
    resizeTextareaToContent(textarea);
  };

  const schedule = () => {
    if (frame !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frame);
    }

    if (typeof window.requestAnimationFrame === 'function') {
      frame = window.requestAnimationFrame(run);
    } else {
      run();
    }
  };

  const handlePaste = () => {
    window.setTimeout(schedule, 0);
  };

  textarea.addEventListener('input', schedule);
  textarea.addEventListener('paste', handlePaste);

  if (resizeOnAttach) {
    schedule();
  }

  return () => {
    if (frame !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    textarea.removeEventListener('input', schedule);
    textarea.removeEventListener('paste', handlePaste);
  };
}
