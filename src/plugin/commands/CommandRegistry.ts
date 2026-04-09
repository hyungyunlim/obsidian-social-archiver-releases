import { type App, Notice, Plugin } from 'obsidian';
import type { BatchMode } from '../../types/batch-transcription';
import type { BatchTranscriptionManager } from '../../services/BatchTranscriptionManager';
import type { EditorTTSController } from '../../services/tts/EditorTTSController';
import type { AuthorCatalogEntry } from '../../types/author-catalog';
import type { AuthorNoteService } from '../../services/AuthorNoteService';
import { TimelineView, VIEW_TYPE_TIMELINE } from '../../views/TimelineView';
import { AuthorDetailView, VIEW_TYPE_AUTHOR_DETAIL } from '../../views/AuthorDetailView';

/**
 * Narrow dependency interface for command registration.
 * Avoids coupling to the full plugin instance.
 */
export interface CommandRegistryDeps {
  app: App;
  plugin: Plugin;
  openArchiveModal: (initialUrl?: string) => void;
  activateTimelineView: (location?: 'sidebar' | 'main') => Promise<void>;
  activateAuthorDetailView: (author: AuthorCatalogEntry, location?: 'sidebar' | 'main') => Promise<void>;
  refreshAllTimelines: () => Promise<void>;
  batchArchiveGoogleMapsLinks: (content: string, sourceNotePath?: string) => Promise<void>;
  startBatchTranscription: (mode: BatchMode) => Promise<void>;
  getBatchTranscriptionManager: () => BatchTranscriptionManager | null;
  postCurrentNote: () => Promise<void>;
  postAndShareCurrentNote: () => Promise<void>;
  getEditorTTSController: () => EditorTTSController | undefined;
  redownloadExpiredMedia: () => Promise<void>;
  getAuthorNoteService: () => AuthorNoteService | undefined;
  getSettings: () => { enableAuthorNotes: boolean; archivePath: string };
}

/**
 * Registers all plugin commands (palette commands and editor commands).
 *
 * This covers:
 * - Archive modal
 * - Timeline view (sidebar / main / refresh)
 * - Batch Google Maps archiving
 * - Batch transcription (start / pause / resume / cancel)
 * - Post to timeline / Post and share
 * - TTS commands (read document, read selection, toggle pause, stop)
 * - Re-download expired media
 */
