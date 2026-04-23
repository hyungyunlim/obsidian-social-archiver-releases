/**
 * Canonical PreviewContext shape — single source of truth for the preview /
 * gallery sub-renderer family.
 *
 * Round 3 of the PostCardRenderer extraction (PRD §0 — engineering
 * commitments) dedupes the four locally-declared `PreviewContext` interfaces
 * that lived inside the sibling sub-renderers (`PreviewableHeaderRenderer`,
 * `PreviewableContentRenderer`, `PreviewableMediaRenderer`,
 * `PreviewableInteractionsRenderer`). Each had identical shape; they are now
 * re-exported from this file so the wiring is owned in exactly one place.
 *
 * Add new optional fields HERE — never re-declare the interface inside a
 * sub-renderer. The orchestrator (`PreviewableCardRenderer`) and
 * `PostCardRenderer` (vault timeline) both build a single context value and
 * hand it to every sub-renderer; declaring the field locally would silently
 * drop it from one of the consumers.
 *
 * --- Capability contract ----------------------------------------------------
 *
 *  - `resolveMediaUrl` is REQUIRED. It is the boundary between the renderer's
 *    pure visual concern ("here's a raw URL string from PostData") and the
 *    host's policy ("vault adapter? blob: from a ZIP? CDN proxy?"). The
 *    renderer NEVER guesses — callers always supply this.
 *
 *  - All other fields are OPTIONAL with documented graceful-degradation paths.
 *    When omitted, the corresponding visual feature simply does not render
 *    (no error, no warning, no broken DOM). This is what makes the renderer
 *    safe to mount inside an unresolved Svelte component without an `App`
 *    handle (see `ImportGalleryContainer.svelte`).
 */

import type { App, Component } from 'obsidian';
import type { PostData } from '@/types/post';

/**
 * Capabilities the host environment may provide to enrich the rendered card.
 *
 * Single canonical declaration — sub-renderers and `PreviewableCardRenderer`
 * import this type directly. Round 3 dedupe of Round 2's per-file copies.
 */
export interface PreviewContext {
  /**
   * REQUIRED — resolves a raw media-like URL string from `PostData` (which may
   * be vault-relative, ZIP-relative, network, blob:, or data:) to a URL that
   * an `<img src>` / `<video src>` attribute can render.
   *
   * Returning `undefined` is a valid signal that the caller has no resolved
   * URL yet — the renderer falls back to a placeholder / initials, never a
   * broken `<img>`.
   *
   * Vault timeline uses `app.vault.adapter.getResourcePath` for local files.
   * Import gallery uses `MediaPreviewService` `blob:` URLs.
   */
  resolveMediaUrl: (raw: string | undefined | null) => string | undefined;

  /**
   * Optional Obsidian `App`. When BOTH `app` and `component` are present,
   * captions render via `MarkdownRenderer` (full Obsidian markdown — wikilinks,
   * embeds, callouts). When either is missing, captions render as plain text
   * with `\n` -> `<br>` line breaks preserved.
   *
   * Pre-import previews intentionally pass `undefined` because there is no
   * vault file context (the post hasn't been written to disk yet — wikilinks
   * would resolve to nothing).
   */
  app?: App;

  /**
   * Optional Obsidian `Component` for the `MarkdownRenderer` lifecycle. Must
   * be supplied alongside `app` (the renderer requires both). When omitted,
   * caption falls back to plain text.
   */
  component?: Component;

  /**
   * Optional. When present, the header shows the subscription badge frame.
   * The frame carries a stable `data-action="subscribe-badge"` attribute so
   * the host (e.g. `PostCardRenderer`) can attach the actual click handler
   * post-hoc.
   *
   * Vault-timeline-only capability. Import-gallery callers omit this.
   */
  isSubscribed?: (post: PostData) => boolean;

  /**
   * Optional. When present, the header renders an author-note tooltip
   * affordance with the snippet text. The tooltip body itself is plain text
   * in this layer; the host can replace it with a Markdown preview after the
   * fact via the `data-author-tooltip` attribute.
   */
  getAuthorNoteSnippet?: (post: PostData) => string | null;

  /**
   * Optional click handler for the author area (e.g. open author detail
   * view). When omitted, the author area is non-interactive.
   */
  onAuthorClick?: (post: PostData) => void;

  /**
   * Optional. When present, the content sub-renderer attaches click handlers
   * to hashtag anchors that fire this callback with the cleaned hashtag
   * (no leading `#`). When omitted, hashtags render as normal links.
   */
  onHashtagClick?: (hashtag: string) => void;

  /**
   * Optional reader-mode / detail callback. The vault timeline wires this to
   * its long-press / reader-mode overlay. Preview consumers omit it — PRD §5.3
   * specifies the gallery card body is non-interactive (selection happens
   * via the overlay checkbox layer, NOT by clicking the card body).
   */
  onCardClick?: (post: PostData) => void;

  /**
   * Optional preview character cap for the caption. Defaults to 280 in the
   * orchestrator and 300 in the content sub-renderer (legacy parity with
   * the original `PostCardRenderer.renderContent` truncation). Pass `0` for
   * unbounded (no truncation).
   */
  captionMaxChars?: number;
}
