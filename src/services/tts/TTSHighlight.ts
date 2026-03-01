/**
 * TTSHighlight
 *
 * Highlights the currently spoken sentence in Reader Mode DOM.
 * Uses TreeWalker + Range + <mark> elements for efficient DOM manipulation.
 *
 * Architecture:
 *  - offsetMap: maps cleanedText indices -> rawText indices
 *  - Sentence offsets are in cleanedText space
 *  - Convert to rawText space via offsetMap, then find in DOM text nodes
 *  - Wrap matched range with <mark class="reader-tts-highlight">
 *
 * Matching strategy:
 *  1. Collect text nodes, insert synthetic spaces at block-element boundaries
 *  2. Try exact `indexOf` (fast path)
 *  3. Fall back to whitespace-stripped matching (handles missing/extra spaces
 *     between paragraphs, headings, list items, etc.)
 */

import type { Sentence } from './TTSSentenceParser';

// ============================================================================
// Constants
// ============================================================================

const HIGHLIGHT_CLASS = 'reader-tts-highlight';
const HIGHLIGHT_TAG = 'MARK';

/**
 * Block-level HTML tags. A synthetic separator space is inserted between
 * adjacent text nodes whose nearest block ancestor differs.
 */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'SECTION',
  'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION',
  'DT', 'DD', 'TR',
]);

// ============================================================================
// Internal types
// ============================================================================

/** Maps a text node to its character range within the concatenated domText. */
interface DomNodeRange {
  node: Text;
  /** Inclusive start index in domText. */
  start: number;
  /** Exclusive end index in domText. */
  end: number;
}

/** Result of a text-normalisation pass (whitespace stripped). */
interface NormalisedText {
  /** The text with all whitespace characters removed. */
  stripped: string;
  /**
   * `posMap[i]` = index in the original string that produced `stripped[i]`.
   * Has a sentinel entry at `posMap[stripped.length] = originalLength`.
   */
  posMap: number[];
}

// ============================================================================
// TTSHighlight
// ============================================================================

export class TTSHighlight {
  private container: HTMLElement | null = null;
  private activeMarks: HTMLElement[] = [];

  /**
   * Set the DOM container where highlighted text lives (reader body area).
   */
  setContainer(container: HTMLElement): void {
    this.container = container;
  }

