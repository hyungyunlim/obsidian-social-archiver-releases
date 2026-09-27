import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import ReviewPanel from '../components/review/ReviewPanel.svelte';
import type { ReviewPanelExports, ReviewPanelProps } from '../components/review/types';
import { t } from '../i18n';

export const VIEW_TYPE_REVIEW = 'social-archiver-review';

/**
 * Today's review side panel. Lifecycle only — the panel renders, the session
 * decides, `ReviewFeature` wires both to the vault.
 */
export class ReviewView extends ItemView {
  private panel: ReviewPanelExports | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly panelProps: (view: ReviewView) => ReviewPanelProps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_REVIEW;
  }

  getDisplayText(): string {
    return t('rv.title');
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('sa-review-view');
    this.panel = mount(ReviewPanel, { target: this.contentEl, props: this.panelProps(this) }) as unknown as ReviewPanelExports;
  }

  async onClose(): Promise<void> {
    if (this.panel) await unmount(this.panel);
    this.panel = null;
  }

  /** Re-read today's set — or `day`'s, when a link asked for one. */
  async reload(day?: string): Promise<void> {
    await this.panel?.reload(day);
  }
}
