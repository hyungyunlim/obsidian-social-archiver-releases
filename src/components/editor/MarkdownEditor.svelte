<script lang="ts">
/**
 * MarkdownEditor - Tiptap-based Markdown editor for the new-post composer
 *
 * - Composer schema + official @tiptap/markdown (composerMarkdown.ts): single
 *   line breaks, `socialarchiver://` links and task lists survive, and only
 *   real inline syntax is escaped (same Markdown as mobile, desktop and web)
 * - 10,000 character limit
 * - Copy serializes the selection as Markdown
 */

import { onMount, onDestroy } from 'svelte';
import type { Editor } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { composerMarkdown, createComposerEditor } from './composerMarkdown';

/**
 * Component props
 */
interface MarkdownEditorProps {
  content?: string;
  placeholder?: string;
  maxLength?: number;
  readonly?: boolean;
  onUpdate?: (markdown: string) => void;
  onCharacterCount?: (count: number) => void;
  onBlur?: () => void;
  onPaste?: () => void;
}

let {
  content = '',
  placeholder = "What's on your mind?",
  maxLength = 10000,
  readonly = false,
  onUpdate,
  onCharacterCount,
  onBlur,
  onPaste
}: MarkdownEditorProps = $props();

/**
 * Component state
 */
let editorElement: HTMLDivElement;
let editor: Editor | null = $state(null);
let characterCount = $state(0);
let isLimitReached = $state(false);

/**
 * Initialize Tiptap editor
 */
