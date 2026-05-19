import { beforeEach, describe, expect, it } from 'vitest';
import {
  getForegroundSyncDeferral,
  shouldDeferForegroundSync,
} from '@/plugin/sync/foregroundSyncDeferral';

describe('shouldDeferForegroundSync', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not defer when no modal is open and focus is not editable', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    expect(shouldDeferForegroundSync(document)).toBe(false);
  });

  it('defers while an Obsidian modal container is visible', () => {
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    document.body.appendChild(modal);

    expect(shouldDeferForegroundSync(document)).toBe(true);
  });

  it('ignores hidden modal containers', () => {
    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.style.display = 'none';
    document.body.appendChild(modal);

    expect(shouldDeferForegroundSync(document)).toBe(false);
  });

  it('defers while a text input has focus', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    expect(shouldDeferForegroundSync(document)).toBe(true);
  });

  it('does not defer for non-text inputs', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);
    checkbox.focus();

    expect(shouldDeferForegroundSync(document)).toBe(false);
  });

  it('defers while a contenteditable editor has focus', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.tabIndex = 0;
    document.body.appendChild(editor);
    editor.focus();

    expect(shouldDeferForegroundSync(document)).toBe(true);
  });

  it('defers while media is playing', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'ended', { configurable: true, value: false });
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_FUTURE_DATA,
    });
    document.body.appendChild(video);

    expect(getForegroundSyncDeferral(document)).toEqual({
      shouldDefer: true,
      reason: 'media-playback',
    });
  });

  it('does not defer for paused media', () => {
    const audio = document.createElement('audio');
    Object.defineProperty(audio, 'paused', { configurable: true, value: true });
    Object.defineProperty(audio, 'ended', { configurable: true, value: false });
    Object.defineProperty(audio, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_FUTURE_DATA,
    });
    document.body.appendChild(audio);

    expect(shouldDeferForegroundSync(document)).toBe(false);
  });
});
