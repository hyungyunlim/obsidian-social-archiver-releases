import { describe, expect, it } from 'vitest';
import { escapeHtmlOpeners, noteTextForServer, repairHtmlOpeners } from '@/utils/escape-html-openers';

describe('escapeHtmlOpeners (note writer)', () => {
  it('writes every plain `<` and an older `&lt;` as `\\<`, code verbatim', () => {
    expect(escapeHtmlOpeners('<Brass clip customisation workshop>\nuse `<video>` and &lt;b> <3'))
      .toBe('\\<Brass clip customisation workshop>\nuse `<video>` and \\<b> \\<3');
    expect(escapeHtmlOpeners('```\n<div>\n```\n<div>')).toBe('```\n<div>\n```\n\\<div>');
  });

  it('changes nothing on a second pass', () => {
    const once = escapeHtmlOpeners('<a> &lt;b> \\<c>');
    expect(escapeHtmlOpeners(once)).toBe(once);
  });
});

describe('repairHtmlOpeners (existing notes)', () => {
  it('escapes only a `<` that opens HTML, and `&lt;`', () => {
    expect(repairHtmlOpeners('<untitled>, <Hang On> </b> &lt;self-portrait>'))
      .toBe('\\<untitled>, \\<Hang On> \\</b> \\<self-portrait>');
  });

  it('leaves a `<3`, `< 5`, autolinks, code and an existing `\\<`', () => {
    const text = 'I <3 it, < 5 <https://x.com/a> <me@example.com> `<b>` \\<kept> <!-- sa:media:start id=a -->\n```\n<div>\n```';
    expect(repairHtmlOpeners(text)).toBe(text);
  });
});

describe('noteTextForServer', () => {
  it('sends the note escape as the `&lt;` the server keeps, code verbatim', () => {
    expect(noteTextForServer('\\<inputs> `\\<x>` <3')).toBe('&lt;inputs> `\\<x>` <3');
  });
});
