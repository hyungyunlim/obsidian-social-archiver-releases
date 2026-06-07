/**
 * AnnotationBlockParser — unit tests.
 *
 * Pins the reverse of AnnotationRenderer: render → parse must recover the note
 * bodies and timestamps, tolerating the callout escaping (U+200B, `\---`).
 *
 * NOTE: run by the user — never executed in this environment (plugin test rule).
 */

import { describe, it, expect } from 'vitest';
import { parseAnnotationBlock } from '../../../services/markdown/AnnotationBlockParser';
import { AnnotationRenderer } from '../../../services/AnnotationRenderer';
import type { UserNote, TextHighlight } from '../../../types/annotations';

function makeNote(overrides: Partial<UserNote> = {}): UserNote {
  return {
    id: 'n-1',
    content: 'Plain note body.',
    createdAt: '2026-06-06T14:35:00.000Z',
    updatedAt: '2026-06-06T14:35:00.000Z',
    ...overrides,
  };
}

function makeHighlight(overrides: Partial<TextHighlight> = {}): TextHighlight {
  return {
    id: 'hl-1',
    text: 'Important passage',
    startOffset: 0,
    endOffset: 5,
    color: 'yellow',
    createdAt: '2026-06-06T14:30:00.000Z',
    updatedAt: '2026-06-06T14:30:00.000Z',
    ...overrides,
  };
}

describe('parseAnnotationBlock', () => {
  const renderer = new AnnotationRenderer(); // no-op resolvers → tokens become plain text

  it('returns null when there is no annotation block', () => {
    expect(parseAnnotationBlock('# Just a note\n\nbody text')).toBeNull();
    expect(parseAnnotationBlock('')).toBeNull();
  });

  it('recovers a single note body and timestamp from a rendered block', () => {
    const block = renderer.render({ notes: [makeNote()], highlights: [] });
    // Simulate the real file: footer then the appended annotation block.
    const file = `# Title\n\nbody\n\n---\n\n**Platform:** x\n\n${block}\n`;

    const parsed = parseAnnotationBlock(file);
    expect(parsed).not.toBeNull();
    expect(parsed!.notes).toHaveLength(1);
    expect(parsed!.notes[0]!.content).toBe('Plain note body.');
    // Timestamp is a local-formatted display string (YYYY-MM-DD HH:mm).
    expect(parsed!.notes[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('recovers multiple notes in render (createdAt-sorted) order', () => {
    const notes = [
      makeNote({ id: 'a', content: 'Later', createdAt: '2026-06-06T11:00:00.000Z' }),
      makeNote({ id: 'b', content: 'Earlier', createdAt: '2026-06-06T10:00:00.000Z' }),
    ];
    const block = renderer.render({ notes, highlights: [] });
    const parsed = parseAnnotationBlock(block);
    expect(parsed!.notes.map((n) => n.content)).toEqual(['Earlier', 'Later']);
  });

  it('recovers a multi-line note body', () => {
    const note = makeNote({ content: 'First line\nSecond line\nThird line' });
    const block = renderer.render({ notes: [note], highlights: [] });
    const parsed = parseAnnotationBlock(block);
    expect(parsed!.notes[0]!.content).toBe('First line\nSecond line\nThird line');
  });

  it('reverses the U+200B escape on a body line starting with >', () => {
    const note = makeNote({ content: '> quoted line' });
    const block = renderer.render({ notes: [note], highlights: [] });
    // The rendered block must carry the zero-width-space escape.
    expect(block).toContain('> ' + '\u200B' + '> quoted line');
    const parsed = parseAnnotationBlock(block);
    expect(parsed!.notes[0]!.content).toBe('> quoted line');
  });

  it('reverses the backslash-escaped horizontal rule', () => {
    const note = makeNote({ content: 'Before\n---\nAfter' });
    const block = renderer.render({ notes: [note], highlights: [] });
    const parsed = parseAnnotationBlock(block);
    expect(parsed!.notes[0]!.content).toBe('Before\n---\nAfter');
  });

  it('reports highlightCount and parses notes from a combined block', () => {
    const block = renderer.render({
      notes: [makeNote({ content: 'note body' })],
      highlights: [makeHighlight(), makeHighlight({ id: 'hl-2', startOffset: 10 })],
    });
    const parsed = parseAnnotationBlock(block);
    expect(parsed!.highlightCount).toBe(2);
    expect(parsed!.notes).toHaveLength(1);
    expect(parsed!.notes[0]!.content).toBe('note body');
  });

  it('does not pick up highlight callouts as notes', () => {
    const block = renderer.render({ notes: [], highlights: [makeHighlight()] });
    const parsed = parseAnnotationBlock(block);
    expect(parsed!.notes).toEqual([]);
    expect(parsed!.highlightCount).toBe(1);
  });

  it('keeps a converted wikilink token intact in the recovered body', () => {
    // With no-op resolvers a token degrades to plain text; emulate a resolved
    // wikilink by passing one straight through the renderer body.
    const note = makeNote({ content: 'see [[Some Note|alias]] now' });
    const block = renderer.render({ notes: [note], highlights: [] });
    const parsed = parseAnnotationBlock(block);
    expect(parsed!.notes[0]!.content).toBe('see [[Some Note|alias]] now');
  });
});