  /**
   * Highlight a sentence in the DOM.
   *
   * @param sentence - The sentence to highlight (offsets in cleanedText space).
   * @param offsetMap - Maps cleanedText indices to rawText indices (or null).
   * @param rawText - The original raw text of the post.
   */
  highlight(
    sentence: Sentence,
    offsetMap: number[] | null,
    rawText: string,
  ): void {
    this.clearHighlights();

    if (!this.container || !rawText) return;

    // Collect text nodes and build concatenated domText with block-boundary separators
    const textNodes = this.getTextNodes();
    if (textNodes.length === 0) return;

    const { domText, nodeRanges } = this.buildDomText(textNodes);
    const sentenceText = sentence.text;

    // Find sentence in domText (exact first, then fuzzy)
    const match = findSentenceRange(domText, sentenceText);
    if (!match) return;

    // Map domText positions back to specific DOM text nodes
    const startInfo = resolveNodeOffset(match.domStart, nodeRanges, 'start');
    const endInfo = resolveNodeOffset(match.domEnd, nodeRanges, 'end');

    if (!startInfo || !endInfo) return;

    try {
      if (startInfo.node === endInfo.node) {
        // Single text node — wrap directly
        const range = document.createRange();
        range.setStart(startInfo.node, startInfo.offset);
        range.setEnd(endInfo.node, endInfo.offset);

        const mark = document.createElement('mark');
        mark.className = HIGHLIGHT_CLASS;
        range.surroundContents(mark);
        this.activeMarks.push(mark);
      } else {
        // Multi-node: wrap each text node individually to avoid
        // including empty block elements (empty <p>, <br>) in the highlight.
        const nodesInRange = this.getTextNodesInRange(
          startInfo.node, startInfo.offset,
          endInfo.node, endInfo.offset,
          nodeRanges,
        );

        for (const { node, startOffset, endOffset } of nodesInRange) {
          const range = document.createRange();
          range.setStart(node, startOffset);
          range.setEnd(node, endOffset);

          const mark = document.createElement('mark');
          mark.className = HIGHLIGHT_CLASS;
          range.surroundContents(mark);
          this.activeMarks.push(mark);
        }
      }

      // Scroll the first highlight into view
      if (this.activeMarks.length > 0) {
        this.activeMarks[0]!.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (error) {
      console.debug('[TTSHighlight] Failed to create highlight:', error);
    }
  }

  /**
   * Remove all active highlights, unwrapping <mark> elements.
   */
  clearHighlights(): void {
    for (const mark of this.activeMarks) {
      try {
        const parent = mark.parentNode;
        if (!parent) continue;

        // Move all children out of the mark
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);

        // Normalize to merge adjacent text nodes
        parent.normalize();
      } catch {
        // Mark may already be removed
      }
    }
    this.activeMarks = [];
  }

  /**
   * Release resources.
   */
  destroy(): void {
    this.clearHighlights();
    this.container = null;
  }

  // ---------- Private -------------------------------------------------------

  /**
   * Collect text nodes that fall within a DOM range defined by start/end node+offset.
   * Returns per-node offset info so each text node can be individually wrapped.
   */
  private getTextNodesInRange(
    startNode: Text, startOffset: number,
    endNode: Text, endOffset: number,
    nodeRanges: DomNodeRange[],
  ): Array<{ node: Text; startOffset: number; endOffset: number }> {
    const result: Array<{ node: Text; startOffset: number; endOffset: number }> = [];
    let inRange = false;

    for (const nr of nodeRanges) {
      if (nr.node === startNode) {
        inRange = true;
        if (nr.node === endNode) {
          // Start and end in same node (shouldn't reach here, but be safe)
          result.push({ node: nr.node, startOffset, endOffset });
          break;
        }
        result.push({ node: nr.node, startOffset, endOffset: (nr.node.textContent ?? '').length });
      } else if (nr.node === endNode) {
        result.push({ node: nr.node, startOffset: 0, endOffset });
        break;
      } else if (inRange) {
        // Intermediate node — highlight entire text content
        result.push({ node: nr.node, startOffset: 0, endOffset: (nr.node.textContent ?? '').length });
      }
    }

    return result;
  }

  /**
   * Build the concatenated DOM text string with block-boundary-aware separators.
   *
   * When two consecutive text nodes belong to different block-level ancestors
   * (e.g. different `<p>` elements), a single synthetic space is inserted
   * between them so that `indexOf` works even when the DOM has no whitespace
   * between paragraphs.
   */
  private buildDomText(textNodes: Text[]): {
    domText: string;
    nodeRanges: DomNodeRange[];
  } {
    let domText = '';
    const nodeRanges: DomNodeRange[] = [];

    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i]!;
      const content = node.textContent ?? '';

      // Insert separator between text nodes from different block ancestors
      if (i > 0 && domText.length > 0) {
        const prevBlock = getBlockAncestor(textNodes[i - 1]!, this.container);
        const currBlock = getBlockAncestor(node, this.container);

        if (prevBlock !== currBlock) {
          const lastChar = domText[domText.length - 1];
          const firstChar = content[0];
          if (lastChar !== ' ' && lastChar !== '\n' && firstChar !== ' ') {
            domText += ' '; // synthetic separator — not mapped to any text node
          }
        }
      }

      const start = domText.length;
      domText += content;
      nodeRanges.push({ node, start, end: domText.length });
    }

