/**
 * AnnotationRenderer — Unit Tests
 *
 * Tests the pure markdown rendering logic for UserNote[] and TextHighlight[].
 * No Obsidian API, no network calls.
 */

import { describe, it, expect } from 'vitest';
import { AnnotationRenderer } from '../../services/AnnotationRenderer';
import type { UserNote, TextHighlight } from '../../types/annotations';

// ─── Fixtures ────────────────────────────────────────────

const START = '<!-- social-archiver:annotations:start -->';
const END = '<!-- social-archiver:annotations:end -->';

function makeNote(overrides: Partial<UserNote> = {}): UserNote {
  return {
    id: 'note-1',
    content: 'This is a note.',
    createdAt: '2026-03-19T14:35:00.000Z',
    updatedAt: '2026-03-19T14:35:00.000Z',
    ...overrides,
  };
}

function makeHighlight(overrides: Partial<TextHighlight> = {}): TextHighlight {
  return {
    id: 'hl-1',
    text: 'Important passage',
    startOffset: 10,
    endOffset: 27,
    color: 'yellow',
    createdAt: '2026-03-19T14:30:00.000Z',
    updatedAt: '2026-03-19T14:30:00.000Z',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────

describe('AnnotationRenderer', () => {
  let renderer: AnnotationRenderer;

  beforeEach(() => {
    renderer = new AnnotationRenderer();
  });

  // ── Empty arrays ──

  describe('empty arrays', () => {
    it('returns empty string when both notes and highlights are empty', () => {
      const result = renderer.render({ notes: [], highlights: [] });
      expect(result).toBe('');
    });
  });

  // ── Highlights only ──

  describe('highlights only', () => {
    it('renders highlights section with correct callout format', () => {
      const hl = makeHighlight();
      const result = renderer.render({ notes: [], highlights: [hl] });

      expect(result).toContain(START);
      expect(result).toContain(END);
      expect(result).toContain('### Highlights (1)');
      expect(result).toContain('> [!quote]+ Highlight 1 · yellow');
      expect(result).toContain('> Important passage');
      expect(result).not.toContain('### Notes');
    });

    it('renders multiple highlights sorted by startOffset ascending', () => {
      const hl1 = makeHighlight({ id: 'hl-1', startOffset: 50, text: 'Second' });
      const hl2 = makeHighlight({ id: 'hl-2', startOffset: 10, text: 'First' });
      const result = renderer.render({ notes: [], highlights: [hl1, hl2] });

      const firstIdx = result.indexOf('> [!quote]+ Highlight 1');
      const secondIdx = result.indexOf('> [!quote]+ Highlight 2');
      expect(firstIdx).toBeLessThan(secondIdx);
      // First highlight should show "First" text (lower offset)
      expect(result.indexOf('First')).toBeLessThan(result.indexOf('Second'));
    });

    it('sorts by createdAt as tie-breaker when startOffset is equal', () => {
      const hl1 = makeHighlight({
        id: 'hl-1',
        startOffset: 10,
        text: 'Earlier',
        createdAt: '2026-03-19T10:00:00.000Z',
      });
      const hl2 = makeHighlight({
        id: 'hl-2',
        startOffset: 10,
        text: 'Later',
        createdAt: '2026-03-19T11:00:00.000Z',
      });
      const result = renderer.render({ notes: [], highlights: [hl2, hl1] });

      expect(result.indexOf('Earlier')).toBeLessThan(result.indexOf('Later'));
    });

    it('renders updatedAt timestamp in the callout', () => {
      const hl = makeHighlight({ updatedAt: '2026-03-19T14:30:00.000Z' });
      const result = renderer.render({ notes: [], highlights: [hl] });

      // We check the "Updated:" prefix exists — exact time depends on local TZ
      expect(result).toContain('> Updated:');
    });

    it('renders highlight with an inline note', () => {
      const hl = makeHighlight({ note: 'This is the key argument' });
      const result = renderer.render({ notes: [], highlights: [hl] });

      expect(result).toContain('> Note: This is the key argument');
    });

    it('renders highlight without inline note (no "Note:" line)', () => {
      const hl = makeHighlight({ note: undefined });
      const result = renderer.render({ notes: [], highlights: [hl] });

      expect(result).not.toContain('> Note:');
    });

    it('does not render empty string inline note', () => {
      const hl = makeHighlight({ note: '   ' });
      const result = renderer.render({ notes: [], highlights: [hl] });

      expect(result).not.toContain('> Note:');
    });

    it('renders different highlight colors', () => {
      const colors: TextHighlight['color'][] = ['yellow', 'green', 'blue', 'pink', 'orange'];
      colors.forEach((color, i) => {
        const hl = makeHighlight({ id: `hl-${i}`, color, startOffset: i * 10 });
        const result = renderer.render({ notes: [], highlights: [hl] });
        expect(result).toContain(`Highlight 1 · ${color}`);
      });
    });

    it('wraps multi-line highlight text in blockquote lines', () => {
      const hl = makeHighlight({ text: 'Line one\nLine two\nLine three' });
      const result = renderer.render({ notes: [], highlights: [hl] });

      expect(result).toContain('> Line one');
      expect(result).toContain('> Line two');
      expect(result).toContain('> Line three');
    });
  });

  // ── Notes only ──

  describe('notes only', () => {
    it('renders notes section with correct callout format', () => {
      const note = makeNote();
      const result = renderer.render({ notes: [note], highlights: [] });

      expect(result).toContain(START);
      expect(result).toContain(END);
      expect(result).toContain('### Notes (1)');
      expect(result).toContain('> [!note]+');
      expect(result).toContain('> This is a note.');
      expect(result).not.toContain('### Highlights');
    });

    it('renders multiple notes sorted by createdAt ascending', () => {
      const n1 = makeNote({
        id: 'n1',
        content: 'Earlier note',
        createdAt: '2026-03-19T10:00:00.000Z',
      });
      const n2 = makeNote({
        id: 'n2',
        content: 'Later note',
        createdAt: '2026-03-19T11:00:00.000Z',
      });
      const result = renderer.render({ notes: [n2, n1], highlights: [] });

      expect(result.indexOf('Earlier note')).toBeLessThan(result.indexOf('Later note'));
    });

    it('wraps multi-line note content in blockquote lines', () => {
      const note = makeNote({ content: 'First line\nSecond line\nThird line' });
      const result = renderer.render({ notes: [note], highlights: [] });

      expect(result).toContain('> First line');
      expect(result).toContain('> Second line');
      expect(result).toContain('> Third line');
    });

    it('shows note count in header', () => {
      const notes = [
        makeNote({ id: 'n1' }),
        makeNote({ id: 'n2', content: 'Another note' }),
      ];
      const result = renderer.render({ notes, highlights: [] });
      expect(result).toContain('### Notes (2)');
    });
  });

  // ── Both notes and highlights ──

  describe('both notes and highlights', () => {
    it('renders both sections in highlights-first order', () => {
      const note = makeNote();
      const hl = makeHighlight();
      const result = renderer.render({ notes: [note], highlights: [hl] });

      expect(result).toContain('### Highlights (1)');
      expect(result).toContain('### Notes (1)');
      // Highlights should appear before Notes in the output
      expect(result.indexOf('### Highlights')).toBeLessThan(result.indexOf('### Notes'));
    });

    it('wraps the whole block in start/end markers', () => {
      const note = makeNote();
      const hl = makeHighlight();
      const result = renderer.render({ notes: [note], highlights: [hl] });

      expect(result.startsWith(START)).toBe(true);
      expect(result.trimEnd().endsWith(END)).toBe(true);
    });

    it('includes the section divider and Mobile Annotations header', () => {
      const note = makeNote();
      const hl = makeHighlight();
      const result = renderer.render({ notes: [note], highlights: [hl] });

      expect(result).toContain('---');
      expect(result).toContain('## Mobile Annotations');
    });
  });

  // ── Escaping ──

  describe('content escaping', () => {
    it('escapes leading > in highlight text with zero-width space', () => {
      const hl = makeHighlight({ text: '> Quote inside highlight' });
      const result = renderer.render({ notes: [], highlights: [hl] });

      // The raw > should be escaped so it is not rendered as nested blockquote
      expect(result).toContain('> \u200B> Quote inside highlight');
    });

    it('escapes leading > in note content', () => {
      const note = makeNote({ content: '> This looks like a blockquote' });
      const result = renderer.render({ notes: [note], highlights: [] });

      expect(result).toContain('> \u200B> This looks like a blockquote');
    });

    it('escapes triple-dash horizontal rule in note content', () => {
      const note = makeNote({ content: 'Before\n---\nAfter' });
      const result = renderer.render({ notes: [note], highlights: [] });

      // The --- line should be escaped to avoid being parsed as <hr>
      expect(result).toContain('> \\---');
    });
  });
});
