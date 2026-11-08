import { t } from '../../../i18n';

/** One author bubble of My Posts: a main author or co-author name. */
export interface PostAuthorSummary {
  name: string;
  postCount: number;
}

/**
 * Unique author names (main author + `coAuthors`) across composed posts, most
 * posts first. Each post counts once per name.
 */
export function summarizePostAuthors(
  posts: Iterable<{ authorName: string; coAuthors?: readonly string[] }>,
): PostAuthorSummary[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const name of new Set([post.authorName, ...(post.coAuthors ?? [])])) {
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([name, postCount]) => ({ name, postCount }))
    .sort((a, b) => b.postCount - a.postCount || a.name.localeCompare(b.name));
}

/**
 * PostAuthorChipBar — the author row of My Posts (share-web
 * PostAuthorFilterBar, mobile PostAuthorBubbleFilter).
 *
 * Single Responsibility: render author chips and report the selection, an
 * author name or null for "All". A chip narrows My Posts to posts that author
 * wrote or co-wrote; pressing it again shows every post.
 *
 * Reuses TagChipBar's `tag-chip tcb-chip` classes like StoreChipBar: the bars
 * share one slot and should look the same.
 *
 * ponytail: names only, no avatars — the vault keeps co-authors as plain names.
 */
export class PostAuthorChipBar {
  private containerEl: HTMLElement | null = null;
  private readonly onAuthorSelect: (name: string | null) => void;
  private selectedName: string | null = null;
  private authors: PostAuthorSummary[] = [];

  constructor(onAuthorSelect: (name: string | null) => void) {
    this.onAuthorSelect = onAuthorSelect;
  }

  /** Renders nothing (returns null) with one author or fewer: every chip would show the same list. */
  render(parent: HTMLElement, authors: PostAuthorSummary[], selected: string | null): HTMLElement | null {
    this.destroy();
    this.authors = authors;
    this.selectedName = selected;

    if (authors.length <= 1) return null;

    this.containerEl = parent.createDiv({ cls: 'post-author-chip-bar tag-chip-bar tcb-container' });
    this.containerEl.setAttribute('role', 'group');
    this.containerEl.setAttribute('aria-label', t('myPosts.authors.aria'));
    this.renderChips();
    return this.containerEl;
  }

  destroy(): void {
    this.containerEl?.remove();
    this.containerEl = null;
  }

  private renderChips(): void {
    if (!this.containerEl) return;
    this.containerEl.empty();

    this.renderChip(this.containerEl, t('myPosts.authors.all'), null, this.selectedName === null, () => this.select(null));
    for (const author of this.authors) {
      const isSelected = this.selectedName === author.name;
      this.renderChip(this.containerEl, author.name, author.postCount, isSelected, () =>
        this.select(isSelected ? null : author.name));
    }
  }

  private select(name: string | null): void {
    this.selectedName = name;
    this.renderChips();
    this.onAuthorSelect(name);
  }

  private renderChip(parent: HTMLElement, label: string, count: number | null, isSelected: boolean, onClick: () => void): void {
    const chip = parent.createDiv({ cls: 'tag-chip tcb-chip' });
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-pressed', String(isSelected));
    chip.setCssProps({
      '--tcb-bg': isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)',
      '--tcb-border': 'transparent',
      '--tcb-color': isSelected ? 'var(--text-on-accent)' : 'var(--text-muted)',
      '--tcb-font-weight': isSelected ? '600' : '500',
      '--tcb-hover-bg': isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-hover)',
    });

    chip.createSpan({ text: label });
    if (count !== null && count > 0) {
      chip.createSpan({ text: String(count), cls: 'tcb-count' });
    }

    chip.addEventListener('click', onClick);
    chip.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    });
  }
}
