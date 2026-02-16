import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import CharacterCount from '@tiptap/extension-character-count';
import { Markdown } from 'tiptap-markdown';

/**
 * MarkdownEditor Component Tests
 *
 * Tests the MarkdownEditor component's core functionality:
 * - Markdown serialization/deserialization
 * - Character limit enforcement
 * - Auto-link detection
 * - Clipboard serialization
 * - Component props and lifecycle
 */

describe('MarkdownEditor Component', () => {
  let editor: Editor;
  let editorElement: HTMLDivElement;
  const maxLength = 10000;

  beforeEach(() => {
    // Create a DOM element for the editor
    editorElement = document.createElement('div');
    document.body.appendChild(editorElement);
  });

  afterEach(() => {
    // Cleanup
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
    if (editorElement && editorElement.parentNode) {
      editorElement.parentNode.removeChild(editorElement);
    }
  });

  describe('Basic Initialization', () => {
    it('should initialize with all required extensions', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          Markdown,
          CharacterCount.configure({ limit: maxLength, mode: 'textSize' }),
          Placeholder.configure({ placeholder: "What's on your mind?" }),
          Image,
          Link.configure({ openOnClick: false, autolink: true }),
        ],
        content: '',
      });

      expect(editor).toBeDefined();
      expect(editor.isDestroyed).toBe(false);
      expect(editor.storage.markdown).toBeDefined();
      expect(editor.storage.characterCount).toBeDefined();
    });

    it('should set spellcheck to false', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        editorProps: {
          attributes: {
            spellcheck: 'false',
          },
        },
      });

      const editorContent = editorElement.querySelector('.ProseMirror');
      expect(editorContent?.getAttribute('spellcheck')).toBe('false');
    });

    it('should initialize with placeholder text', () => {
      const placeholderText = "What's on your mind?";
      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          Placeholder.configure({ placeholder: placeholderText }),
        ],
        content: '',
      });

      expect(editor.isEmpty).toBe(true);
    });
  });

  describe('Markdown Serialization', () => {
    beforeEach(() => {
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit, Markdown],
        content: '',
      });
    });

    it('should serialize bold text to Markdown', () => {
      editor.commands.setContent('<p><strong>Bold text</strong></p>');
      const markdown = editor.storage.markdown.getMarkdown();
      expect(markdown).toContain('**Bold text**');
    });

    it('should serialize italic text to Markdown', () => {
      editor.commands.setContent('<p><em>Italic text</em></p>');
      const markdown = editor.storage.markdown.getMarkdown();
      expect(markdown).toContain('*Italic text*');
    });

    it('should serialize headings to Markdown', () => {
      editor.commands.setContent('<h1>Title</h1><h2>Subtitle</h2>');
      const markdown = editor.storage.markdown.getMarkdown();
      expect(markdown).toContain('# Title');
      expect(markdown).toContain('## Subtitle');
    });

    it('should serialize lists to Markdown', () => {
      editor.commands.setContent('<ul><li>Item 1</li><li>Item 2</li></ul>');
      const markdown = editor.storage.markdown.getMarkdown();
      expect(markdown).toContain('- Item 1');
      expect(markdown).toContain('- Item 2');
    });

    it('should serialize links to Markdown', () => {
      editor.commands.setContent('<p><a href="https://example.com">Link</a></p>');
      const markdown = editor.storage.markdown.getMarkdown();
      expect(markdown).toContain('[Link](https://example.com)');
    });

    it('should deserialize Markdown to HTML', () => {
      const markdownInput = '# Hello\n\nThis is **bold** and *italic*.';
      editor.commands.setContent(markdownInput);

      const html = editor.getHTML();
      expect(html).toContain('<h1>');
      expect(html).toContain('Hello');
      expect(html).toContain('<strong>');
      expect(html).toContain('bold');
      expect(html).toContain('<em>');
      expect(html).toContain('italic');
    });
  });

  describe('Character Count and Limit', () => {
    beforeEach(() => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          CharacterCount.configure({ limit: maxLength, mode: 'textSize' }),
        ],
        content: '',
      });
    });

    it('should count characters correctly', () => {
      const text = 'Hello World';
      editor.commands.setContent(`<p>${text}</p>`);

      const count = editor.storage.characterCount.characters();
      expect(count).toBe(text.length);
    });

    it('should enforce character limit', () => {
      const shortLimit = 10;
      editor.destroy();

      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          CharacterCount.configure({ limit: shortLimit, mode: 'textSize' }),
        ],
        content: '',
      });

      // Try to insert text longer than limit
      const longText = 'This is a very long text that exceeds the limit';
      editor.commands.setContent(`<p>${longText}</p>`);

      const count = editor.storage.characterCount.characters();
      // CharacterCount should enforce the limit
      expect(count).toBeLessThanOrEqual(shortLimit);
    });

    it('should track character count changes', () => {
      editor.commands.setContent('<p>Initial</p>');
      const initialCount = editor.storage.characterCount.characters();

      editor.commands.insertContent(' Added');
      const newCount = editor.storage.characterCount.characters();

      expect(newCount).toBeGreaterThan(initialCount);
    });

    it('should handle empty content', () => {
      editor.commands.setContent('');
      const count = editor.storage.characterCount.characters();
      expect(count).toBe(0);
    });
  });

  describe('Auto-link Detection', () => {
    beforeEach(() => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          Link.configure({ openOnClick: false, autolink: true }),
          Markdown,
        ],
        content: '',
      });
    });

    it('should detect HTTP URLs', () => {
      editor.commands.setContent('<p>Check http://example.com</p>');
      const html = editor.getHTML();
      expect(html).toContain('href="http://example.com"');
    });

    it('should detect HTTPS URLs', () => {
      editor.commands.setContent('<p>Check https://example.com</p>');
      const html = editor.getHTML();
      expect(html).toContain('href="https://example.com"');
    });

    it('should preserve link attributes', () => {
      editor.destroy();

      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          Link.configure({
            openOnClick: false,
            autolink: true,
            HTMLAttributes: {
              class: 'editor-link',
              rel: 'noopener noreferrer',
              target: '_blank',
            },
          }),
        ],
        content: '',
      });

      editor.commands.setContent('<p>Check <a href="https://example.com">link</a></p>');
      const html = editor.getHTML();

      expect(html).toContain('class="editor-link"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('target="_blank"');
    });
  });

  describe('Clipboard Serialization', () => {
    beforeEach(() => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          Markdown.configure({
            html: false,
            transformCopiedText: true,
            transformPastedText: true,
          }),
        ],
        content: '',
      });
    });

    it('should transform copied text to Markdown', () => {
      editor.commands.setContent('<p><strong>Bold</strong> and <em>italic</em></p>');

      const markdown = editor.storage.markdown.getMarkdown();
      expect(markdown).toContain('**Bold**');
      expect(markdown).toContain('*italic*');
    });

    it('should transform pasted Markdown to HTML', () => {
      const markdownInput = '**Bold** and *italic*';
      editor.commands.setContent(markdownInput);

      const html = editor.getHTML();
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
    });
  });

  describe('Content Management', () => {
    beforeEach(() => {
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit, Markdown],
        content: '',
      });
    });

    it('should set content programmatically', () => {
      const content = '# Hello World';
      editor.commands.setContent(content);

      const markdown = editor.storage.markdown.getMarkdown();
      expect(markdown).toContain('# Hello World');
    });

    it('should get content as Markdown', () => {
      editor.commands.setContent('<h1>Hello</h1><p>World</p>');
      const markdown = editor.storage.markdown.getMarkdown();

      expect(markdown).toContain('# Hello');
      expect(markdown).toContain('World');
    });

    it('should clear content', () => {
      editor.commands.setContent('Some content');
      expect(editor.isEmpty).toBe(false);

      editor.commands.clearContent();
      expect(editor.isEmpty).toBe(true);
    });

    it('should check if editor is empty', () => {
      expect(editor.isEmpty).toBe(true);

      editor.commands.setContent('Not empty');
      expect(editor.isEmpty).toBe(false);
    });

    it('should handle readonly mode', () => {
      editor.setEditable(false);
      expect(editor.isEditable).toBe(false);

      editor.setEditable(true);
      expect(editor.isEditable).toBe(true);
    });
  });

  describe('Lifecycle Management', () => {
    it('should create and destroy editor properly', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: '',
      });

      expect(editor.isDestroyed).toBe(false);

      editor.destroy();
      expect(editor.isDestroyed).toBe(true);
    });

    it('should handle multiple destroy calls', () => {
      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: '',
      });

      editor.destroy();
      expect(editor.isDestroyed).toBe(true);

      // Should not throw on second destroy
      expect(() => editor.destroy()).not.toThrow();
    });
  });

  describe('Event Handling', () => {
    it('should trigger onCreate callback', () => {
      const onCreate = vi.fn();

      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: '',
        onCreate,
      });

      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('should trigger onUpdate callback', () => {
      const onUpdate = vi.fn();

      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: '',
        onUpdate,
      });

      editor.commands.setContent('New content');
      expect(onUpdate).toHaveBeenCalled();
    });

    it('should trigger onDestroy callback', () => {
      const onDestroy = vi.fn();

      editor = new Editor({
        element: editorElement,
        extensions: [StarterKit],
        content: '',
        onDestroy,
      });

      editor.destroy();
      expect(onDestroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Image Handling', () => {
    beforeEach(() => {
      editor = new Editor({
        element: editorElement,
        extensions: [
          StarterKit,
          Image.configure({
            inline: true,
            HTMLAttributes: {
              class: 'editor-image',
            },
          }),
        ],
        content: '',
      });
    });

    it('should insert images', () => {
      const imageSrc = 'https://example.com/image.png';
      editor.chain().focus().setImage({ src: imageSrc }).run();

      const html = editor.getHTML();
      expect(html).toContain('img');
      expect(html).toContain(imageSrc);
    });

    it('should apply image attributes', () => {
      editor.chain().focus().setImage({ src: 'https://example.com/image.png' }).run();

      const html = editor.getHTML();
      expect(html).toContain('class="editor-image"');
    });
  });
});
