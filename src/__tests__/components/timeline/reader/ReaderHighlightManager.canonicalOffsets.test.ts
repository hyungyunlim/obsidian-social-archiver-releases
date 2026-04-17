/**
 * ReaderHighlightManager — canonical offset mapping tests
 *
 * Verifies the pure `stripHighlightMarks` helper that powers Phase 2.5 #5:
 * when the vault body already contains `==first==` marks, a newly selected
 * highlight's offsets must be relative to the CANONICAL (`==` stripped) text
 * so subsequent rounds don't shift +4 chars per prior mark.
 *
 * The helper is exported from `ReaderHighlightManager` because (a) it's pure,
 * (b) keeping it next to the manager makes the intent obvious at the call
 * site, and (c) it avoids coupling `src/services/HighlightBodyMarker` to
 * DOM-time concerns.
 */

import { describe, it, expect } from 'vitest';
import { stripHighlightMarks } from '../../../../components/timeline/reader/ReaderHighlightManager';

describe('stripHighlightMarks', () => {
  it('returns input unchanged when no marks are present', () => {
    const dirty = 'the quick brown fox';
    const { canonical, dirtyToCanonical } = stripHighlightMarks(dirty);
    expect(canonical).toBe(dirty);
    expect(dirtyToCanonical.length).toBe(dirty.length);
    // Identity map.
    for (let i = 0; i < dirty.length; i += 1) {
      expect(dirtyToCanonical[i]).toBe(i);
    }
  });

  it('strips a single ==mark== and shifts trailing offsets by -4', () => {
    const dirty = 'alpha ==beta== gamma';
    const { canonical, dirtyToCanonical } = stripHighlightMarks(dirty);
    expect(canonical).toBe('alpha beta gamma');
    // The `g` of `gamma` sits at dirty index 15 (`alpha ==beta== g…`) and
    // canonical index 11 (`alpha beta g…`).
    expect(dirtyToCanonical[15]).toBe(11);
    // Delimiter positions → -1 (first `=` of opening mark at dirty 6).
    expect(dirtyToCanonical[6]).toBe(-1);
    expect(dirtyToCanonical[7]).toBe(-1);
  });

  it('makes later selections addressable by canonical offsets', () => {
    // Reproduces the real-world bug: first highlight wraps `first`, then the
    // user selects `second`. Old code stored startOffset = indexOf('second',
    // dirty) = 15, but the canonical text only has `second` at offset 11.
    const dirty = 'lead ==first== middle second trailer';
    const { canonical } = stripHighlightMarks(dirty);
    expect(canonical).toBe('lead first middle second trailer');
    // Canonical offset for `second` must be 18, NOT 22 (dirty offset).
    expect(canonical.indexOf('second')).toBe(18);
    expect(dirty.indexOf('second')).toBe(22);
  });

  it('handles multiple marks on the same line', () => {
    const dirty = 'the ==quick== brown ==fox== jumps';
    const { canonical } = stripHighlightMarks(dirty);
    expect(canonical).toBe('the quick brown fox jumps');
  });

  it('preserves multi-line highlight inner text', () => {
    const dirty = 'lead ==line one\nline two== tail';
    const { canonical } = stripHighlightMarks(dirty);
    expect(canonical).toBe('lead line one\nline two tail');
  });

  it('does not strip === heading rules (Setext) or ==- sequences', () => {
    const dirty = 'Title\n=====\n\nbody text';
    const { canonical } = stripHighlightMarks(dirty);
    expect(canonical).toBe(dirty);
  });

  it('returns an empty result for an empty input', () => {
    const { canonical, dirtyToCanonical } = stripHighlightMarks('');
    expect(canonical).toBe('');
    expect(dirtyToCanonical.length).toBe(0);
  });

  it('maps opening-delimiter positions to -1 and inner chars 1:1', () => {
    const dirty = '==hi== there';
    const { canonical, dirtyToCanonical } = stripHighlightMarks(dirty);
    expect(canonical).toBe('hi there');
    // Opening `==` at dirty 0–1 → -1.
    expect(dirtyToCanonical[0]).toBe(-1);
    expect(dirtyToCanonical[1]).toBe(-1);
    // Inner `h` at dirty 2 → canonical 0.
    expect(dirtyToCanonical[2]).toBe(0);
    // Inner `i` at dirty 3 → canonical 1.
    expect(dirtyToCanonical[3]).toBe(1);
    // Closing `==` at dirty 4–5 → -1.
    expect(dirtyToCanonical[4]).toBe(-1);
    expect(dirtyToCanonical[5]).toBe(-1);
    // `' '` at dirty 6 → canonical 2.
    expect(dirtyToCanonical[6]).toBe(2);
  });
});
