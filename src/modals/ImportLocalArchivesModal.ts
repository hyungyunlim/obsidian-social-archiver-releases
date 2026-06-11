/**
 * ImportLocalArchivesModal — graduation offer + progress + summary for
 * importing local-only archives into the account
 * (prd-plugin-anonymous-local-mode.md S3/S4/S6).
 *
 * Three states:
 *   idle    — count, plain-language consequences, optional quota hint
 *             (display only; the server reservation stays authoritative),
 *             "Import now" / "Not now".
 *   running — progress bar driven by LocalArchiveImportService.run()
 *             callbacks. Mirrors InstagramImportModal: closing the modal
 *             does NOT cancel the run — completion is still persisted to
 *             settings and surfaced via Notice.
 *   done    — durable summary line + stopReason copy + Close.
 */

import { Modal, Notice } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import type { LocalOnlyNoteRef } from '../services/import/local/LocalArchiveScanner';
import {
  LocalArchiveImportService,
  type LocalImportProgress,
} from '../services/import/local/LocalArchiveImportService';
import type { LocalImportLastResult } from '../types/settings';

export class ImportLocalArchivesModal extends Modal {
  private readonly plugin: SocialArchiverPlugin;
  private readonly notes: LocalOnlyNoteRef[];
  private state: 'idle' | 'running' | 'done' = 'idle';
  /** Set in onClose so a still-running import stops touching the DOM. */
  private disposed = false;
  private progressFillEl: HTMLElement | null = null;
  private progressLabelEl: HTMLElement | null = null;

  // Multi-select state (PRD Phase C): all notes selected by default.
  private readonly selectedPaths: Set<string>;
  /** Notes submitted to the current/last run (the selected subset). */
  private runNotes: LocalOnlyNoteRef[] = [];
  private importBtnEl: HTMLButtonElement | null = null;
  private selectAllEl: HTMLInputElement | null = null;
  private selectionCountEl: HTMLElement | null = null;

  constructor(plugin: SocialArchiverPlugin, notes: LocalOnlyNoteRef[]) {
    super(plugin.app);
    this.plugin = plugin;
    this.notes = notes;
    this.selectedPaths = new Set(notes.map((note) => note.file.path));
  }

