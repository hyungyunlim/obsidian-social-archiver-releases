/**
 * ReaderHighlightManager - Text selection and highlight management in reader mode
 *
 * Responsibilities:
 * 1. Listen for text selection events in the reader body
 * 2. Show floating toolbar with color options near the selection
 * 3. Create TextHighlight objects from selections
 * 4. Apply visual highlights (<mark>) to existing highlights in the DOM
 * 5. Coordinate with vault file and API for persistence
 *
 * SRP: This class only handles the DOM-level selection/highlight UI.
 * Persistence (vault file ==text== and API sync) is delegated to callbacks.
 */

import { Platform, setIcon } from 'obsidian';
import type { TextHighlight, HighlightColor } from '../../../types/annotations';

// ============================================================================
// Constants
// ============================================================================

/** Subtle background for inline <mark> highlights */
const HIGHLIGHT_COLORS: { color: HighlightColor; cssVar: string; btnCssVar: string; label: string }[] = [
  { color: 'yellow', cssVar: 'rgba(250, 204, 21, 0.18)', btnCssVar: 'rgba(250, 204, 21, 0.45)', label: 'Yellow' },
  { color: 'green', cssVar: 'rgba(74, 222, 128, 0.18)', btnCssVar: 'rgba(74, 222, 128, 0.45)', label: 'Green' },
  { color: 'blue', cssVar: 'rgba(96, 165, 250, 0.18)', btnCssVar: 'rgba(96, 165, 250, 0.45)', label: 'Blue' },
  { color: 'pink', cssVar: 'rgba(244, 114, 182, 0.18)', btnCssVar: 'rgba(244, 114, 182, 0.45)', label: 'Pink' },
  { color: 'orange', cssVar: 'rgba(251, 146, 60, 0.18)', btnCssVar: 'rgba(251, 146, 60, 0.45)', label: 'Orange' },
];

/** Context chars stored before/after highlight for re-anchoring */
const CONTEXT_CHARS = 30;

// ============================================================================
// Types
// ============================================================================

export interface HighlightManagerCallbacks {
  /** Called when user creates a new highlight. Must persist to vault + API. */
  onHighlightCreate: (highlight: TextHighlight) => Promise<void>;
  /** Called when user removes an existing highlight. Must persist removal. */
  onHighlightRemove: (highlightId: string) => Promise<void>;
}

// ============================================================================
// ReaderHighlightManager
// ============================================================================