    return { domText, nodeRanges };
  }

  /**
   * Get all text nodes within the container using TreeWalker.
   * Skips text inside <mark> elements to avoid re-highlighting.
   */
  private getTextNodes(): Text[] {
    if (!this.container) return [];

    const nodes: Text[] = [];
    const walker = document.createTreeWalker(
      this.container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip text inside our highlight marks
          const parent = node.parentElement;
          if (parent?.tagName === HIGHLIGHT_TAG && parent.classList.contains(HIGHLIGHT_CLASS)) {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip empty text nodes
          if (!node.textContent?.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }

    return nodes;
  }
}

// ============================================================================
// Pure helper functions (exported for testing)
// ============================================================================

/**
 * Walk up from a node to find its nearest block-level ancestor.
 * Returns the container itself if no block ancestor is found.
 */
export function getBlockAncestor(
  node: Node,
  container: HTMLElement | null,
): Element | null {
  let current = node.parentElement;
  while (current && current !== container) {
    if (BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return container;
}

/**
 * Find a sentence's position in the concatenated DOM text.
 *
 * Strategy:
 *  1. Exact `indexOf` (fast path — O(n) string search)
 *  2. Whitespace-stripped `indexOf` (fallback — handles missing/extra
 *     whitespace between block elements, zero-width chars, etc.)
 */
export function findSentenceRange(
  domText: string,
  sentenceText: string,
): { domStart: number; domEnd: number } | null {
  if (!domText || !sentenceText) return null;

  // Fast path: exact substring match
  const exactIdx = domText.indexOf(sentenceText);
  if (exactIdx !== -1) {
    return { domStart: exactIdx, domEnd: exactIdx + sentenceText.length };
  }

  // Fallback: strip whitespace from both strings, match, then map back
  const normDom = normaliseForMatch(domText);
  const normSentence = normaliseForMatch(sentenceText);

  if (!normSentence.stripped) return null;

  const normIdx = normDom.stripped.indexOf(normSentence.stripped);
  if (normIdx === -1) return null;

  // Map normalised positions back to original domText positions
  const domStart = normDom.posMap[normIdx];
  const normEndIdx = normIdx + normSentence.stripped.length;
  // Use the sentinel (posMap[stripped.length] = original.length) for the end
  const domEnd = normDom.posMap[normEndIdx];

  if (domStart === undefined || domEnd === undefined) return null;

  return { domStart, domEnd };
}

/**
 * Strip all whitespace and zero-width / decorative characters from text,
 * returning a position map from stripped indices to original indices.
 */
export function normaliseForMatch(text: string): NormalisedText {
  const stripped: string[] = [];
  const posMap: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = ch.charCodeAt(0);

    // Skip whitespace
    if (code <= 0x20 || code === 0xA0 /* nbsp */) continue;

    // Skip zero-width and decorative Unicode characters
    if (
      code === 0x200B || // zero-width space
      code === 0x200C || // zero-width non-joiner
      code === 0x200D || // zero-width joiner
      code === 0xFEFF || // BOM / zero-width no-break space
      code === 0x00AD || // soft hyphen
      code === 0xFE0E || // variation selector 15
      code === 0xFE0F    // variation selector 16
    ) {
      continue;
    }

    stripped.push(ch);
    posMap.push(i);
  }

  // Sentinel: maps one past the last stripped char to the original string length
  posMap.push(text.length);

  return { stripped: stripped.join(''), posMap };
}

/**
 * Convert a domText character index into a (node, offset) pair suitable for
 * `Range.setStart` / `Range.setEnd`.
 *
 * When `domIdx` falls in a synthetic separator gap between two nodeRanges:
 *  - `direction === 'start'` → snap forward to the start of the next text node
 *  - `direction === 'end'`   → snap backward to the end of the previous text node
 */
export function resolveNodeOffset(
  domIdx: number,
  nodeRanges: DomNodeRange[],
  direction: 'start' | 'end',
): { node: Text; offset: number } | null {
  for (let i = 0; i < nodeRanges.length; i++) {
    const nr = nodeRanges[i]!;

    // domIdx is within this node's character range
    if (domIdx >= nr.start && domIdx <= nr.end) {
      return { node: nr.node, offset: domIdx - nr.start };
    }

    // domIdx is in a separator gap before this node
    if (domIdx < nr.start) {
      if (direction === 'start') {
        return { node: nr.node, offset: 0 };
      }
      // direction === 'end' → snap to end of previous node
      if (i > 0) {
        const prev = nodeRanges[i - 1]!;
        return { node: prev.node, offset: prev.end - prev.start };
      }
      return { node: nr.node, offset: 0 };
    }
  }

  // Past all nodes: return end of last node
  if (nodeRanges.length > 0) {
    const last = nodeRanges[nodeRanges.length - 1]!;
    return { node: last.node, offset: last.end - last.start };
  }

  return null;
}
