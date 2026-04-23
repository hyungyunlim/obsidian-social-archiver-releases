import { App, Modal, Notice, Platform, setIcon } from 'obsidian';
import { mount, unmount } from 'svelte';
import type SocialArchiverPlugin from '../main';
import type { ImportOrchestrator } from '../types/import';
import InstagramImport from '../ui/instagram-import/InstagramImport.svelte';

/**
 * InstagramImportModal
 *
 * Hosts the Instagram Saved Posts import flow (PRD §5.3). The job state is
 * owned by the shared ImportOrchestrator (src/services/import/*) and persists
 * across modal close — dismissing the modal does NOT cancel the running job.
 * Re-opening the modal re-attaches to whichever job is active.
 *
 * Lifecycle:
 * 1. onOpen — mounts the Svelte root; it checks `orchestrator.listActiveJobs()`
 *    and jumps straight to the progress pane if a job is already running.
 * 2. onClose — unmounts the Svelte root; the orchestrator keeps running.
 */
export class InstagramImportModal extends Modal {
  private readonly plugin: SocialArchiverPlugin;
  private readonly orchestrator: ImportOrchestrator;
  private component: ReturnType<typeof mount> | null = null;
  private maximizeButton: HTMLButtonElement | null = null;
  private isMaximized = false;

  constructor(app: App, plugin: SocialArchiverPlugin, orchestrator: ImportOrchestrator) {
    super(app);
    this.plugin = plugin;
    this.orchestrator = orchestrator;
  }

  /**
   * Toggle the modal between its default near-full-screen size and a true
   * full-viewport mode. Driven by a maximize button injected next to the
   * modal's close button. State is reflected in `data-maximized` for CSS
   * + the button icon swap (`maximize-2` ↔ `minimize-2`).
   */
  private toggleMaximize(): void {
    const { modalEl } = this;
    this.isMaximized = !this.isMaximized;
    if (this.isMaximized) {
      modalEl.addClass('sa-ig-import-modal--maximized');
      modalEl.setAttribute('data-maximized', 'true');
    } else {
      modalEl.removeClass('sa-ig-import-modal--maximized');
      modalEl.removeAttribute('data-maximized');
    }
    if (this.maximizeButton) {
      this.maximizeButton.empty();
      setIcon(this.maximizeButton, this.isMaximized ? 'minimize-2' : 'maximize-2');
      this.maximizeButton.setAttribute(
        'aria-label',
        this.isMaximized ? 'Restore window size' : 'Maximize',
      );
      this.maximizeButton.setAttribute(
        'title',
        this.isMaximized ? 'Restore window size' : 'Maximize',
      );
    }
  }

  onOpen(): void {
    // Mobile gating (PRD §11 / F6.2): if the modal is reached programmatically
    // on an unsupported platform, refuse to open and surface the same
    // explanation via Notice.
    if (Platform.isMobile) {
      new Notice('Instagram Saved import is desktop-only. Run on desktop, then sync to mobile.');
      this.close();
      return;
    }

    const { contentEl, modalEl } = this;
    contentEl.empty();

    modalEl.addClass('social-archiver-modal');
    modalEl.addClass('sa-ig-import-modal');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'sa-ig-import-title');

    contentEl.addClass('am-content--archive');
    if (Platform.isMobile) {
      modalEl.addClass('am-modal--mobile');
      contentEl.addClass('am-content--mobile');
    }

    // Expand the modal to near-full-screen — the gallery pane needs room
    // for a multi-column card grid and the preflight/progress panes also
    // benefit from extra breathing room. CSS lives in `sa-ig-import-modal`
    // class block (added to `modals.css`).

    // Inject a maximize/restore toggle button next to Obsidian's close
    // button (top-right). Lets the user expand the gallery to true
    // full-viewport when reviewing 100+ posts.
    this.maximizeButton = modalEl.createEl('button', {
      cls: 'sa-ig-import-modal__maximize',
      attr: {
        type: 'button',
        'aria-label': 'Maximize',
        title: 'Maximize',
      },
    });
    setIcon(this.maximizeButton, 'maximize-2');
    this.maximizeButton.addEventListener('click', () => this.toggleMaximize());
    this.isMaximized = false;

    this.component = mount(InstagramImport, {
      target: contentEl,
      props: {
        orchestrator: this.orchestrator,
        onRequestClose: () => this.close(),
        onOpenArchive: (archiveId: string) => {
          void this.plugin.openImportedArchive(archiveId);
        },
        onNotice: (message: string) => {
          new Notice(message);
        },
      },
    });
  }

  onClose(): void {
    if (this.component) {
      try {
        void unmount(this.component);
      } catch {
        // Ignore unmount errors — the orchestrator persists state independently.
      }
      this.component = null;
    }
    if (this.maximizeButton) {
      this.maximizeButton.remove();
      this.maximizeButton = null;
    }
    this.isMaximized = false;
    this.modalEl.removeClass('sa-ig-import-modal--maximized');
    this.modalEl.removeAttribute('data-maximized');
    this.contentEl.empty();
  }
}
