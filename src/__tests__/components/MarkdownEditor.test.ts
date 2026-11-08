import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/core';
import CharacterCount from '@tiptap/extension-character-count';
import { composerMarkdown, createComposerEditor } from '@/components/editor/composerMarkdown';
import { escapeComposerText } from '@/components/editor/composerEscape';

/**
 * The new-post composer (MarkdownEditor) on the official @tiptap/markdown
 * (prd-plugin-my-posts §6). Runs the editor MarkdownEditor builds, so these
 * pin what a post written in Obsidian is stored as: the same Markdown mobile,
 * desktop and share-web store.
 */

let editor: Editor | null = null;

function makeEditor(content = ''): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = createComposerEditor({ element, content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = '';
});

describe('MarkdownEditor composer Markdown', () => {
  it('reads its content as Markdown and writes the same Markdown back', () => {
    const markdown = '# Title\n\n**bold** and snake_case\n\n- [x] done\n- [ ] next';
    expect(composerMarkdown(makeEditor(markdown))).toBe(markdown);
  });

  it('keeps a single line break (the community extension merged lines)', () => {
    expect(composerMarkdown(makeEditor('줄\n바꿈'))).toBe('줄\n바꿈');

    const e = makeEditor('');
    e.commands.setContent('<p>a<br>b</p>');
    expect(composerMarkdown(e)).toBe('a  \nb');
  });

  it('keeps socialarchiver:// links (archive and author mentions)', () => {
    const markdown = '[원문](socialarchiver://archive/abc)\n\n[@Me](socialarchiver://author?platform=x&name=Me)';
    expect(composerMarkdown(makeEditor(markdown))).toBe(markdown);

    const e = makeEditor('');
    e.commands.setContent('<p><a href="socialarchiver://archive/x">q</a></p>');
    expect(composerMarkdown(e)).toBe('[q](socialarchiver://archive/x)');
  });

  it('stores "2025. 11. 6" as typed, and pasted plain text stays a paragraph', () => {
    const e = makeEditor('');
    e.commands.setContent('<p>2025. 11. 6</p>');
    expect(composerMarkdown(e)).toBe('2025. 11. 6');

    e.commands.setContent('');
    // jsdom has no ClipboardEvent; a plain paste event is enough for ProseMirror
    e.view.pasteText('2025. 11. 6', new Event('paste') as ClipboardEvent);
    expect(e.getJSON().content?.map((node) => node.type)).toEqual(['paragraph']);
    expect(composerMarkdown(e)).toBe('2025. 11. 6');
  });

  it('serializes task lists and the toolbar marks like share-web', () => {
    const e = makeEditor('');
    e.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'text', text: '중요', marks: [{ type: 'bold' }] },
          { type: 'text', text: '한 ' },
          { type: 'text', text: '취소', marks: [{ type: 'strike' }] },
        ] },
        { type: 'taskList', content: [
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '할 일' }] }] },
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '끝' }] }] },
        ] },
        { type: 'paragraph', content: [{ type: 'text', text: '<책 제목>' }] },
      ],
    });
    expect(composerMarkdown(e)).toBe('**중요**한 ~~취소~~\n\n- [ ] 할 일\n- [x] 끝\n\n&lt;책 제목&gt;');
  });

  it('escapes only real inline syntax in typed text', () => {
    const e = makeEditor('');
    e.commands.setContent('<p>snake_case_name, 5 * 2, [[노트 이름]]</p><p>_기울임_ [괄호]</p>');
    expect(composerMarkdown(e)).toBe('snake_case_name, 5 * 2, [[노트 이름]]\n\n\\_기울임\\_ \\[괄호\\]');
  });

  it('drops the blank lines a trailing empty paragraph adds', () => {
    const e = makeEditor('');
    e.commands.setContent('<p>text</p><p></p>');
    expect(e.getMarkdown()).not.toBe('text');
    expect(composerMarkdown(e)).toBe('text');
  });

  it('copies a selection as Markdown through the same manager', () => {
    const e = makeEditor('**bold** snake_case');
    expect(e.markdown?.serialize(e.getJSON())).toBe('**bold** snake_case');
  });

  it('adds caller extensions after the schema (character count)', () => {
    const element = document.createElement('div');
    editor = createComposerEditor({ element, content: 'Hello', extensions: [CharacterCount.configure({ limit: 10 })] });
    expect(editor.storage.characterCount.characters()).toBe(5);
  });
});

describe('escapeComposerText (share-web fixtures)', () => {
  it('leaves text that cannot re-parse as syntax alone', () => {
    expect(escapeComposerText('snake_case_name, 5 * 2, [[노트 이름]]')).toBe('snake_case_name, 5 * 2, [[노트 이름]]');
  });

  it('escapes what would turn into emphasis, code, strikes or links', () => {
    expect(escapeComposerText('_기울임_ *별표* `틱` ~물결~ [괄호]')).toBe('\\_기울임\\_ \\*별표\\* \\`틱\\` \\~물결\\~ \\[괄호\\]');
  });

  it('escapes every underscore of a run, so __init__ survives the round trip', () => {
    expect(escapeComposerText('__init__ a__b')).toBe('\\_\\_init\\_\\_ a\\_\\_b');
    const e = makeEditor(escapeComposerText('__init__'));
    expect(e.getText()).toBe('__init__');
  });
});
