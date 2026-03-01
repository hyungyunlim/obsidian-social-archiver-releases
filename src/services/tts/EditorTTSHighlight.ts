/**
 * EditorTTSHighlight
 *
 * CodeMirror 6 extension for highlighting the currently spoken sentence
 * during Editor TTS playback.
 *
 * Uses a StateEffect to push highlight ranges into a StateField that
 * manages a single Decoration.mark. The CSS class `editor-tts-highlight`
 * is applied to the marked range.
 *
 * Access the underlying EditorView via Obsidian's `editorEditorField`
 * (a CM6 StateField that holds the EditorView reference).
 */

import {
  StateField,
  StateEffect,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view';

// ============================================================================
// StateEffect — set or clear highlight
// ============================================================================

/** Dispatch to set a highlight range (from/to) or null to clear. */
export const editorTTSHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();

// ============================================================================
// StateField — manages the DecorationSet
// ============================================================================

const editorTTSHighlightField: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    // Apply any highlight effects
    for (const effect of tr.effects) {
      if (effect.is(editorTTSHighlightEffect)) {
        if (effect.value === null) {
          return Decoration.none;
        }

        const { from, to } = effect.value;
        // Clamp to document bounds
        const docLen = tr.state.doc.length;
        const clampedFrom = Math.max(0, Math.min(from, docLen));
        const clampedTo = Math.max(clampedFrom, Math.min(to, docLen));

        if (clampedFrom === clampedTo) {
          return Decoration.none;
        }

        return Decoration.set([
          Decoration.mark({
            class: 'editor-tts-highlight',
          }).range(clampedFrom, clampedTo),
        ]);
      }
    }

    // Map decorations through document changes (e.g., edits during playback)
    if (tr.docChanged) {
      return decorations.map(tr.changes);
    }

    return decorations;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Create the CM6 extension for editor TTS highlighting.
 * Register this via `plugin.registerEditorExtension()`.
 */
export function createEditorTTSHighlightExtension(): Extension {
  return editorTTSHighlightField;
}

/**
 * Set the highlight range on a given EditorView.
 * @param view - The CM6 EditorView (access via editorEditorField)
 * @param from - Start character offset (inclusive)
 * @param to - End character offset (exclusive)
 */
export function setEditorTTSHighlight(view: EditorView, from: number, to: number): void {
  view.dispatch({
    effects: editorTTSHighlightEffect.of({ from, to }),
  });
}

/**
 * Clear the TTS highlight from the editor.
 */
export function clearEditorTTSHighlight(view: EditorView): void {
  view.dispatch({
    effects: editorTTSHighlightEffect.of(null),
  });
}

/**
 * Get the CM6 EditorView from an Obsidian Editor instance.
 *
 * Obsidian's Editor wraps CodeMirror but doesn't expose the view directly.
 * We use the `editorEditorField` StateField to retrieve it.
 *
 * @returns The EditorView, or null if not accessible.
 */
export function getEditorView(editor: unknown): EditorView | null {
  // Obsidian exposes .cm on the editor object (not typed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cm = (editor as any)?.cm;
  if (!cm) return null;

  // With @codemirror/view externalized, instanceof works.
  // Duck-type fallback: check for dispatch + state (EditorView shape).
  if (cm instanceof EditorView || (typeof cm.dispatch === 'function' && cm.state?.doc)) {
    return cm as EditorView;
  }
  return null;
}

