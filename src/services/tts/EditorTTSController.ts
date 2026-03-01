/**
 * EditorTTSController
 *
 * Orchestrator bridging TTSService with the Obsidian editor context.
 *
 * Responsibilities:
 *  - Extract text from active editor (full doc minus YAML, or selection)
 *  - Wire TTSState events to status bar player and CM6 highlight extension
 *  - Auto-stop on editor-change or active-leaf-change
 *  - Manage TTSService lifecycle
 *
 * Offset mapping chain (for highlight positioning):
 *   sentence.startOffset (in cleanedText)
 *     → offsetMap[startOffset] (in rawBody, after frontmatter)
 *     → + contentStartOffset (frontmatter end offset in full doc)
 *     → editor character position
 */

import {
  MarkdownView,
  Notice,
  Platform,
  type App,
  type EventRef,
} from 'obsidian';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type SocialArchiverPlugin from '../../main';
import { TTSService } from './TTSService';
import { TTS_EVENT } from './TTSState';
import type { TTSSentenceChangeDetail, TTSStateChangeDetail, TTSNoticeDetail } from './types';
import { extractTextFromMarkdown } from './TTSTextProcessor';
import { resolveTTSProvider } from './resolveProvider';
import {
  createEditorTTSHighlightExtension,
  setEditorTTSHighlight,
  clearEditorTTSHighlight,
  getEditorView,
} from './EditorTTSHighlight';
import { TTSStatusBarPlayer, type TTSPlayerCallbacks } from '../../ui/TTSStatusBarPlayer';

// ============================================================================
// Types
// ============================================================================

type ReadingMode = 'document' | 'selection';

// ============================================================================
// EditorTTSController
// ============================================================================

export class EditorTTSController {
  private ttsService: TTSService;
  private player: TTSStatusBarPlayer;
  private editorExtension: Extension;

  // Active session state
  private activeView: MarkdownView | null = null;
  private activeEditorView: EditorView | null = null;
  private contentStartOffset = 0;
  private readingMode: ReadingMode = 'document';

  // Workspace event refs (for cleanup)
  private editorChangeRef: EventRef | null = null;
  private leafChangeRef: EventRef | null = null;

  // State event listeners
  private statusListener: ((e: Event) => void) | null = null;
  private sentenceListener: ((e: Event) => void) | null = null;
  private noticeListener: ((e: Event) => void) | null = null;

  constructor(
    private app: App,
    private plugin: SocialArchiverPlugin,
  ) {
    this.ttsService = new TTSService();
    this.editorExtension = createEditorTTSHighlightExtension();

    const callbacks: TTSPlayerCallbacks = {
      onTogglePause: () => this.togglePauseResume(),
      onNextSentence: () => { void this.ttsService.nextSentence(); },
      onPreviousSentence: () => { void this.ttsService.previousSentence(); },
      onSpeedChange: (speed) => this.onSpeedChange(speed),
      onStop: () => this.stop(),
    };

    const initialSpeed = this.plugin.settings.tts?.speed ?? 1.0;
    this.player = new TTSStatusBarPlayer(this.ttsService.state, callbacks, initialSpeed);

    // Desktop: initialize status bar item
    if (!Platform.isMobile) {
      const statusBarItem = this.plugin.addStatusBarItem();
      this.player.initStatusBar(statusBarItem);
    }
  }

  // ---------- Public API (used by commands) ---------------------------------

  /**
   * Start reading the active editor document or selection.
   */
  async startReading(mode: ReadingMode): Promise<void> {
    // Stop any existing session
    this.stopInternal();

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('No active Markdown editor');
      return;
    }

    const editor = view.editor;
    const file = view.file;

    // Resolve TTS provider
    const resolved = resolveTTSProvider(this.plugin.settings, this.plugin.manifest.version);
    if (!resolved) {
      new Notice('TTS not available. Configure a TTS provider in settings.');
      return;
    }
    this.ttsService.setProvider(resolved.primary);
    this.ttsService.setFallbackProvider(resolved.fallback);

    // Extract text
    let rawBody: string;
    let selectionStartOffset = 0;

