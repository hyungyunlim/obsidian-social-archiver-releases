import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';

describe('Tiptap Editor Integration', () => {
  let editor: Editor;
  let editorElement: HTMLDivElement;

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

  it('should instantiate Tiptap editor with StarterKit', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: '<p>Hello World</p>',
    });

    expect(editor).toBeDefined();
    expect(editor.isDestroyed).toBe(false);
    expect(editor.getHTML()).toContain('Hello World');
  });

  it('should support Markdown extension', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, Markdown],
      content: '**Bold** text',
    });

    expect(editor).toBeDefined();
    expect(editor.storage.markdown).toBeDefined();

    // Get markdown output
    const markdown = editor.storage.markdown.getMarkdown();
    expect(markdown).toContain('**Bold**');
  });

  it('should support Placeholder extension', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: "What's on your mind?",
        }),
      ],
      content: '',
    });

    expect(editor).toBeDefined();
    expect(editor.isEmpty).toBe(true);
  });

  it('should support Image extension', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, Image],
      content: '<p>Test</p>',
    });

    expect(editor).toBeDefined();

    // Insert image
    editor.chain().focus().setImage({ src: 'https://example.com/image.png' }).run();

    const html = editor.getHTML();
    expect(html).toContain('img');
    expect(html).toContain('https://example.com/image.png');
  });

  it('should support Link extension with autolink', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit,
        Link.configure({
          openOnClick: false,
          autolink: true,
        }),
      ],
      content: '<p>Check https://example.com</p>',
    });

    expect(editor).toBeDefined();
    expect(editor.getHTML()).toContain('example.com');
  });

  it('should support all required extensions together', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit,
        Markdown,
        Placeholder.configure({ placeholder: "What's on your mind?" }),
        Image,
        Link.configure({ openOnClick: false, autolink: true }),
      ],
      content: '',
      editorProps: {
        attributes: {
          class: 'tiptap-editor-content',
          spellcheck: 'false',
        },
      },
    });

    expect(editor).toBeDefined();
    expect(editor.isDestroyed).toBe(false);
    expect(editor.storage.markdown).toBeDefined();

    // Test basic functionality
    editor.commands.setContent('# Hello World\n\nThis is **bold** text.');

    const markdown = editor.storage.markdown.getMarkdown();
    expect(markdown).toContain('# Hello World');
    expect(markdown).toContain('**bold**');
  });

  it('should handle content updates', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, Markdown],
      content: '',
    });

    // Set content
    editor.commands.setContent('Initial content');
    expect(editor.getHTML()).toContain('Initial content');

    // Update content
    editor.commands.setContent('Updated content');
    expect(editor.getHTML()).toContain('Updated content');
    expect(editor.getHTML()).not.toContain('Initial content');
  });

  it('should support markdown serialization', () => {
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, Markdown],
      content: '',
    });

    // Set markdown content
    const markdownInput = `# Title\n\nParagraph with **bold** and *italic*.\n\n- List item 1\n- List item 2`;
    editor.commands.setContent(markdownInput);

    // Get markdown output
    const markdownOutput = editor.storage.markdown.getMarkdown();

    expect(markdownOutput).toContain('# Title');
    expect(markdownOutput).toContain('**bold**');
    expect(markdownOutput).toContain('*italic*');
    expect(markdownOutput).toContain('- List item');
  });
});