export class ReaderHighlightManager {
  private bodyEl: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;
  private highlights: TextHighlight[] = [];
  private callbacks: HighlightManagerCallbacks;
  private selectionHandler: (() => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private touchEndHandler: ((e: TouchEvent) => void) | null = null;
  private markTapHandler: ((e: Event) => void) | null = null;
  private pendingToolbarTimeout: ReturnType<typeof setTimeout> | null = null;
  private selectionDismissTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Debounce timer for selectionchange-based toolbar show on mobile */
  private selectionShowTimeout: ReturnType<typeof setTimeout> | null = null;
  /** When true, selectionchange dismiss is suppressed (mark-tap toolbar active) */
  private markTapToolbarActive = false;

  /** Plain text content of the post body (for offset computation) */
  private plainText = '';

  constructor(callbacks: HighlightManagerCallbacks) {
    this.callbacks = callbacks;
  }

  // ---------- Public API ----------

  /**
   * Attach to a reader body element and start listening for selections.
   * Call this after each render (body element is recreated per render).
   */
  attach(bodyEl: HTMLElement, plainText: string, existingHighlights: TextHighlight[]): void {
    this.detach();
    this.bodyEl = bodyEl;
    this.plainText = plainText;
    this.highlights = [...existingHighlights];

    // Apply existing highlights visually
    this.applyHighlightsToDOM();

    // Listen for mouse up / touch end to detect selections
    this.mouseUpHandler = (e: MouseEvent) => {
      // Ignore clicks on the toolbar itself
      if (this.toolbar?.contains(e.target as Node)) return;
      // Small delay to let selection finalize
      this.scheduleToolbarCheck();
    };

    this.touchEndHandler = (_e: TouchEvent) => {
      // On touch, delay a bit more for selection to settle
      this.scheduleToolbarCheck(300);
    };

    // Listen on document so drag-selections ending outside the body still trigger
    document.addEventListener('mouseup', this.mouseUpHandler);
    document.addEventListener('touchend', this.touchEndHandler);

    // Tap/click on a <mark> → show remove toolbar
    this.markTapHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      // Try tagged mark first, then any <mark> in the reader body
      let mark = target.closest('mark[data-highlight-id]') as HTMLElement | null;
      if (!mark) {
        mark = target.closest('mark') as HTMLElement | null;
      }
      if (!mark || !this.bodyEl?.contains(mark)) return;

      // If user is selecting text (drag), don't intercept
      const sel = document.getSelection();
      if (sel && sel.toString().trim().length > 0) return;

      // Find matching highlight: by ID if tagged, or by text content
      let highlight: TextHighlight | undefined;
      if (mark.dataset.highlightId) {
        highlight = this.highlights.find(h => h.id === mark!.dataset.highlightId);
      }
      if (!highlight) {
        const markText = this.normalizeText(mark.textContent || '');
        if (!markText) return;
        highlight = this.highlights.find(h => {
          const norm = this.normalizeText(h.text);
          return norm === markText || norm.includes(markText) || markText.includes(norm);
        });
      }
      if (!highlight) return;

      e.preventDefault();
      e.stopPropagation();

      // Cancel any pending selection-based toolbar check — it would hide our toolbar
      if (this.pendingToolbarTimeout) {
        clearTimeout(this.pendingToolbarTimeout);
        this.pendingToolbarTimeout = null;
      }

      this.showRemoveToolbarForMark(mark, highlight);
    };
    bodyEl.addEventListener('click', this.markTapHandler);

    // Dismiss toolbar when selection is cleared, AND show toolbar when a valid
    // selection appears on mobile. On Android, touchend may fire before the
    // selection is fully stable, so selectionchange is the reliable trigger.
    this.selectionHandler = () => {
      // Don't dismiss when mark-tap toolbar is active (no selection expected)
      if (this.markTapToolbarActive) return;

      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
        // Cancel any pending show
        if (this.selectionShowTimeout) {
          clearTimeout(this.selectionShowTimeout);
          this.selectionShowTimeout = null;
        }
        if (Platform.isMobile) {
          if (this.selectionDismissTimeout) clearTimeout(this.selectionDismissTimeout);
          this.selectionDismissTimeout = setTimeout(() => {
            // Re-check: selection may have been restored by native menu interaction
            const recheck = document.getSelection();
            if (!recheck || recheck.isCollapsed || recheck.toString().trim().length === 0) {
              this.hideToolbar();
            }
          }, 200);
        } else {
          this.hideToolbar();
        }
      } else {
        if (this.selectionDismissTimeout) {
          // Selection was restored before timeout — cancel dismiss
          clearTimeout(this.selectionDismissTimeout);
          this.selectionDismissTimeout = null;
        }
        // On mobile: also use selectionchange to show/update toolbar.
        // This catches selections that stabilize after touchend (common on Android).
        if (Platform.isMobile && !this.toolbar) {
          if (this.selectionShowTimeout) clearTimeout(this.selectionShowTimeout);
          this.selectionShowTimeout = setTimeout(() => {
            this.selectionShowTimeout = null;
            this.checkSelection();
          }, 150);
        }
      }
    };
    document.addEventListener('selectionchange', this.selectionHandler);
  }

  /**
   * Remove all event listeners and cleanup DOM elements.
   */
  detach(): void {
    if (this.pendingToolbarTimeout) {
      clearTimeout(this.pendingToolbarTimeout);
      this.pendingToolbarTimeout = null;
    }
    if (this.selectionDismissTimeout) {
      clearTimeout(this.selectionDismissTimeout);
      this.selectionDismissTimeout = null;
    }
    if (this.selectionShowTimeout) {
      clearTimeout(this.selectionShowTimeout);
      this.selectionShowTimeout = null;
    }
    if (this.mouseUpHandler) {
      document.removeEventListener('mouseup', this.mouseUpHandler);
    }
    if (this.touchEndHandler) {
      document.removeEventListener('touchend', this.touchEndHandler);
    }
    if (this.markTapHandler && this.bodyEl) {
      this.bodyEl.removeEventListener('click', this.markTapHandler);
    }
    if (this.selectionHandler) {
      document.removeEventListener('selectionchange', this.selectionHandler);
    }
    this.hideToolbar();
    this.bodyEl = null;
    this.mouseUpHandler = null;
    this.touchEndHandler = null;
    this.markTapHandler = null;
    this.selectionHandler = null;
  }

  /**
   * Get current highlights array (for external access).
   */
  getHighlights(): TextHighlight[] {
    return [...this.highlights];
  }

  // ---------- Selection Handling ----------

  private scheduleToolbarCheck(delayMs = 50): void {
    if (this.pendingToolbarTimeout) {
      clearTimeout(this.pendingToolbarTimeout);
    }
    this.pendingToolbarTimeout = setTimeout(() => {
      this.pendingToolbarTimeout = null;
      this.checkSelection();
    }, delayMs);
  }

  private checkSelection(): void {
    // Don't dismiss mark-tap toolbar via selection check
    if (this.markTapToolbarActive) return;

    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) {
      this.hideToolbar();
      return;
    }

    const text = sel.toString().trim();
    if (text.length === 0) {
      this.hideToolbar();
      return;
    }

    // Ensure selection is within the reader body
    if (!this.bodyEl || !this.isSelectionWithinBody(sel)) {
      this.hideToolbar();
      return;
    }

    // Check if this text is already highlighted
    const existingHighlight = this.findOverlappingHighlight(text);

    this.showToolbar(sel, text, existingHighlight);
  }

  private isSelectionWithinBody(sel: Selection): boolean {
    if (!this.bodyEl || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    return this.bodyEl.contains(range.commonAncestorContainer);
  }

  // ---------- Toolbar ----------

  private showToolbar(sel: Selection, text: string, existing: TextHighlight | null): void {
    this.hideToolbar();

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    this.toolbar = document.createElement('div');
    this.toolbar.addClass('sa-highlight-toolbar');

    // Mobile: use bottom-fixed bar to avoid conflict with iOS/Android native selection menus
    if (Platform.isMobile) {
      this.toolbar.addClass('sa-highlight-toolbar-mobile');
    }

    if (existing) {
      // Show remove button for existing highlight
      this.renderRemoveButton(existing);
    } else {
      // Show color picker for new highlight
      this.renderColorButtons(text, sel);
    }

    document.body.appendChild(this.toolbar);

    // Desktop: position near selection. Mobile: CSS handles fixed bottom positioning.
    if (!Platform.isMobile) {
      this.positionToolbar(rect);
    }

    // Animate in
    requestAnimationFrame(() => {
      this.toolbar?.addClass('sa-highlight-toolbar-visible');
    });
  }

  private renderColorButtons(text: string, sel: Selection): void {
    if (!this.toolbar) return;

    // Highlight icon
    const iconEl = this.toolbar.createDiv({ cls: 'sa-highlight-toolbar-icon' });
    setIcon(iconEl, 'highlighter');

    for (const { color, btnCssVar, label } of HIGHLIGHT_COLORS) {
      const btn = this.toolbar.createDiv({ cls: 'sa-highlight-color-btn' });
      btn.setAttribute('title', label);
      btn.setCssProps({ '--sa-highlight-bg': btnCssVar });
      btn.addClass('sa-highlight-color-btn-dynamic');

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Capture selection data before it may be lost
        void this.createHighlight(text, color, sel);
      });
    }
  }

  private renderRemoveButton(highlight: TextHighlight): void {
    if (!this.toolbar) return;

    const btn = this.toolbar.createDiv({ cls: 'sa-highlight-remove-btn' });
    const iconEl = btn.createDiv({ cls: 'sa-highlight-toolbar-icon' });
    setIcon(iconEl, 'eraser');
    btn.createSpan({ text: 'Remove highlight' });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.removeHighlight(highlight.id);
    });
  }

  private positionToolbar(selectionRect: DOMRect): void {
    if (!this.toolbar) return;

    const toolbarHeight = 40;
    const gap = 8;

    let top = selectionRect.top - toolbarHeight - gap + window.scrollY;
    let left = selectionRect.left + (selectionRect.width / 2);

    // If toolbar would go above viewport, show below selection
    if (top < window.scrollY + 8) {
      top = selectionRect.bottom + gap + window.scrollY;
    }

    // Clamp horizontal position
    const viewportWidth = window.innerWidth;
    const toolbarWidth = 200; // approximate
    left = Math.max(toolbarWidth / 2 + 8, Math.min(left, viewportWidth - toolbarWidth / 2 - 8));

    this.toolbar.setCssProps({
      '--sa-toolbar-top': `${top}px`,
      '--sa-toolbar-left': `${left}px`,
    });
  }

  /**
   * Show remove toolbar anchored to a specific <mark> element (tap-to-remove).
   * Used when user taps a highlighted mark without creating a text selection.
   */
  private showRemoveToolbarForMark(mark: HTMLElement, highlight: TextHighlight): void {
    this.hideToolbar();
    this.markTapToolbarActive = true;

    const rect = mark.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    this.toolbar = document.createElement('div');
    this.toolbar.addClass('sa-highlight-toolbar');
    if (Platform.isMobile) {
      this.toolbar.addClass('sa-highlight-toolbar-mobile');
    }

    this.renderRemoveButton(highlight);
    document.body.appendChild(this.toolbar);

    if (!Platform.isMobile) {
      this.positionToolbar(rect);
    }

    requestAnimationFrame(() => {
      this.toolbar?.addClass('sa-highlight-toolbar-visible');
    });

    // Auto-dismiss on next tap outside
    const dismissOnOutsideTap = (e: Event) => {
      if (this.toolbar?.contains(e.target as Node)) return;
      this.hideToolbar();
      document.removeEventListener('pointerdown', dismissOnOutsideTap, true);
    };
    // Use setTimeout to avoid the current tap from immediately dismissing
    setTimeout(() => {
      document.addEventListener('pointerdown', dismissOnOutsideTap, true);
    }, 0);
  }

  private hideToolbar(): void {
    this.markTapToolbarActive = false;
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
  }

  // ---------- Highlight CRUD ----------

  private async createHighlight(text: string, color: HighlightColor, sel: Selection): Promise<void> {
    // Compute offsets in plain text
    const startOffset = this.computePlainTextOffset(text);
    const endOffset = startOffset >= 0 ? startOffset + text.length : -1;

    // Extract context for re-anchoring
    const contextBefore = startOffset > 0
      ? this.plainText.substring(Math.max(0, startOffset - CONTEXT_CHARS), startOffset)
      : '';
    const contextAfter = endOffset > 0
      ? this.plainText.substring(endOffset, endOffset + CONTEXT_CHARS)
      : '';

    const now = new Date().toISOString();
    const highlight: TextHighlight = {
      id: this.generateId(),
      text,
      startOffset: Math.max(0, startOffset),
      endOffset: Math.max(0, endOffset),
      color,
      contextBefore,
      contextAfter,
      createdAt: now,
      updatedAt: now,
    };

    this.highlights.push(highlight);
    this.hideToolbar();

    // Clear selection
    sel.removeAllRanges();

    // Re-apply all highlights to DOM
    this.applyHighlightsToDOM();

    // Persist via callback
    try {
      await this.callbacks.onHighlightCreate(highlight);
    } catch (err) {
      console.error('[Social Archiver] Failed to save highlight:', err);
      // Rollback
      this.highlights = this.highlights.filter(h => h.id !== highlight.id);
      this.applyHighlightsToDOM();
    }
  }

  private async removeHighlight(highlightId: string): Promise<void> {
    const removed = this.highlights.find(h => h.id === highlightId);
    if (!removed) return;

    this.highlights = this.highlights.filter(h => h.id !== highlightId);
    this.hideToolbar();

    // Clear selection
    document.getSelection()?.removeAllRanges();

    // Unwrap the specific <mark> from DOM (both our class and Obsidian-rendered)
    this.unwrapMarkById(highlightId);

    // Re-apply remaining highlights to DOM
    this.applyHighlightsToDOM();

    // Persist removal
    try {
      await this.callbacks.onHighlightRemove(highlightId);
    } catch (err) {
      console.error('[Social Archiver] Failed to remove highlight:', err);
      // Rollback
      if (removed) {
        this.highlights.push(removed);
        this.applyHighlightsToDOM();
      }
    }
  }

  // ---------- DOM Highlight Rendering ----------

  /**
   * Apply all current highlights to the body DOM via <mark> wrappers.
   * Uses text-based matching with context for disambiguation.
   */
  private applyHighlightsToDOM(): void {
    if (!this.bodyEl) return;

    // First, clear all existing <mark> tags created by us (not Obsidian's)
    this.clearHighlightMarks();

    // Tag Obsidian-rendered <mark> elements (from ==text== in vault) first,
    // so we know which highlights are already visually represented
    const taggedIds = this.tagObsidianMarks();

    // Only apply DOM wrapping for highlights NOT already covered by Obsidian <mark>
    for (const highlight of this.highlights) {
      if (!taggedIds.has(highlight.id)) {
        this.applyOneHighlight(highlight);
      }
    }
  }

  /**
   * Find Obsidian-rendered <mark> elements (no sa-reader-highlight class) whose
   * text matches a known highlight, and add data-highlight-id so the tap handler works.
   * Returns the set of highlight IDs that were matched to existing DOM marks.
   */
  /** Normalize whitespace for fuzzy text matching */
  private normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private tagObsidianMarks(): Set<string> {
    const taggedIds = new Set<string>();
    if (!this.bodyEl) return taggedIds;

    const marks = this.bodyEl.querySelectorAll('mark:not(.sa-reader-highlight)');
    for (const mark of marks) {
      if ((mark as HTMLElement).dataset.highlightId) continue; // already tagged
      const markText = this.normalizeText(mark.textContent || '');
      if (!markText) continue;
      const match = this.highlights.find(h => {
        if (taggedIds.has(h.id)) return false;
        const normalizedH = this.normalizeText(h.text);
        // Exact match, or mark text is a substantial prefix/subset of the highlight
        return normalizedH === markText
          || normalizedH.includes(markText)
          || markText.includes(normalizedH);
      });
      if (match) {
        (mark as HTMLElement).dataset.highlightId = match.id;
        (mark as HTMLElement).style.cursor = 'pointer';
        taggedIds.add(match.id);
      }
    }
    return taggedIds;
  }

  private clearHighlightMarks(): void {
    if (!this.bodyEl) return;
    const marks = this.bodyEl.querySelectorAll('mark.sa-reader-highlight');
    marks.forEach(mark => {
      this.unwrapMark(mark);
    });
  }

  /** Unwrap all <mark> elements (any class) matching a specific highlight ID */
  private unwrapMarkById(highlightId: string): void {
    if (!this.bodyEl) return;
    const marks = this.bodyEl.querySelectorAll(`mark[data-highlight-id="${highlightId}"]`);
    marks.forEach(mark => {
      this.unwrapMark(mark);
    });
  }

  /** Replace a <mark> element with its children (unwrap) */
  private unwrapMark(mark: Element): void {
    const parent = mark.parentNode;
    if (parent) {
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  private applyOneHighlight(highlight: TextHighlight): void {
    if (!this.bodyEl) return;

    const textNodes = this.collectTextNodes(this.bodyEl);
    const targetText = highlight.text;

    // Find the text node range that contains the highlight text
    let found = false;
    let runningOffset = 0;

    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i]!;
      const nodeText = node.textContent || '';
      const nodeEnd = runningOffset + nodeText.length;

      // Check if this node contains the start of our highlight text
      const searchStart = Math.max(0, highlight.startOffset - runningOffset);
      const idx = nodeText.indexOf(targetText.substring(0, Math.min(targetText.length, nodeText.length - searchStart)), searchStart);

      if (idx >= 0) {
        // Try to match the full text starting from this position
        const remainingInNode = nodeText.length - idx;

        if (remainingInNode >= targetText.length) {
          // Entire highlight fits in one text node
          this.wrapTextInNode(node, idx, idx + targetText.length, highlight);
          found = true;
          break;
        }
        // Highlight spans multiple text nodes — fall back to text search
      }

      runningOffset = nodeEnd;
    }

    // Fallback: search by text content (handles cases where offsets drift)
    if (!found) {
      this.applyHighlightByTextSearch(highlight);
    }
  }

  /**
   * Fallback: search for the highlight text in the DOM and wrap the first match.
   * Uses contextBefore/contextAfter to disambiguate repeated text.
   */
  private applyHighlightByTextSearch(highlight: TextHighlight): void {
    if (!this.bodyEl) return;

    const fullText = this.bodyEl.textContent || '';
    let searchFrom = 0;
    let matchIndex = -1;

    // Try to find with context disambiguation
    while (true) {
      const idx = fullText.indexOf(highlight.text, searchFrom);
      if (idx < 0) break;

      // Check context match
      if (highlight.contextBefore) {
        const before = fullText.substring(Math.max(0, idx - CONTEXT_CHARS), idx);
        if (before.endsWith(highlight.contextBefore.slice(-10))) {
          matchIndex = idx;
          break;
        }
      }

      if (matchIndex < 0) matchIndex = idx; // Use first match as fallback
      searchFrom = idx + 1;

      // If no context, use first match
      if (!highlight.contextBefore) break;
    }

    if (matchIndex < 0) return;

    // Walk text nodes to find the exact position
    const textNodes = this.collectTextNodes(this.bodyEl);
    let offset = 0;
    let startNodeIdx = -1;
    let startOffsetInNode = -1;

    for (let i = 0; i < textNodes.length; i++) {
      const textNode = textNodes[i];
      if (!textNode) continue;
      const len = (textNode.textContent || '').length;
      if (offset + len > matchIndex && startNodeIdx < 0) {
        startNodeIdx = i;
        startOffsetInNode = matchIndex - offset;
      }
      offset += len;
      if (offset >= matchIndex + highlight.text.length) break;
    }

    if (startNodeIdx >= 0 && startOffsetInNode >= 0) {
      const node = textNodes[startNodeIdx];
      if (!node) return;
      const nodeText = node.textContent || '';
      const endInNode = startOffsetInNode + highlight.text.length;

      if (endInNode <= nodeText.length) {
        // Entire highlight within one node
        this.wrapTextInNode(node, startOffsetInNode, endInNode, highlight);
      }
      // Multi-node spanning not implemented in V1 for safety
    }
  }

  private wrapTextInNode(node: Text, start: number, end: number, highlight: TextHighlight): void {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);

    const mark = document.createElement('mark');
    mark.addClass('sa-reader-highlight');
    mark.dataset.highlightId = highlight.id;

    const defaultCssVar = 'rgba(250, 204, 21, 0.18)';
    const bgColor = HIGHLIGHT_COLORS.find(c => c.color === highlight.color)?.cssVar
      || defaultCssVar;
    mark.setCssProps({ '--sa-highlight-bg': bgColor });
    mark.addClass('sa-reader-highlight-colored');

    try {
      range.surroundContents(mark);
    } catch {
      // surroundContents fails if range crosses element boundaries
      // In that case, we skip visual highlighting
    }
  }

  // ---------- Overlap Detection ----------

  private findOverlappingHighlight(selectedText: string): TextHighlight | null {
    return this.highlights.find(h => {
      // Exact text match
      if (h.text === selectedText) return true;
      // Selected text is a substring of existing highlight or vice versa
      if (h.text.includes(selectedText) || selectedText.includes(h.text)) return true;
      return false;
    }) ?? null;
  }

  // ---------- Plain Text Offset ----------

  /**
   * Compute the start offset of `text` within the post plain text.
   * Uses a simple indexOf for now; context matching can be added later.
   */
  private computePlainTextOffset(text: string): number {
    if (!this.plainText) return -1;
    return this.plainText.indexOf(text);
  }

  // ---------- Utility ----------

  private collectTextNodes(root: HTMLElement): Text[] {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      nodes.push(node as Text);
    }
    return nodes;
  }

  private generateId(): string {
    // Compact unique ID: timestamp + random suffix
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `hl_${ts}_${rand}`;
  }
}