    if (mode === 'selection') {
      rawBody = editor.getSelection();
      if (!rawBody.trim()) {
        new Notice('No text selected');
        return;
      }
      // Calculate the offset of the selection start in the full document
      const selCursor = editor.getCursor('from');
      selectionStartOffset = editor.posToOffset(selCursor);
      // Account for leading whitespace that extractTextFromMarkdown will trim
      const selTrimOffset = rawBody.length - rawBody.trimStart().length;
      this.contentStartOffset = selectionStartOffset + selTrimOffset;
    } else {
      // Full document: skip YAML frontmatter
      const fullText = editor.getValue();
      const frontmatterEnd = this.getFrontmatterEndOffset(file, fullText);
      rawBody = fullText.slice(frontmatterEnd);
      // extractTextFromMarkdown() calls rawContent.trim(), so the offset map
      // is relative to the trimmed body. Account for leading whitespace.
      const trimOffset = rawBody.length - rawBody.trimStart().length;
      this.contentStartOffset = frontmatterEnd + trimOffset;
    }

    // Check speakability before starting playback
    const extraction = extractTextFromMarkdown(rawBody);
    if (!extraction.isSpeakable) {
      new Notice('Text is too short for TTS playback');
      return;
    }

    // Store session state
    this.activeView = view;
    this.activeEditorView = getEditorView(editor);
    this.readingMode = mode;

    // Subscribe to state events for highlighting
    this.subscribeToState();

    // Register workspace event handlers for auto-stop
    this.registerAutoStop();

    // Show player
    this.player.show();

