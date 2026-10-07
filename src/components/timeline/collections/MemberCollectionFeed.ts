import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { OnlineResult } from '../../../services/collections/CollectionService';
import type { MemberCollectionItem, MemberCollectionPostItem, MemberCollectionViewPage, RemoteCollectionPost } from '../../../types/collections';

/**
 * A collaborative collection's posts, every contributor's, from the server's
 * member view (prd-collections-obsidian-plugin O5). Other members' posts are
 * not notes in this vault, so they render as read-only cards; my own link to
 * their note. Owners and editors can take any post out.
 */

export interface MemberCollectionFeedDeps {
  loadPage: (cursor: string | null) => Promise<OnlineResult<MemberCollectionViewPage>>;
  /** My note for an archive, when it is in this vault. */
  resolveFilePath: (archiveId: string) => string | null;
  openFile: (path: string) => void;
  openUrl: (url: string) => void;
  canRemove: boolean;
  remove: (archiveId: string) => Promise<boolean>;
}

const PREVIEW_LENGTH = 400;

export class MemberCollectionFeed {
  private listEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private nextCursor: string | null = null;
  private loading = false;
  private generation = 0;

  constructor(private readonly deps: MemberCollectionFeedDeps) {}

  mount(parent: HTMLElement): void {
    const root = parent.createDiv({ cls: 'sa-member-feed max-w-2xl mx-auto timeline-feed' });
    this.listEl = root.createDiv({ cls: 'sa-member-feed-list' });
    this.footerEl = root.createDiv({ cls: 'sa-member-feed-footer' });
    void this.reload();
  }

  async reload(): Promise<void> {
    if (!this.listEl) return;
    this.generation++;
    this.nextCursor = null;
    this.listEl.empty();
    await this.loadMore();
  }

  destroy(): void {
    this.generation++;
    this.listEl = null;
    this.footerEl = null;
  }

  private async loadMore(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const generation = this.generation;
    this.renderFooter('loading');
    const result = await this.deps.loadPage(this.nextCursor);
    this.loading = false;
    if (generation !== this.generation || !this.listEl) return;
    if (!result.ok) {
      this.renderFooter(result.reason === 'offline' ? 'offline' : 'failed');
      return;
    }
    for (const item of result.value.items) this.renderItem(this.listEl, item);
    this.nextCursor = result.value.nextCursor;
    if (this.listEl.childElementCount === 0) this.listEl.createDiv({ cls: 'sa-collection-empty', text: t('col.emptyCollection') });
    this.renderFooter(this.nextCursor ? 'more' : 'done');
  }

  private renderFooter(state: 'loading' | 'more' | 'done' | 'offline' | 'failed'): void {
    const footer = this.footerEl;
    if (!footer) return;
    footer.empty();
    if (state === 'loading') footer.createDiv({ cls: 'sa-collection-loading', text: '…' });
    else if (state === 'more') {
      const button = footer.createEl('button', { text: t('col.feed.loadMore') });
      button.addEventListener('click', () => void this.loadMore());
    } else if (state === 'offline' || state === 'failed') {
      footer.createDiv({ cls: 'sa-collection-hint', text: state === 'offline' ? t('col.feed.offline') : t('col.feed.loadFailed') });
      const retry = footer.createEl('button', { text: t('col.feed.loadMore') });
      retry.addEventListener('click', () => void this.loadMore());
    }
  }

  private renderItem(list: HTMLElement, item: MemberCollectionItem): void {
    const card = list.createDiv({ cls: 'sa-member-card' });
    if (item.kind === 'hidden') {
      card.addClass('is-hidden');
      const line = card.createDiv({ cls: 'sa-member-card-hidden' });
      const icon = line.createSpan();
      setIcon(icon, 'eye-off');
      line.createSpan({ text: t('col.feed.hidden') });
      this.renderFooterRow(card, item.archiveId, item.addedBy);
      return;
    }
    this.renderPost(card, item);
  }

