import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

type Handler = { modifiers: string[] | null; key: string; func: (evt: KeyboardEvent) => unknown };

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  /** Obsidian's Scope: handlers by key, and a parent consulted for keys it has none for. */
  class Scope {
    readonly handlers: Handler[] = [];
    constructor(readonly parent?: Scope) {}
    register(modifiers: string[] | null, key: string, func: Handler['func']): Handler {
      const handler = { modifiers, key, func };
      this.handlers.push(handler);
      return handler;
    }
  }
  return { ...actual, Scope };
});

import { Scope } from 'obsidian';
import { AIMentionPicker } from '@/components/ai-chat/AIMentionPicker';
import type { ChatEngineOption } from '@/components/ai-chat/AIChatPanel';

type FakeScope = Scope & { handlers: Handler[]; parent?: FakeScope };

/** Obsidian's keymap: the scope on top answers first, falling back to its parents; `false` means it took the key. */
function fakeKeymap() {
  const stack: FakeScope[] = [];
  const keymap = {
    pushScope: (scope: FakeScope): void => {
      stack.push(scope);
    },
    popScope: (scope: FakeScope): void => {
      const index = stack.indexOf(scope);
      if (index >= 0) stack.splice(index, 1);
    },
  };
  /** Presses `key` with `modifiers` (['Mod'] for Cmd/Ctrl); true when a scope took it. */
  const press = (key: string, modifiers: string[] = []): boolean => {
    const event = new KeyboardEvent('keydown', { key });
    for (let scope: FakeScope | undefined = stack[stack.length - 1]; scope; scope = scope.parent) {
      const handler = scope.handlers.find((entry) => entry.key === key && (entry.modifiers ?? []).join() === modifiers.join());
      if (handler) return handler.func(event) === false;
    }
    return false;
  };
  return { keymap, press, stack };
}

const ENGINES: ChatEngineOption[] = [
  { id: 'anthropic-api', label: 'Anthropic (my key)', engine: { kind: 'byok', provider: 'anthropic' } },
  { id: 'cloud', label: 'Cloud AI', engine: { kind: 'cloud' } },
];

function setup(engines: ChatEngineOption[] = ENGINES) {
  const { keymap, press, stack } = fakeKeymap();
  const app = { keymap, scope: new Scope() } as unknown as App;
  // The note editor: its own scope with save and cancel.
  const save = vi.fn(() => false);
  const cancel = vi.fn(() => false);
  const editScope = new Scope() as FakeScope;
  editScope.register(['Mod'], 'Enter', save);
  editScope.register([], 'Escape', cancel);
  keymap.pushScope(editScope);

  const box = document.body.createDiv();
  const textarea = box.createEl('textarea');
  const picker = new AIMentionPicker({ app, textarea, engines, scope: editScope });
  const type = (text: string): void => {
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new Event('input'));
  };
  const rows = (): string[] => [...box.querySelectorAll('.sa-ai-mention-option')].map((row) => row.textContent ?? '');
  const selected = (): string => box.querySelector('.sa-ai-mention-option.is-selected .sa-ai-mention-handle')?.textContent ?? '';
  return { picker, textarea, box, type, rows, selected, press, save, cancel, stack, editScope };
}

afterEach(() => {
  document.body.empty();
});

describe('AIMentionPicker', () => {
  it('lists, on "@", only the AIs this vault can ask, filtered by what follows', () => {
    const { type, rows, picker, box, textarea } = setup();
    type('Hi @');
    expect(rows()).toEqual(['@ClaudeAnthropic (my key)', '@CloudAICloud AI']);
    // Right under the box.
    expect(textarea.nextElementSibling).toBe(box.querySelector('.sa-ai-mention-picker'));

    type('Hi @clo');
    expect(rows()).toEqual(['@CloudAICloud AI']);
    type('Hi @anth');
    expect(rows()).toEqual(['@ClaudeAnthropic (my key)']);
    // No key for GPT here, and an e-mail address is no mention.
    type('Hi @gp');
    expect(picker.isOpen).toBe(false);
    type('mail me@cl');
    expect(picker.isOpen).toBe(false);
    type('@Claude ');
    expect(picker.isOpen).toBe(false);
  });

  it('offers nothing when no AI can answer here', () => {
    const { type, picker, stack } = setup([]);
    type('@');
    expect(picker.isOpen).toBe(false);
    expect(stack).toHaveLength(1);
  });

  it('moves with the arrows and inserts with Enter, never saving the note', () => {
    const { type, press, selected, textarea, picker, save } = setup();
    type('Why? @cl');
    expect(selected()).toBe('@Claude');
    expect(press('ArrowDown')).toBe(true);
    expect(selected()).toBe('@CloudAI');
    expect(press('ArrowDown')).toBe(true);
    expect(selected()).toBe('@Claude');
    expect(press('ArrowUp')).toBe(true);
    expect(selected()).toBe('@CloudAI');

    expect(press('Enter')).toBe(true);
    expect(textarea.value).toBe('Why? @CloudAI ');
    expect(textarea.selectionStart).toBe('Why? @CloudAI '.length);
    expect(picker.isOpen).toBe(false);

    // The list is closed: the editor's own keys work again.
    expect(press('Enter', ['Mod'])).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('takes Cmd/Ctrl+Enter and Tab while open, so a half-typed mention is never saved', () => {
    const { type, press, textarea, save } = setup();
    type('@an');
    expect(press('Enter', ['Mod'])).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(textarea.value).toBe('@Claude ');

    type('@Claude and @cl');
    expect(press('Tab')).toBe(true);
    expect(textarea.value).toBe('@Claude and @Claude ');
  });

  it('closes on Escape without cancelling the edit, and stays closed for that "@"', () => {
    const { type, press, picker, cancel, textarea, stack } = setup();
    type('Hi @cl');
    expect(press('Escape')).toBe(true);
    expect(picker.isOpen).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(stack).toHaveLength(1);

    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
    expect(picker.isOpen).toBe(false);
    // The next Escape is the editor's.
    expect(press('Escape')).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);

    // A new "@" opens the list again.
    type('Hi @cl and @');
    expect(picker.isOpen).toBe(true);
  });

  it('inserts the row pressed, keeping the text after the caret', () => {
    const { type, box, textarea } = setup();
    type('Ask @');
    textarea.value = 'Ask @ about it';
    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(new MouseEvent('click'));
    const cloud = [...box.querySelectorAll<HTMLElement>('.sa-ai-mention-option')].find((row) => row.textContent?.startsWith('@CloudAI'));
    cloud?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(textarea.value).toBe('Ask @CloudAI about it');
    expect(textarea.selectionStart).toBe('Ask @CloudAI'.length);
    // "@CloudAI" right before the caret does not offer itself again.
    textarea.dispatchEvent(new MouseEvent('click'));
    expect(box.querySelector('.sa-ai-mention-picker')).toBeNull();
  });

  it('gives its keys back when the box loses focus or the editor closes', () => {
    const { type, textarea, picker, stack } = setup();
    type('@');
    expect(stack).toHaveLength(2);
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(picker.isOpen).toBe(false);
    expect(stack).toHaveLength(1);

    type('@');
    picker.destroy();
    expect(stack).toHaveLength(1);
    type('@');
    expect(picker.isOpen).toBe(false);
  });
});