function initializeEditor(): void {
  if (!editorElement) {
    return;
  }

  editor = createComposerEditor({
    element: editorElement,
    extensions: [
      CharacterCount.configure({
        limit: maxLength,
        mode: 'textSize',
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    editable: !readonly,
    autofocus: true,
    editorProps: {
      attributes: {
        class: 'markdown-editor-content',
        spellcheck: 'false',
      },
      // Copy the selection as Markdown
      clipboardTextSerializer: (slice) => {
        if (!editor?.markdown) return '';
        return editor.markdown.serialize({ type: 'doc', content: slice.content.toJSON() });
      },
      handlePaste: () => {
        if (onPaste) {
          // Use setTimeout to ensure content is updated before callback
          window.setTimeout(() => {
            onPaste();
          }, 100);
        }
        return false; // Allow default paste behavior
      },
    },
    onCreate: ({ editor: createdEditor }) => {
      updateCharacterCount(createdEditor);
    },
    onUpdate: ({ editor: updatedEditor }) => {
      updateCharacterCount(updatedEditor);
      onUpdate?.(composerMarkdown(updatedEditor));
    },
    onBlur: () => {
      onBlur?.();
    },
  });
}

/**
 * Update character count
 */
function updateCharacterCount(editorInstance: Editor): void {
  const count = editorInstance.storage.characterCount?.characters() || 0;
  characterCount = count;

  if (onCharacterCount) {
    onCharacterCount(characterCount);
  }

  // Update limit reached state
  isLimitReached = count >= maxLength;
}

/**
 * Set editor content programmatically (Markdown)
 */
export function setContent(markdown: string): void {
  if (editor && !editor.isDestroyed) {
    editor.commands.setContent(markdown, { contentType: 'markdown' });
  }
}

/**
 * Get current Markdown content
 */
export function getContent(): string {
  if (!editor || editor.isDestroyed) return '';
  return composerMarkdown(editor);
}

/**
 * Clear editor content
 */
export function clear(): void {
  if (editor && !editor.isDestroyed) {
    editor.commands.clearContent();
  }
}

/**
 * Focus the editor
 */
export function focus(): void {
  if (editor && !editor.isDestroyed) {
    editor.commands.focus();
  }
}

/**
 * Get editor instance (for toolbar integration)
 */
export function getEditor() {
  return editor;
}

/**
 * Check if editor is empty
 */
export function isEmpty(): boolean {
  if (!editor || editor.isDestroyed) return true;
  return editor.isEmpty;
}

/**
 * Lifecycle: Mount
 */
onMount(() => {
  initializeEditor();
});

/**
 * Lifecycle: Destroy
 */
onDestroy(() => {
  if (editor && !editor.isDestroyed) {
    editor.destroy();
  }
});

/**
 * Reactive: Update content when prop changes
 */
$effect(() => {
  if (editor && !editor.isDestroyed && content !== undefined) {
    if (composerMarkdown(editor) !== content) {
      editor.commands.setContent(content, { contentType: 'markdown' });
    }
  }
});

/**
 * Reactive: Update editable state
 */
$effect(() => {
  if (editor && !editor.isDestroyed) {
    editor.setEditable(!readonly);
  }
});
</script>

<div class="markdown-editor-container">
  <div
    bind:this={editorElement}
    class="markdown-editor"
    class:readonly
    class:limit-reached={isLimitReached}
  ></div>

  <div class="character-count" class:limit-warning={isLimitReached}>
    {characterCount} / {maxLength}
    {#if isLimitReached}
      <span class="limit-text">Character limit reached</span>
    {/if}
  </div>
</div>

<style>
  .markdown-editor-container {
    position: relative;
    width: 100%;
  }

  .markdown-editor {
    width: 100%;
    box-sizing: border-box;
    height: auto;
    min-height: 150px;
    max-height: none;
    padding: 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-normal);
    font-size: 14px;
    line-height: 1.5;
    overflow-y: visible;
    transition: all 0.2s ease;
  }

  .markdown-editor :global(.ProseMirror) {
    height: auto;
    min-height: 126px; /* 150px - (12px padding * 2) */
    max-height: none;
    overflow-y: visible;
    overflow-wrap: anywhere;
  }

  .markdown-editor:focus-within {
    outline: none;
    border-color: var(--background-modifier-border-hover);
  }

  .markdown-editor.readonly {
    background: var(--background-secondary);
    cursor: not-allowed;
  }

  .markdown-editor.limit-reached {
    border-color: var(--text-error);
  }

  .character-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 8px;
    padding: 0;
    font-size: 11px;
    color: var(--text-faint);
    text-align: right;
    justify-content: flex-end;
  }

  .character-count.limit-warning {
    color: var(--text-error);
    font-weight: 500;
  }

  .limit-text {
    padding: 0.25rem 0.5rem;
    background: var(--background-modifier-error);
    border-radius: 4px;
    font-size: 0.75rem;
  }

  /* Editor content styles */
  :global(.markdown-editor-content) {
    outline: none;
  }

  :global(.markdown-editor-content p) {
    margin: 0.5em 0;
  }

  :global(.markdown-editor-content p:first-child) {
    margin-top: 0;
  }

  :global(.markdown-editor-content p:last-child) {
    margin-bottom: 0;
  }

  :global(.markdown-editor-content h1),
  :global(.markdown-editor-content h2),
  :global(.markdown-editor-content h3) {
    margin: 1em 0 0.5em;
    font-weight: 600;
    line-height: 1.3;
  }

  :global(.markdown-editor-content h1) {
    font-size: 1.5em;
  }

  :global(.markdown-editor-content h2) {
    font-size: 1.25em;
  }

  :global(.markdown-editor-content h3) {
    font-size: 1.125em;
  }

  :global(.markdown-editor-content ul),
  :global(.markdown-editor-content ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  :global(.markdown-editor-content li) {
    margin: 0.25em 0;
  }

  :global(.markdown-editor-content strong) {
    font-weight: 600;
  }

  :global(.markdown-editor-content em) {
    font-style: italic;
  }

  :global(.markdown-editor-content code) {
    padding: 0.125em 0.25em;
    background: var(--background-modifier-border);
    border-radius: 3px;
    font-family: var(--font-monospace);
    font-size: 0.9em;
  }

  :global(.markdown-editor-content .code-block) {
    margin: 0.5em 0;
    padding: 0.75em;
    background: var(--background-secondary);
    border-radius: 6px;
    font-family: var(--font-monospace);
    font-size: 0.9em;
    overflow-x: auto;
  }

  :global(.markdown-editor-content .editor-link) {
    color: var(--interactive-accent);
    text-decoration: underline;
    cursor: pointer;
  }

  :global(.markdown-editor-content .editor-link:hover) {
    color: var(--interactive-accent-hover);
  }

  :global(.markdown-editor-content .editor-image) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    margin: 0.5em 0;
  }

  :global(.markdown-editor-content .ProseMirror-placeholder) {
    color: var(--text-muted);
    pointer-events: none;
    user-select: none;
  }

  :global(.markdown-editor-content p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    color: var(--text-muted);
    pointer-events: none;
    height: 0;
  }

  /* Mobile responsive */
  @media (max-width: 640px) {
    .markdown-editor {
      min-height: 120px;
      font-size: 1rem;
    }

    .markdown-editor :global(.ProseMirror) {
      min-height: 96px; /* 120px - (12px padding * 2) */
    }
  }
</style>