  private renderPost(card: HTMLElement, item: MemberCollectionPostItem): void {
    const post: RemoteCollectionPost = item.post ?? {};
    const header = card.createDiv({ cls: 'sa-member-card-header' });
    if (post.author?.avatar) {
      header.createEl('img', { cls: 'sa-member-card-avatar', attr: { src: post.author.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
    }
    const who = header.createDiv({ cls: 'sa-member-card-who' });
    who.createDiv({ cls: 'sa-member-card-author', text: post.author?.name || post.author?.handle || post.author?.username || post.platform || '' });
    // When it was added, not archived: the feed is ordered by addition.
    const added = formatDate(item.addedAt);
    const meta = [post.platform, formatDate(post.postedAt ?? post.publishedDate), added && t('col.feed.addedAt', { date: added })]
      .filter(Boolean).join(' · ');
    if (meta) who.createDiv({ cls: 'sa-member-card-meta', text: meta });

    if (post.title) card.createDiv({ cls: 'sa-member-card-title', text: post.title });
    const text = post.previewText || post.content?.text || '';
    if (text) card.createDiv({ cls: 'sa-member-card-text', text: text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text });

    const image = firstImage(post);
    if (image) card.createEl('img', { cls: 'sa-member-card-media', attr: { src: image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });

    this.renderSharedNotes(card, item);
    this.renderFooterRow(card, item.archiveId, item.addedBy, post.canonicalUrl || post.url);
  }

  /** Members' shared notes, read-only here: they are written in the mobile and desktop apps. */
  private renderSharedNotes(card: HTMLElement, item: MemberCollectionPostItem): void {
    const notes = (item.sharedAnnotations ?? []).filter((annotation) => annotation.kind === 'note' && annotation.content);
    if (notes.length === 0) return;
    const block = card.createDiv({ cls: 'sa-member-card-notes' });
    block.createDiv({ cls: 'sa-member-card-notes-title', text: t('col.feed.sharedNotes') });
    for (const note of notes) {
      const row = block.createDiv({ cls: 'sa-member-card-note' });
      row.createDiv({ cls: 'sa-member-card-note-meta', text: [`@${note.authorUsername}`, formatDate(note.createdAt)].filter(Boolean).join(' · ') });
      row.createDiv({ cls: 'sa-member-card-text', text: note.content });
    }
  }

  private renderFooterRow(card: HTMLElement, archiveId: string, addedBy?: string, url?: string | null): void {
    const footer = card.createDiv({ cls: 'sa-member-card-footer' });
    if (addedBy) footer.createSpan({ cls: 'sa-member-card-added-by', text: t('col.feed.addedBy', { username: addedBy }) });
    footer.createDiv({ cls: 'pcr-spacer' });

    const notePath = this.deps.resolveFilePath(archiveId);
    if (notePath) {
      const open = footer.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('col.feed.openNote'), title: t('col.feed.openNote') } });
      setIcon(open, 'file-text');
      open.addEventListener('click', () => this.deps.openFile(notePath));
    }
    if (url) {
      const original = footer.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('col.feed.openOriginal'), title: t('col.feed.openOriginal') } });
      setIcon(original, 'external-link');
      original.addEventListener('click', () => this.deps.openUrl(url));
    }
    if (this.deps.canRemove) {
      const remove = footer.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('col.action.remove'), title: t('col.action.remove') } });
      setIcon(remove, 'folder-minus');
      remove.addEventListener('click', () => {
        void this.deps.remove(archiveId).then((removed) => {
          if (removed) card.remove();
        });
      });
    }
  }
}

function firstImage(post: RemoteCollectionPost): string | null {
  for (const media of post.media ?? []) {
    const isVideo = typeof media.type === 'string' && media.type.startsWith('video');
    const candidate = media.r2ThumbnailUrl || media.thumbnail || (isVideo ? undefined : media.r2Url || media.cdnUrl || media.url);
    if (candidate) return candidate;
  }
  return post.thumbnail ?? null;
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}