  onOpen(): void {
    const { modalEl } = this;
    modalEl.addClass('social-archiver-modal', 'sa-import-local-modal');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'sa-import-local-title');
    this.renderIdle();
  }

  onClose(): void {
    this.disposed = true;
    this.progressFillEl = null;
    this.progressLabelEl = null;
    this.importBtnEl = null;
    this.selectAllEl = null;
    this.selectionCountEl = null;
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------------------
  // Idle state
  // ---------------------------------------------------------------------------

  private renderIdle(): void {
    const { contentEl } = this;
    contentEl.empty();

    const count = this.notes.length;
    contentEl.createEl('h2', {
      cls: 'sa-import-local-title',
      text: count === 1 ? 'Import 1 local archive' : `Import ${count} local archives`,
      attr: { id: 'sa-import-local-title' },
    });

    contentEl.createEl('p', {
      cls: 'sa-import-local-intro',
      text:
        count === 1
          ? 'You have 1 archive saved only in this vault. Import it to your account?'
          : `You have ${count} archives saved only in this vault. Import them to your account?`,
    });

    if (count > 1) {
      this.renderNoteList(contentEl);
    }

    const list = contentEl.createEl('ul', { cls: 'sa-import-local-consequences' });
    list.createEl('li', {
      text: 'Each imported archive counts against your monthly archive quota.',
    });
    list.createEl('li', {
      text: 'Media and avatars are uploaded to Social Archiver storage, so they survive expiring links and sync to the mobile app.',
    });
    list.createEl('li', {
      text: 'Your notes stay in this vault either way.',
    });

    this.renderQuotaHint(contentEl);

    const actions = contentEl.createDiv({ cls: 'sa-import-local-actions' });
    const importBtn = actions.createEl('button', { cls: 'mod-cta' });
    importBtn.addEventListener('click', () => this.startImport());
    this.importBtnEl = importBtn;
    const dismissBtn = actions.createEl('button', { text: 'Not now' });
    dismissBtn.addEventListener('click', () => this.close());
    this.updateSelectionUI();
    importBtn.focus();
  }

  /**
   * Selectable note list (PRD Phase C): all notes checked by default so the
   * one-click "import everything" path stays intact; unchecking lets quota-
   * constrained users pick which archives graduate first.
   */
  private renderNoteList(contentEl: HTMLElement): void {
    const listEl = contentEl.createDiv({ cls: 'sa-import-local-list' });

    const header = listEl.createEl('label', { cls: 'sa-import-local-list-header' });
    const selectAll = header.createEl('input', { type: 'checkbox' });
    selectAll.checked = true;
    selectAll.addEventListener('change', () => {
      if (selectAll.checked) {
        for (const note of this.notes) this.selectedPaths.add(note.file.path);
      } else {
        this.selectedPaths.clear();
      }
      for (const checkbox of listEl.querySelectorAll<HTMLInputElement>(
        '.sa-import-local-row input'
      )) {
        checkbox.checked = selectAll.checked;
      }
      this.updateSelectionUI();
    });
    this.selectAllEl = selectAll;
    header.createSpan({ text: 'Select all' });
    this.selectionCountEl = header.createSpan({ cls: 'sa-import-local-list-count' });

    const body = listEl.createDiv({ cls: 'sa-import-local-list-body' });
    for (const note of this.notes) {
      const row = body.createEl('label', { cls: 'sa-import-local-row' });
      const checkbox = row.createEl('input', { type: 'checkbox' });
      checkbox.checked = true;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedPaths.add(note.file.path);
        } else {
          this.selectedPaths.delete(note.file.path);
        }
        this.updateSelectionUI();
      });
      row.createSpan({
        cls: 'sa-import-local-row-label',
        text: note.file.basename,
        attr: { title: note.file.path },
      });
    }
  }

  private updateSelectionUI(): void {
    const selected = this.selectedPaths.size;
    if (this.importBtnEl) {
      this.importBtnEl.setText(
        selected === 1 ? 'Import 1 local archive' : `Import ${selected} local archives`
      );
      this.importBtnEl.disabled = selected === 0;
    }
    if (this.selectionCountEl) {
      this.selectionCountEl.setText(`${selected}/${this.notes.length}`);
    }
    if (this.selectAllEl) {
      this.selectAllEl.checked = selected === this.notes.length;
      this.selectAllEl.indeterminate = selected > 0 && selected < this.notes.length;
    }
  }

  /**
   * Remaining-quota hint from the last cached usage snapshot. Display only —
   * never blocks client-side (S6.1).
   */
  private renderQuotaHint(contentEl: HTMLElement): void {
    const quota = this.plugin.settings.billingUsage?.archiveQuota;
    if (!quota || quota.unlimited) return;
    contentEl.createEl('p', {
      cls: 'sa-import-local-quota',
      text: `${quota.remaining} of ${quota.limit} archives left in your monthly quota.`,
    });
  }

  // ---------------------------------------------------------------------------
  // Running state
  // ---------------------------------------------------------------------------

  private startImport(): void {
    if (this.state === 'running') return;
    const selected = this.notes.filter((note) => this.selectedPaths.has(note.file.path));
    if (selected.length === 0) return;

    let service: LocalArchiveImportService;
    try {
      service = LocalArchiveImportService.fromPlugin(this.plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Cannot start import: ${message}`);
      return;
    }

    this.state = 'running';
    this.runNotes = selected;
    // The run keeps going after close, so a plugin-level flag (not modal
    // state) prevents a second concurrent run double-submitting the notes.
    this.plugin.localArchiveImportRunning = true;
    this.renderRunning();

    void service
      .run(selected, (progress) => this.updateProgress(progress))
      .then((result) => this.handleResult(result))
      .catch((err: unknown) => {
        // run() encodes expected failures in stopReason; this only catches
        // unexpected throws so the modal never strands in the running state.
        console.error('[Social Archiver] Local archive import crashed:', err);
        this.handleResult({
          at: new Date().toISOString(),
          imported: 0,
          duplicates: 0,
          partialMedia: 0,
          failed: 0,
          remaining: this.runNotes.length,
          stopReason: 'error',
        });
      })
      .finally(() => {
        this.plugin.localArchiveImportRunning = false;
      });
  }

  private renderRunning(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', {
      cls: 'sa-import-local-title',
      text: 'Importing local archives…',
      attr: { id: 'sa-import-local-title' },
    });

    const track = contentEl.createDiv({ cls: 'sa-import-local-progress' });
    this.progressFillEl = track.createDiv({ cls: 'sa-import-local-progress-fill' });
    this.progressLabelEl = contentEl.createEl('p', {
      cls: 'sa-import-local-progress-label',
      text: 'Preparing…',
    });

    contentEl.createEl('p', {
      cls: 'sa-import-local-note',
      text: 'You can close this window — the import keeps running and the result is saved in settings.',
    });
  }

  private updateProgress(progress: LocalImportProgress): void {
    if (this.disposed || !this.progressFillEl || !this.progressLabelEl) return;
    const percent =
      progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
    this.progressFillEl.style.width = `${Math.min(100, percent)}%`;
    this.progressLabelEl.setText(this.progressLabelFor(progress));
  }

  private progressLabelFor(progress: LocalImportProgress): string {
    const counter = `(${progress.processed}/${progress.total})`;
    switch (progress.phase) {
      case 'preparing':
        return `Reading notes… ${counter}`;
      case 'submitting':
        return `Importing… ${counter}`;
      case 'uploading-media':
        return `Uploading media… ${counter}`;
      case 'finalizing':
        return 'Finishing up…';
    }
  }

  // ---------------------------------------------------------------------------
  // Done state
  // ---------------------------------------------------------------------------

  private handleResult(result: LocalImportLastResult): void {
    this.state = 'done';
    if (this.disposed) {
      // Modal was closed mid-run — surface the transient summary (S6.5);
      // the durable copy already lives in settings.localImportLastResult.
      new Notice(`Local archive import: ${summaryLine(result)}`, 8000);
      return;
    }
    this.renderDone(result);
  }

  private renderDone(result: LocalImportLastResult): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', {
      cls: 'sa-import-local-title',
      text: 'Import finished',
      attr: { id: 'sa-import-local-title' },
    });

    contentEl.createEl('p', {
      cls: 'sa-import-local-summary',
      text: summaryLine(result),
    });

    contentEl.createEl('p', {
      cls: 'sa-import-local-stop-reason',
      text: stopReasonCopy(result),
    });

    const actions = contentEl.createDiv({ cls: 'sa-import-local-actions' });
    const closeBtn = actions.createEl('button', { cls: 'mod-cta', text: 'Close' });
    closeBtn.addEventListener('click', () => this.close());
    closeBtn.focus();
  }
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

/** "Imported 12 · Skipped 3 duplicates · 2 partial media · …" (S4.8). */
function summaryLine(result: LocalImportLastResult): string {
  const parts = [`Imported ${result.imported}`];
  if (result.duplicates > 0) {
    parts.push(`Skipped ${result.duplicates} ${result.duplicates === 1 ? 'duplicate' : 'duplicates'}`);
  }
  if (result.partialMedia > 0) parts.push(`${result.partialMedia} partial media`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  if (result.remaining > 0) parts.push(`${result.remaining} remaining`);
  return parts.join(' · ');
}

function stopReasonCopy(result: LocalImportLastResult): string {
  switch (result.stopReason) {
    case 'quota':
      return `Monthly archive quota reached — ${result.remaining} remaining. Import resumes anytime; quota resets monthly.`;
    case 'error':
      return 'Stopped on an error — run again from settings.';
    case 'completed':
      return 'All done.';
  }
}
