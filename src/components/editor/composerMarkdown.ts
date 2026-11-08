/**
 * The new-post composer's schema and Markdown, on the official @tiptap/markdown
 * (share-web `composerMarkdown.ts`). A post written here is stored as the same
 * Markdown mobile, desktop and the web write: single line breaks kept,
 * `socialarchiver://` links kept, and only real inline syntax escaped.
 */
import { Editor, type AnyExtension, type EditorOptions } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { escapeComposerText } from './composerEscape';

/** Schema extensions of the composer (share-web's kit, plus the plugin's classes). */
export function composerSchemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { class: 'code-block' } },
      // `socialarchiver` keeps archive/author mentions: Link drops hrefs with an unknown scheme.
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['socialarchiver'] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: true, HTMLAttributes: { class: 'editor-image' } }),
  ];
}

/** Swaps the manager's stock escape (every `_ * [ ] ~`) for `escapeComposerText`. */
export function installComposerEscape(manager: MarkdownManager): void {
  // ponytail: the escape hook is private in the typings; an own property shadows it.
  (manager as unknown as { escapeMarkdownSyntax: (text: string) => string }).escapeMarkdownSyntax =
    escapeComposerText;
}

/**
 * An editor on the composer schema that reads its `content` as Markdown and
 * writes Markdown through `editor.getMarkdown()`. `options.extensions` are
 * added after the schema (placeholder, character count).
 */
export function createComposerEditor(options: Partial<EditorOptions> = {}): Editor {
  const editor = new Editor({
    ...options,
    extensions: [...composerSchemaExtensions(), Markdown, ...(options.extensions ?? [])],
    contentType: 'markdown',
  });
  if (editor.markdown) installComposerEscape(editor.markdown);
  return editor;
}

/** The editor's post Markdown, without the trailing blank lines an empty last paragraph adds. */
export function composerMarkdown(editor: Editor): string {
  return editor.getMarkdown().replace(/\n+$/, '');
}
