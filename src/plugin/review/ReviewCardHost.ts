/**
 * ReviewCardHost — the review's cards are the timeline's cards.
 *
 * A unit whose archive has a note in this vault is parsed exactly as the
 * timeline parses it (PostDataParser), drawn by the timeline's own card
 * renderer (PreviewableCardRenderer: header, caption, hero image, counts), and
 * read in the timeline's reader (ReaderModeOverlay), which steps through the
 * rest of today's posts. Nothing here decides what to review; that is
 * ReviewSession's job.
 */

import { Platform, TFile, type App, type Component } from 'obsidian';
import type SocialArchiverPlugin from '../../main';
import { PostDataParser } from '../../components/timeline/parsers/PostDataParser';
import { ReaderModeOverlay } from '../../components/timeline/reader/ReaderModeOverlay';
import { LinkPreviewRenderer } from '../../components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '../../components/timeline/renderers/MediaGalleryRenderer';
import { PreviewableCardRenderer } from '../../components/timeline/renderers/PreviewableCardRenderer';
import type { PostData } from '../../types/post';
import { maybeProxyCdnUrl } from '../../utils/cdnProxy';

const DEFAULT_WORKER_URL = 'https://social-archiver-api.social-archive.org';

export interface ReviewCardHostDeps {
  app: App;
  plugin: SocialArchiverPlugin;
  /** The view hosting the cards — owns the MarkdownRenderer children. */
  component: Component;
  noteFor: (archiveId: string) => TFile | null;
}

export class ReviewCardHost {
  private readonly parser: PostDataParser;
  private readonly cards: PreviewableCardRenderer;
  private readonly posts = new Map<string, Promise<PostData | null>>();
  /** Note path → archive id, so a changed note drops its parse. */
  private readonly archiveAt = new Map<string, string>();
  private mediaGallery: MediaGalleryRenderer | null = null;
  private linkPreview: LinkPreviewRenderer | null = null;

  constructor(private readonly deps: ReviewCardHostDeps) {
    this.parser = new PostDataParser(deps.app.vault, deps.app);
    this.cards = new PreviewableCardRenderer({
      resolveMediaUrl: (raw): string | undefined => this.resolveMediaUrl(raw),
      app: deps.app,
      component: deps.component,
    });
    // An AI comment, a reader highlight or an edit lands in the note: re-read it next time.
    const forget = (path: string): void => {
      const archiveId = this.archiveAt.get(path);
      if (archiveId) this.posts.delete(archiveId);
    };
    const { vault } = deps.app;
    deps.component.registerEvent(vault.on('modify', (file) => forget(file.path)));
    deps.component.registerEvent(vault.on('delete', (file) => forget(file.path)));
    deps.component.registerEvent(vault.on('rename', (_file, oldPath) => forget(oldPath)));
  }

  /** The archive's note as the timeline sees it; `null` when it is not in this vault. */
  postFor(archiveId: string): Promise<PostData | null> {
    let pending = this.posts.get(archiveId);
    if (!pending) {
      const file = this.deps.noteFor(archiveId);
      if (file) this.archiveAt.set(file.path, archiveId);
      pending = file ? this.parser.parseFile(file).catch(() => null) : Promise.resolve(null);
      this.posts.set(archiveId, pending);
    }
    return pending;
  }

  async renderCard(container: HTMLElement, post: PostData): Promise<void> {
    container.empty();
    const card = await this.cards.render(container, post);
    // The gallery's square "Text-only post" frame keeps a grid even; one card needs no frame.
    card.querySelector('.pcr-preview-media--text')?.remove();
  }

  /** The timeline's reader over today's posts, opened on `archiveId`. */
  async openReader(archiveIds: readonly string[], archiveId: string): Promise<void> {
    const posts: PostData[] = [];
    let currentIndex = -1;
    for (const id of new Set(archiveIds)) {
      const post = await this.postFor(id);
      if (!post) continue;
      if (id === archiveId) currentIndex = posts.length;
      posts.push(post);
    }
    if (currentIndex < 0) return;

    const { app, plugin } = this.deps;
    this.mediaGallery ??= new MediaGalleryRenderer((path: string) => this.resolveVaultPath(path));
    this.linkPreview ??= new LinkPreviewRenderer(this.workerUrl());
    const overlay = new ReaderModeOverlay({
      posts,
      currentIndex,
      app,
      plugin,
      mediaGalleryRenderer: this.mediaGallery,
      linkPreviewRenderer: this.linkPreview,
      onEdit: (post): void => {
        const file = post.filePath ? app.vault.getAbstractFileByPath(post.filePath) : null;
        if (file instanceof TFile) void app.workspace.getLeaf('tab').openFile(file);
      },
    });
    await overlay.open();
  }

  /** Same policy as the timeline card (PostCardRenderer.resolvePreviewMediaUrl). */
  private resolveMediaUrl(raw: string | undefined | null): string | undefined {
    if (!raw) return undefined;
    if (/^(?:https?:|data:|blob:)/i.test(raw)) return maybeProxyCdnUrl(raw);
    try {
      return this.deps.app.vault.adapter.getResourcePath(raw.replace(/^\.\//, ''));
    } catch {
      return undefined;
    }
  }

  /** Same resolver the timeline and author pages hand the media gallery. */
  private resolveVaultPath(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    let resolved = path;
    if (!path.includes('/')) {
      const file = this.deps.app.metadataCache.getFirstLinkpathDest(path, '');
      if (file) resolved = file.path;
    }
    return this.deps.app.vault.adapter.getResourcePath(resolved);
  }

  private workerUrl(): string {
    const configured = this.deps.plugin.settings.workerUrl || DEFAULT_WORKER_URL;
    return Platform.isMobile && configured.includes('localhost') ? DEFAULT_WORKER_URL : configured;
  }
}