export function registerCommands(deps: CommandRegistryDeps): void {
  const { app, plugin } = deps;

  // ── Archive modal ────────────────────────────────────────────────────

  plugin.addCommand({
    id: 'open-archive-modal',
    name: 'Archive social media post',
    callback: () => {
      deps.openArchiveModal();
    },
  });

  // ── Re-download expired media ───────────────────────────────────────

  plugin.addCommand({
    id: 'redownload-expired-media',
    name: 'Re-download expired media',
    checkCallback: (checking: boolean) => {
      const activeFile = app.workspace.getActiveFile();
      if (activeFile) {
        if (!checking) {
          void deps.redownloadExpiredMedia();
        }
        return true;
      }
      return false;
    },
  });

  // ── Timeline view (sidebar) ──────────────────────────────────────────

  plugin.addCommand({
    id: 'open-timeline-view',
    name: 'Open timeline view (sidebar)',
    callback: () => {
      void deps.activateTimelineView('sidebar');
    },
  });

  // ── Timeline view (main area) ────────────────────────────────────────

  plugin.addCommand({
    id: 'open-timeline-view-main',
    name: 'Open timeline view (main area)',
    callback: () => {
      void deps.activateTimelineView('main');
    },
  });

  // ── Refresh timeline view ────────────────────────────────────────────

  plugin.addCommand({
    id: 'refresh-timeline-view',
    name: 'Refresh timeline view',
    callback: async () => {
      const timelineLeaves = app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
      if (timelineLeaves.length === 0) {
        new Notice('No timeline view is open');
        return;
      }
      for (const leaf of timelineLeaves) {
        const view = leaf.view;
        if (view instanceof TimelineView) {
          await view.refresh();
        }
      }
      new Notice('Timeline refreshed');
    },
  });

  // ── Author Detail View ────────────────────────────────────────────────

  plugin.addCommand({
    id: 'open-author-detail',
    name: 'Open author detail',
    checkCallback: (checking: boolean) => {
      // Only available if there's an existing Author Detail leaf with valid state
      const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_AUTHOR_DETAIL);
      const leafWithState = leaves.find((leaf) => {
        const view = leaf.view;
        if (view instanceof AuthorDetailView) {
          const state = view.getState();
          return typeof state['authorUrl'] === 'string' && state['authorUrl'] !== '';
        }
        return false;
      });

      if (!leafWithState) {
        if (!checking) {
          new Notice('No author detail view with a saved author. Open an author from the Author Catalog or Timeline first.');
        }
        return false;
      }

      if (!checking) {
        void app.workspace.revealLeaf(leafWithState);
      }
      return true;
    },
  });

  // ── Batch archive Google Maps links ──────────────────────────────────

  plugin.addCommand({
    id: 'batch-archive-googlemaps',
    name: 'Archive all Google Maps links in current note',
    editorCallback: async (editor) => {
      const activeFile = app.workspace.getActiveFile();
      const sourceNotePath = activeFile?.path;
      await deps.batchArchiveGoogleMapsLinks(editor.getValue(), sourceNotePath);
    },
  });

  // ── Batch transcription commands ─────────────────────────────────────

  plugin.addCommand({
    id: 'batch-transcribe-videos',
    name: 'Batch transcribe videos in archive notes',
    callback: async () => {
      await deps.startBatchTranscription('transcribe-only');
    },
  });

  plugin.addCommand({
    id: 'batch-download-transcribe',
    name: 'Batch download & transcribe videos in archive notes',
    callback: async () => {
      await deps.startBatchTranscription('download-and-transcribe');
    },
  });

  plugin.addCommand({
    id: 'batch-pause-transcription',
    name: 'Pause batch transcription',
    checkCallback: (checking: boolean) => {
      const manager = deps.getBatchTranscriptionManager();
      const status = manager?.getStatus();
      if (status === 'running' || status === 'scanning') {
        if (!checking) manager?.pause();
        return true;
      }
      return false;
    },
  });

  plugin.addCommand({
    id: 'batch-resume-transcription',
    name: 'Resume batch transcription',
    checkCallback: (checking: boolean) => {
      const manager = deps.getBatchTranscriptionManager();
      if (manager?.getStatus() === 'paused') {
        if (!checking) void manager?.resume();
        return true;
      }
      return false;
    },
  });

  plugin.addCommand({
    id: 'batch-cancel-transcription',
    name: 'Cancel batch transcription',
    checkCallback: (checking: boolean) => {
      const manager = deps.getBatchTranscriptionManager();
      const status = manager?.getStatus();
      if (status === 'running' || status === 'scanning' || status === 'paused') {
        if (!checking) manager?.cancel();
        return true;
      }
      return false;
    },
  });

  // ── Post to timeline ─────────────────────────────────────────────────

  plugin.addCommand({
    id: 'post-to-timeline',
    name: 'Post',
    checkCallback: (checking: boolean) => {
      const activeFile = app.workspace.getActiveFile();
      if (activeFile) {
        if (!checking) {
          void deps.postCurrentNote();
        }
        return true;
      }
      return false;
    },
  });

  // ── Post and share ───────────────────────────────────────────────────

  plugin.addCommand({
    id: 'post-and-share',
    name: 'Post and share',
    checkCallback: (checking: boolean) => {
      const activeFile = app.workspace.getActiveFile();
      if (activeFile) {
        if (!checking) {
          void deps.postAndShareCurrentNote();
        }
        return true;
      }
      return false;
    },
  });

  // ── TTS commands ─────────────────────────────────────────────────────

  const ttsController = deps.getEditorTTSController();
  if (ttsController) {
    // Read entire document aloud
    plugin.addCommand({
      id: 'tts-read-document',
      name: 'Read document aloud (TTS)', // eslint-disable-line obsidianmd/ui/sentence-case -- product feature name
      editorCheckCallback: (checking, _editor, _ctx) => {
        const controller = deps.getEditorTTSController();
        if (!controller) return false;
        // Available when there's an active editor with content
        if (checking) return true;
        void controller.startReading('document');
        return true;
      },
    });

    // Read selected text aloud
    plugin.addCommand({
      id: 'tts-read-selection',
      name: 'Read selection aloud (TTS)', // eslint-disable-line obsidianmd/ui/sentence-case -- product feature name
      editorCheckCallback: (checking, editor) => {
        const controller = deps.getEditorTTSController();
        if (!controller) return false;
        const hasSelection = !!editor.getSelection().trim();
        if (!hasSelection) return false;
        if (checking) return true;
        void controller.startReading('selection');
        return true;
      },
    });

    // Toggle pause/resume
    plugin.addCommand({
      id: 'tts-toggle-pause',
      name: 'Pause / Resume reading (TTS)', // eslint-disable-line obsidianmd/ui/sentence-case -- product feature name
      checkCallback: (checking) => {
        const controller = deps.getEditorTTSController();
        if (!controller) return false;
        const active = controller.isPlaying() || controller.isPaused();
        if (!active) return false;
        if (checking) return true;
        controller.togglePauseResume();
        return true;
      },
    });

    // Stop reading
    plugin.addCommand({
      id: 'tts-stop',
      name: 'Stop reading (TTS)', // eslint-disable-line obsidianmd/ui/sentence-case -- product feature name
      checkCallback: (checking) => {
        const controller = deps.getEditorTTSController();
        if (!controller?.isActive()) return false;
        if (checking) return true;
        controller.stop();
        return true;
      },
    });

    // ── Author Notes ──────────────────────────────────────────────────────

    plugin.addCommand({
      id: 'create-all-author-notes',
      name: 'Create author notes for existing authors',
      callback: async () => {
        const noteService = deps.getAuthorNoteService();
        const settings = deps.getSettings();
        if (!noteService || !settings.enableAuthorNotes) {
          new Notice('Author Notes feature is not enabled. Enable it in Settings → Author Notes.');
          return;
        }

        new Notice('Scanning vault for authors...');

        try {
          const { AuthorVaultScanner } = await import('../../services/AuthorVaultScanner');
          const { AuthorDeduplicator } = await import('../../services/AuthorDeduplicator');

          const scanner = new AuthorVaultScanner({
            app,
            archivePath: settings.archivePath,
            includeEmbeddedArchives: true,
          });

          const scanResult = await scanner.scanVault();
          const deduplicator = new AuthorDeduplicator();
          const dedupeResult = deduplicator.deduplicate(scanResult.authors, new Map());

          const authors = dedupeResult.authors;
          let created = 0;
          let updated = 0;
          const BATCH_SIZE = 50;

          for (let i = 0; i < authors.length; i += BATCH_SIZE) {
            const batch = authors.slice(i, i + BATCH_SIZE);
            for (const author of batch) {
              const result = await noteService.upsertFromCatalogEntry(author);
              if (result) {
                // Check if this was a new creation by seeing if archiveCount was 1
                // In practice, upsertFromCatalogEntry handles both create and update
                const data = noteService.readNote(result);
                if (data && data.archiveCount === author.archiveCount) {
                  created++;
                } else {
                  updated++;
                }
              }
            }
            // Yield to UI between batches
            if (i + BATCH_SIZE < authors.length) {
              await new Promise<void>(resolve => window.setTimeout(resolve, 0));
            }
          }

          new Notice(`Author notes: ${created} created, ${updated} updated (${authors.length} authors total)`);
        } catch (err) {
          console.error('[Social Archiver] Bulk author note generation failed:', err);
          new Notice('Failed to generate author notes. Check console for details.');
        }
      },
    });
  }
}

/**
 * Registers the editor context-menu item for TTS "Read selection aloud".
 */
export function registerEditorTTSMenu(
  deps: Pick<CommandRegistryDeps, 'plugin' | 'getEditorTTSController'>,
): void {
  const { plugin } = deps;

  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu, editor) => {
      const controller = deps.getEditorTTSController();
      if (!controller) return;
      const selection = editor.getSelection().trim();
      if (!selection) return;
      menu.addItem((item) => {
        item
          .setTitle('Read selection aloud')
          .setIcon('audio-lines')
          .onClick(() => {
            void controller.startReading('selection');
          });
      });
    }),
  );
}
