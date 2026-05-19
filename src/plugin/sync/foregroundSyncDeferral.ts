const BLOCKING_DIALOG_SELECTORS = [
  '.modal-container',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '.suggestion-container',
  '.prompt',
  '.crawl-history-modal-container',
].join(',');

const EDITABLE_FOCUS_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '.ProseMirror',
].join(',');

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export type ForegroundSyncDeferralReason = 'blocking-ui' | 'editable-focus' | 'media-playback';

export interface ForegroundSyncDeferralState {
  shouldDefer: boolean;
  reason: ForegroundSyncDeferralReason | null;
}

export function shouldDeferForegroundSync(doc: Document): boolean {
  return getForegroundSyncDeferral(doc).shouldDefer;
}

export function getForegroundSyncDeferral(doc: Document): ForegroundSyncDeferralState {
  if (hasBlockingDialog(doc)) {
    return { shouldDefer: true, reason: 'blocking-ui' };
  }

  if (hasEditableFocus(doc)) {
    return { shouldDefer: true, reason: 'editable-focus' };
  }

  if (hasPlayingMedia(doc)) {
    return { shouldDefer: true, reason: 'media-playback' };
  }

  return { shouldDefer: false, reason: null };
}

function hasBlockingDialog(doc: Document): boolean {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>(BLOCKING_DIALOG_SELECTORS));
  return candidates.some(isVisibleElement);
}

function hasEditableFocus(doc: Document): boolean {
  const activeElement = getDeepActiveElement(doc);
  if (!(activeElement instanceof HTMLElement)) return false;

  const editableElement = activeElement.closest<HTMLElement>(EDITABLE_FOCUS_SELECTOR);
  if (!editableElement || !isVisibleElement(editableElement)) return false;

  const tagName = editableElement.tagName.toLowerCase();

  if (tagName === 'input') {
    const input = editableElement as HTMLInputElement;
    const inputType = (input.type || 'text').toLowerCase();
    return !input.disabled && !input.readOnly && !NON_TEXT_INPUT_TYPES.has(inputType);
  }

  if (tagName === 'textarea') {
    const textarea = editableElement as HTMLTextAreaElement;
    return !textarea.disabled && !textarea.readOnly;
  }

  if (tagName === 'select') {
    return !(editableElement as HTMLSelectElement).disabled;
  }

  return (
    editableElement.isContentEditable ||
    editableElement.getAttribute('contenteditable') === 'true' ||
    editableElement.getAttribute('contenteditable') === 'plaintext-only' ||
    editableElement.classList.contains('ProseMirror')
  );
}

function getDeepActiveElement(doc: Document): Element | null {
  let activeElement: Element | null = doc.activeElement;

  while (activeElement instanceof HTMLElement && activeElement.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }

  return activeElement;
}

function hasPlayingMedia(doc: Document): boolean {
  const mediaElements = Array.from(doc.querySelectorAll<HTMLMediaElement>('audio, video'));
  return mediaElements.some(isPlayingMedia);
}

function isPlayingMedia(media: HTMLMediaElement): boolean {
  return !media.paused && !media.ended && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

function isVisibleElement(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;

  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;

    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

    current = current.parentElement;
  }

  return true;
}
