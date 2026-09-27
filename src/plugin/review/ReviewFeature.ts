/**
 * ReviewFeature — Today's review in Obsidian: the side panel and the ways in.
 *
 * Obsidian has no home screen, so the apps' home row becomes a status-bar
 * count, a ribbon icon and a command; `obsidian://social-archive?op=review`
 * (the digest email's landing page links it) opens the same panel. The server
 * picks and fills the set; see LearningReviewClient.
 */

import { Notice, setIcon, type App, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { ReviewPanelProps } from '../../components/review/types';
import { t } from '../../i18n';
import type SocialArchiverPlugin from '../../main';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import { LearningReviewClient, type LearningReviewClientDeps, type ReviewArchiveLabel } from '../../services/learning/LearningReviewClient';
import { ReviewSession, remainingCards, type DeckProgress, type PanelState } from '../../services/learning/ReviewSession';
import { ReviewView, VIEW_TYPE_REVIEW } from '../../views/ReviewView';
import { ReviewCardHost } from './ReviewCardHost';

/** Vault-scoped (`app.saveLocalStorage`), so two vaults keep their own cursor. */
const PROGRESS_KEY = 'social-archiver-review-progress';
/** A new day's set is picked up within this long even if the panel stays closed. */
const STATUS_REFRESH_MS = 60 * 60 * 1000;

export interface ReviewFeatureDeps {
  app: App;
  plugin: SocialArchiverPlugin;
  apiClient: LearningReviewClientDeps['apiClient'];
  isSignedIn: () => boolean;
  showStatusBar: () => boolean;
  archiveLookup: () => Pick<ArchiveLookupService, 'findBySourceArchiveId'> | undefined;
  openSettings: () => void;
}

export class ReviewFeature {
  readonly client: LearningReviewClient;
  private readonly session: ReviewSession;
  private statusBarEl: HTMLElement | null = null;
  /** A link's day, handed to the panel that `open()` is about to create. */
  private pendingDay: string | undefined;

  constructor(private readonly deps: ReviewFeatureDeps) {
    this.client = new LearningReviewClient({ apiClient: deps.apiClient });
    this.session = new ReviewSession({
      client: this.client,
      signedIn: deps.isSignedIn,
      progress: {
        read: (): unknown => deps.app.loadLocalStorage(PROGRESS_KEY) as unknown,
        write: (progress: DeckProgress): void => deps.app.saveLocalStorage(PROGRESS_KEY, progress),
      },
    });
  }

  register(): void {
    const { plugin, app } = this.deps;
    plugin.registerView(VIEW_TYPE_REVIEW, (leaf) => new ReviewView(leaf, (view) => this.panelProps(view)));
    plugin.addRibbonIcon('book-open', t('rv.open'), () => void this.open());
    plugin.addCommand({ id: 'open-todays-review', name: t('rv.open'), callback: () => void this.open() });

    this.statusBarEl = plugin.addStatusBarItem();
    this.statusBarEl.addClass('sa-review-status', 'mod-clickable');
    this.statusBarEl.hide();
    plugin.registerDomEvent(this.statusBarEl, 'click', () => void this.open());

    app.workspace.onLayoutReady(() => void this.refreshStatusBar());
    plugin.registerInterval(window.setInterval(() => void this.refreshStatusBar(), STATUS_REFRESH_MS));
  }

  /** Reveal the panel in the right sidebar; `day` comes from a link. */
  async open(day?: string): Promise<void> {
    const { workspace } = this.deps.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0] ?? null;
    const existing = leaf !== null;
    if (!leaf) {
      this.pendingDay = day;
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_REVIEW, active: true });
    }
    if (!leaf) return;
    await workspace.revealLeaf(leaf);
    // A fresh view loads on mount; an open one re-reads (a new day, a link's day).
    if (existing && leaf.view instanceof ReviewView) await leaf.view.reload(day);
  }

  /** The count, or nothing: signed out, Review off, done, or switched off here. */
  async refreshStatusBar(): Promise<void> {
    if (!this.statusBarEl) return;
    if (!this.deps.showStatusBar() || !this.deps.isSignedIn()) {
      this.statusBarEl.hide();
      return;
    }
    this.showRemaining(await this.session.load());
  }

  private showRemaining(state: PanelState): void {
    const el = this.statusBarEl;
    if (!el) return;
    const remaining = remainingCards(state);
    if (remaining === 0 || !this.deps.showStatusBar()) {
      el.hide();
      return;
    }
    el.empty();
    setIcon(el.createSpan({ cls: 'sa-review-status-icon' }), 'book-open');
    el.createSpan({ text: String(remaining) });
    el.setAttribute('aria-label', t('rv.statusBar', { count: remaining }));
    el.show();
  }

  private panelProps(view: ReviewView): ReviewPanelProps {
    const initialDay = this.pendingDay;
    this.pendingDay = undefined;
    const { app, plugin } = this.deps;
    return {
      session: this.session,
      cards: new ReviewCardHost({ app, plugin, component: view, noteFor: (archiveId) => this.noteFor(archiveId) }),
      initialDay,
      hasNote: (archiveId) => this.noteFor(archiveId) !== null,
      openArchive: (archiveId, label) => void this.openArchive(archiveId, label),
      openSettings: this.deps.openSettings,
      turnOn: async (): Promise<void> => {
        try {
          await this.client.setEnabled(true);
        } catch {
          new Notice(t('rv.settings.failed'));
        }
      },
      onchange: (state) => this.showRemaining(state),
    };
  }

  private noteFor(archiveId: string): TFile | null {
    return this.deps.archiveLookup()?.findBySourceArchiveId(archiveId) ?? null;
  }

  /** The note in this vault when there is one; the original post otherwise. */
  private async openArchive(archiveId: string, label: ReviewArchiveLabel | undefined): Promise<void> {
    const file = this.noteFor(archiveId);
    if (file) {
      await this.deps.app.workspace.getLeaf(false).openFile(file);
      return;
    }
    if (label?.originalUrl) window.open(label.originalUrl, '_blank');
  }
}
