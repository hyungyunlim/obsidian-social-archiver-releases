/** One store row for the Shopping chip bar. */
export interface StoreSummary {
  /** Normalized host, e.g. "gymshark.com" or "brand.naver.com/lgcaremall". */
  source: string;
  archiveCount: number;
  /** Epoch ms of the most recent archive from this store; drives chip order. */
  lastArchivedAt: number;
}

/**
 * StoreChipBar — horizontal store filter for Shopping mode.
 *
 * Single Responsibility: render store chips and report the selection. The
 * selected value is a normalized store host, or null for "All stores".
 *
 * Deliberately reuses TagChipBar's `tag-chip tcb-chip` / `tcb-count` classes
 * rather than styling a second chip: the two bars occupy the same slot and
 * should be visually identical.
 *
 * ponytail: no favicons, unlike the mobile and desktop chip bars. Those fetch
 * `google.com/s2/favicons?domain=…`, which would announce every store the user
 * shops at to a third party to decorate a chip that already carries the host
 * name. Add them if stores ever get numerous enough that names stop scanning.
 */
export class StoreChipBar {
  private containerEl: HTMLElement | null = null;
  private readonly onStoreSelect: (source: string | null) => void;
  private selectedStore: string | null = null;
  private stores: StoreSummary[] = [];

  constructor(onStoreSelect: (source: string | null) => void) {
    this.onStoreSelect = onStoreSelect;
  }

  /**
   * Render the bar into `parent`.
   *
   * Returns null — rendering nothing — when there is at most one store, matching
   * mobile and desktop: a lone "All stores / gymshark.com" pair is a control
   * whose every state shows the same list.
   */
  render(parent: HTMLElement, stores: StoreSummary[], selected: string | null): HTMLElement | null {
    this.destroy();
    this.stores = stores;
    this.selectedStore = selected;

    if (stores.length <= 1) return null;

    this.containerEl = parent.createDiv({ cls: 'store-chip-bar tag-chip-bar tcb-container' });
    this.renderChips();
    return this.containerEl;
  }

  /** Current selection, so callers can reconcile after the store list changes. */
  getSelectedStore(): string | null {
    return this.selectedStore;
  }

  destroy(): void {
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }

  private renderChips(): void {
    if (!this.containerEl) return;
    this.containerEl.empty();

    this.renderChip(this.containerEl, {
      label: 'All stores',
      count: null,
      isSelected: this.selectedStore === null,
      onClick: () => this.select(null),
    });

    // Most-recently-used first, the order mobile and desktop get from
    // `ORDER BY last_archived_at DESC`.
    const sorted = [...this.stores].sort((a, b) => b.lastArchivedAt - a.lastArchivedAt);
    for (const store of sorted) {
      this.renderChip(this.containerEl, {
        label: store.source,
        count: store.archiveCount,
        isSelected: this.selectedStore === store.source,
        onClick: () => this.select(this.selectedStore === store.source ? null : store.source),
      });
    }
  }

  private select(source: string | null): void {
    this.selectedStore = source;
    this.renderChips();
    this.onStoreSelect(source);
  }

  private renderChip(
    parent: HTMLElement,
    options: { label: string; count: number | null; isSelected: boolean; onClick: () => void },
  ): void {
    const chip = parent.createDiv({ cls: 'tag-chip tcb-chip' });
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-pressed', String(options.isSelected));

    chip.setCssProps({
      '--tcb-bg': options.isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)',
      '--tcb-border': 'transparent',
      '--tcb-color': options.isSelected ? 'var(--text-on-accent)' : 'var(--text-muted)',
      '--tcb-font-weight': options.isSelected ? '600' : '500',
      '--tcb-hover-bg': options.isSelected
        ? 'var(--interactive-accent)'
        : 'var(--background-modifier-hover)',
    });

    chip.createSpan({ text: options.label });
    if (options.count !== null && options.count > 0) {
      chip.createSpan({ text: String(options.count), cls: 'tcb-count' });
    }

    chip.addEventListener('click', options.onClick);
    chip.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        options.onClick();
      }
    });
  }
}
