import { setIcon } from 'obsidian';
import { getMapProviderWebLinks } from '@/shared/platforms/map-place-links';
import type { PlaceSummary } from '@/utils/placeAggregation';
import type { PostData } from '@/types/post';

/**
 * One place's header and its archives — the surface a place row or a map marker
 * opens.
 *
 * Deliberately NOT an AuthorDetailContainer clone. That class runs to 1,769
 * lines mostly because it builds and wires its own `PostCardRenderer`, which it
 * needs in order to also live in a separate leaf. This one is only ever mounted
 * inside the timeline, so the caller hands over the renderer it already has and
 * the whole surface is a header plus a loop.
 *
 * The place's own provider card is pinned first. It is already inside
 * `place.filePaths` — `placeAggregation` collects it on purpose — but the
 * timeline sort would drop it wherever its archive date happens to fall, and a
 * place page whose third card is the place reads as a bug. Opening the note
 * instead was the other option and a worse one: the card renderer is what turns
 * that note into a rated, addressed, linked place, and `.md` is the raw
 * frontmatter behind it.
 *
 * Single Responsibility: lay out one place. It loads nothing and sorts nothing
 * beyond that pin.
 */

export interface PlaceDetailCallbacks {
  /** Return to whatever opened this — the list or the map, still as it was. */
  onBack: () => void;
  /** Draw one archive card. The timeline's own renderer, already wired. */
  renderCard: (parent: HTMLElement, post: PostData) => Promise<void>;
  /** Follow a provider link. Injected because Obsidian mobile needs its opener. */
  onOpenUrl: (url: string) => void;
}

export class PlaceDetailRenderer {
  private containerEl: HTMLElement | null = null;
  /** Bumped on every render so a slow card loop cannot paint over a newer one. */
  private generation = 0;

  constructor(private readonly callbacks: PlaceDetailCallbacks) {}

  destroy(): void {
    this.generation += 1;
    this.containerEl?.remove();
    this.containerEl = null;
  }

  render(parent: HTMLElement, place: PlaceSummary, posts: readonly PostData[]): HTMLElement {
    this.destroy();
    const generation = ++this.generation;

    this.containerEl = parent.createDiv({ cls: 'sa-place-detail' });
    this.renderHeader(this.containerEl, place);

    const feed = this.containerEl.createDiv({ cls: 'sa-place-detail-feed' });
    const ordered = orderForPlace(place, posts);
    if (ordered.length === 0) {
      feed.createDiv({
        cls: 'sa-place-list-empty',
        text: 'No archives reference this place yet.',
      });
      return this.containerEl;
    }

    void this.renderCards(feed, ordered, generation);
    return this.containerEl;
  }

  /**
   * Cards render in order and await each other, matching the timeline's own
   * feed pass. The generation check is what makes a fast back-and-forth safe:
   * without it an in-flight loop keeps appending into a detached element.
   */
  private async renderCards(
    feed: HTMLElement,
    posts: readonly PostData[],
    generation: number,
  ): Promise<void> {
    for (const post of posts) {
      if (generation !== this.generation || !feed.isConnected) return;
      try {
        await this.callbacks.renderCard(feed, post);
      } catch (error) {
        console.warn('[Social Archiver] Place detail card failed to render:', error);
      }
    }
  }

  private renderHeader(root: HTMLElement, place: PlaceSummary): void {
    const header = root.createDiv({ cls: 'sa-place-detail-header' });

    const back = header.createEl('button', { cls: 'sa-place-detail-back' });
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to places');
    setIcon(back.createDiv({ cls: 'sa-icon-16' }), 'arrow-left');
    back.createSpan({ text: 'Places' });
    back.addEventListener('click', () => this.callbacks.onBack());

    const title = header.createDiv({ cls: 'sa-place-detail-title' });
    title.createDiv({ cls: 'sa-place-detail-name', text: place.name, attr: { dir: 'auto' } });

    const subtitle = place.address ?? place.category;
    if (subtitle) {
      title.createDiv({
        cls: 'sa-place-detail-sub',
        text: subtitle,
        attr: { dir: 'auto' },
      });
    }

    const count = place.archiveCount;
    title.createDiv({
      cls: 'sa-place-detail-count',
      text: `${count} ${count === 1 ? 'archive' : 'archives'}`,
    });

    this.renderMapLinks(header, place);
  }

  private renderMapLinks(header: HTMLElement, place: PlaceSummary): void {
    const links = getMapProviderWebLinks({
      name: place.name,
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
      locationSource: place.locationSource ?? null,
      locationExternalId: place.locationExternalId ?? null,
    });
    if (links.length === 0) return;

    const row = header.createDiv({ cls: 'sa-place-detail-links' });
    for (const link of links) {
      const btn = row.createEl('button', { cls: 'sa-place-detail-link' });
      btn.type = 'button';
      btn.setAttribute('aria-label', link.label);
      setIcon(btn.createDiv({ cls: 'sa-icon-16' }), 'external-link');
      btn.createSpan({ text: link.label });
      btn.addEventListener('click', () => this.callbacks.onOpenUrl(link.url));
    }
  }
}

/**
 * The place's own archive first, everything else in the order it arrived — the
 * caller already applied the timeline's sort.
 */
export function orderForPlace(
  place: PlaceSummary,
  posts: readonly PostData[],
): PostData[] {
  const paths = new Set(place.filePaths);
  const matching = posts.filter((post) => post.filePath && paths.has(post.filePath));
  if (!place.placeArchiveId) return matching;

  const own = matching.filter((post) => isPlaceArchive(post, place.placeArchiveId));
  if (own.length === 0) return matching;
  return [...own, ...matching.filter((post) => !own.includes(post))];
}

/**
 * The provider card carries the place's archive id, but which field holds it
 * depends on how the note was written — `placeAggregation` reads the same pair
 * in the same order when it builds the key.
 */
function isPlaceArchive(post: PostData, placeArchiveId: string | undefined): boolean {
  if (!placeArchiveId) return false;
  return post.sourceArchiveId === placeArchiveId || post.id === placeArchiveId;
}
