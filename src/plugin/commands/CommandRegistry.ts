import { type App, Notice, Plugin } from 'obsidian';
import type { BatchMode } from '../../types/batch-transcription';
import type { BatchTranscriptionManager } from '../../services/BatchTranscriptionManager';
import type { EditorTTSController } from '../../services/tts/EditorTTSController';
import { TimelineView, VIEW_TYPE_TIMELINE } from '../../views/TimelineView';

/**
 * Narrow dependency interface for command registration.
 * Avoids coupling to the full plugin instance.
 */
export interface CommandRegistryDeps {
  app: App;
  plugin: Plugin;
  openArchiveModal: (initialUrl?: string) => void;
  activateTimelineView: (location?: 'sidebar' | 'main') => Promise<void>;
  refreshAllTimelines: () => Promise<void>;
  batchArchiveGoogleMapsLinks: (content: string, sourceNotePath?: string) => Promise<void>;
  startBatchTranscription: (mode: BatchMode) => Promise<void>;
  getBatchTranscriptionManager: () => BatchTranscriptionManager | null;
  postCurrentNote: () => Promise<void>;
  postAndShareCurrentNote: () => Promise<void>;
  getEditorTTSController: () => EditorTTSController | undefined;
  redownloadExpiredMedia: () => Promise<void>;
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