    // Start playback via TTSService
    // Feed a synthetic PostLike with the raw body as fullContent
    const speed = this.plugin.settings.tts?.speed ?? 1.0;
    await this.ttsService.startPlayback(
      { fullContent: rawBody },
      { rate: speed },
    );
  }

  /**
   * Toggle pause/resume.
   */
  togglePauseResume(): void {
    if (this.ttsService.state.isPlaying) {
      this.ttsService.pause();
    } else if (this.ttsService.state.isPaused) {
      void this.ttsService.resume();
    }
  }

  /**
   * Stop TTS playback entirely.
   */
  stop(): void {
    this.stopInternal();
  }

  /**
   * Whether TTS is currently active (playing, paused, loading, etc.).
   */
  isActive(): boolean {
    return this.ttsService.state.isActive;
  }

  /**
   * Whether TTS is currently playing audio.
   */
  isPlaying(): boolean {
    return this.ttsService.state.isPlaying;
  }

  /**
   * Whether TTS is currently paused.
   */
  isPaused(): boolean {
    return this.ttsService.state.isPaused;
  }

  /**
   * Get the CM6 editor extension to register via plugin.registerEditorExtension().
   */
  getEditorExtension(): Extension[] {
    return [this.editorExtension];
  }

  // ---------- Internal: state subscription ----------------------------------

  private subscribeToState(): void {
    this.statusListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSStateChangeDetail>).detail;
      if (detail.current === 'idle' || detail.current === 'error') {
        this.onSessionEnd();
      }
    };

    this.sentenceListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSSentenceChangeDetail>).detail;
      this.onSentenceChange(detail);
    };

    this.noticeListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSNoticeDetail>).detail;
      new Notice(detail.message);
    };

    this.ttsService.state.addEventListener(TTS_EVENT.STATUS_CHANGE, this.statusListener);
    this.ttsService.state.addEventListener(TTS_EVENT.SENTENCE_CHANGE, this.sentenceListener);
    this.ttsService.state.addEventListener(TTS_EVENT.NOTICE, this.noticeListener);
  }

  private unsubscribeFromState(): void {
    if (this.statusListener) {
      this.ttsService.state.removeEventListener(TTS_EVENT.STATUS_CHANGE, this.statusListener);
      this.statusListener = null;
    }
    if (this.sentenceListener) {
      this.ttsService.state.removeEventListener(TTS_EVENT.SENTENCE_CHANGE, this.sentenceListener);
      this.sentenceListener = null;
    }
    if (this.noticeListener) {
      this.ttsService.state.removeEventListener(TTS_EVENT.NOTICE, this.noticeListener);
      this.noticeListener = null;
    }
  }

  // ---------- Internal: highlight + scroll ----------------------------------

  private onSentenceChange(detail: TTSSentenceChangeDetail): void {
    if (!this.activeEditorView || !this.activeView) return;

    const extraction = this.ttsService.getExtractionResult();
    const sentences = this.ttsService.getSentences();
    if (!extraction || !sentences.length) return;

    const sentence = sentences[detail.index];
    if (!sentence) return;

    const offsetMap = extraction.offsetMap;

    // Calculate editor positions
    let editorFrom: number;
    let editorTo: number;

    if (offsetMap) {
      // Precise mapping: cleanedText offset → rawBody offset → editor offset
      const rawFrom = offsetMap[sentence.startOffset];
      const rawTo = offsetMap[sentence.endOffset];
      if (rawFrom === undefined || rawTo === undefined) {
        return;
      }
      editorFrom = rawFrom + this.contentStartOffset;
      editorTo = rawTo + this.contentStartOffset;
    } else {
      // Fallback: use raw offsets directly (less precise but functional)
      editorFrom = sentence.startOffset + this.contentStartOffset;
      editorTo = sentence.endOffset + this.contentStartOffset;
    }

    // Apply CM6 highlight decoration
    setEditorTTSHighlight(this.activeEditorView, editorFrom, editorTo);

    // Scroll into view using Obsidian's editor API
    const editor = this.activeView.editor;
    const fromPos = editor.offsetToPos(editorFrom);
    const toPos = editor.offsetToPos(editorTo);
    editor.scrollIntoView({ from: fromPos, to: toPos }, true);
  }

  private clearHighlight(): void {
    if (this.activeEditorView) {
      clearEditorTTSHighlight(this.activeEditorView);
    }
  }

  // ---------- Internal: auto-stop -------------------------------------------

  private registerAutoStop(): void {
    // Stop on editor content change
    this.editorChangeRef = this.app.workspace.on('editor-change', () => {
      if (this.isActive()) {
        new Notice('TTS stopped: document was edited');
        this.stopInternal();
      }
    });

    // Stop on active file/leaf change
    this.leafChangeRef = this.app.workspace.on('active-leaf-change', () => {
      if (this.isActive()) {
        this.stopInternal();
      }
    });
  }

  private unregisterAutoStop(): void {
    if (this.editorChangeRef) {
      this.app.workspace.offref(this.editorChangeRef);
      this.editorChangeRef = null;
    }
    if (this.leafChangeRef) {
      this.app.workspace.offref(this.leafChangeRef);
      this.leafChangeRef = null;
    }
  }

  // ---------- Internal: stop and cleanup ------------------------------------

  private stopInternal(): void {
    this.ttsService.stop();
    this.onSessionEnd();
  }

  private onSessionEnd(): void {
    this.clearHighlight();
    this.player.dismiss();
    this.unsubscribeFromState();
    this.unregisterAutoStop();
    this.activeView = null;
    this.activeEditorView = null;
    this.contentStartOffset = 0;
  }

  // ---------- Internal: speed -----------------------------------------------

  private onSpeedChange(speed: number): void {
    this.ttsService.setRate(speed);
    // Persist speed to settings
    void this.plugin.saveSettingsPartial(
      { tts: { ...this.plugin.settings.tts, speed } },
      { reinitialize: false, notify: false },
    );
  }

  // ---------- Internal: frontmatter -----------------------------------------

  /**
   * Get the character offset where YAML frontmatter ends (exclusive).
   * Returns 0 if no frontmatter is found.
   */
  private getFrontmatterEndOffset(file: unknown, fullText: string): number {
    // Use Obsidian's metadata cache for precise frontmatter position
    if (file && typeof file === 'object' && 'path' in file) {
      const tFile = file as { path: string };
      const cache = this.app.metadataCache.getCache(tFile.path);
      if (cache?.frontmatterPosition) {
        // frontmatterPosition.end is the position of the closing '---'
        // We need the offset after the closing '---' line
        const endPos = cache.frontmatterPosition.end;
        // endPos.line is 0-indexed. The closing '---' is on that line.
        // We want to skip past it, including the newline after it.
        const lines = fullText.split('\n');
        let offset = 0;
        for (let i = 0; i <= endPos.line && i < lines.length; i++) {
          offset += (lines[i]?.length ?? 0) + 1; // +1 for newline
        }
        return offset;
      }
    }

    // Fallback: manual frontmatter detection
    if (fullText.startsWith('---')) {
      const endIdx = fullText.indexOf('\n---', 3);
      if (endIdx !== -1) {
        // Find the newline after the closing ---
        const afterClose = fullText.indexOf('\n', endIdx + 4);
        return afterClose !== -1 ? afterClose + 1 : endIdx + 4;
      }
    }

    return 0;
  }

  // ---------- Cleanup -------------------------------------------------------

  async destroy(): Promise<void> {
    this.stopInternal();
    this.player.destroy();
    await this.ttsService.destroy();
  }
}
