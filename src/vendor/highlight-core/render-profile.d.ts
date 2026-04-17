/**
 * render-profile.ts — Render profile enum + archive → profile mapping
 *
 * Canonical implementation of PRD §3.4, §4.8, and Appendix B. A render
 * profile captures *exactly* which renderer knobs the client must use so that
 * fullText coordinates are reproducible across share-web, mobile, desktop,
 * and the Obsidian plugin.
 *
 * Reference: .taskmaster/docs/prd-highlight-sync-unification.md §3.4, §4.8
 *
 * This module has **no runtime dependencies** beyond the TypeScript stdlib.
 * In particular it does not import from ./types — the canonical `RenderProfile`
 * value type is defined here and `types.ts` re-exports it via `import type`
 * to avoid a dependency cycle.
 */
/**
 * Render profile string enum (PRD §3.4).
 *
 * Using a plain `const` object + literal union instead of TypeScript's `enum`
 * keyword so that:
 *   - `isolatedModules` + `const enum` pitfalls are avoided,
 *   - tree-shakers can eliminate unused branches,
 *   - the runtime surface is exactly the PRD-specified string values.
 */
export declare const RenderProfile: {
    /** Threads, X (non-article), FB posts, IG captions, LinkedIn posts, Reddit, YouTube desc, etc. */
    readonly SocialPlain: "social-plain";
    /** X article, Naver blog, Brunch, newsletters, podcast show notes, long-form articles. */
    readonly StructuredMd: "structured-md";
    /** Share-web article view (reserved for future web-article ingest). */
    readonly WebArticle: "web-article";
    /** Mobile timeline blocks (chronological short blocks). */
    readonly TimelineMd: "timeline-md";
};
/**
 * Literal union of render profile values. Use this type in all public APIs;
 * prefer referring to the `RenderProfile` const object at call sites.
 */
export type RenderProfile = (typeof RenderProfile)[keyof typeof RenderProfile];
/**
 * Renderer configuration parameters for a given profile.
 *
 * Any client-side markdown renderer must honor these knobs so that the
 * `fullText` it feeds into highlight coordinates is byte-for-byte identical
 * across the 4 client surfaces.
 */
export interface ProfileConfig {
    /** Smart quotes / dashes / ellipsis substitutions (marked `smartypants`). */
    typographer: boolean;
    /** Convert `\n` to `<br>` in paragraphs (marked `breaks`). */
    breaks: boolean;
    /** GitHub-flavored markdown extensions (tables, strike, task lists). */
    gfm: boolean;
    /** Prepend archive title as fullText prefix for long-form content. */
    includeTitlePrefix: boolean;
    /**
     * Character used as the visible-side placeholder for images / media. The
     * canonical value is U+FFFC (OBJECT REPLACEMENT CHARACTER) which is what
     * browsers already use for inline atomic embeds.
     */
    mediaPlaceholderToken: string;
}
/**
 * Profile → renderer knob table (PRD §4.8, Appendix B).
 *
 * Frozen so consumers can safely share references without defensive copies.
 *
 * GFM coverage
 * ------------
 * The reference renderer ({@link referenceRenderToVisible} in
 * `markdown-visible-text.ts`) provides a **minimal GFM subset** —
 * strikethrough `~~x~~`, task-list `- [ ]`, and pipe tables — when a profile
 * declares `gfm: true`.  To keep the contract honest:
 *
 *   - `SocialPlain` / `TimelineMd` now declare `gfm: false`.  These profiles
 *     target short-form social content (Threads, X posts, Instagram captions,
 *     timeline blocks) where tables / strike / checkboxes are unusual and
 *     the previous mis-declared `gfm: true` leaked pipe characters straight
 *     into the visible text.  Flipping to `false` is safe: posts without GFM
 *     constructs render identically, and posts that contain a stray `|` no
 *     longer trigger table detection.
 *   - `StructuredMd` / `WebArticle` keep `gfm: true` because long-form
 *     articles, newsletters, and podcast show notes routinely use these
 *     features.
 *
 * If/when the tokenizer gains fuller GFM coverage (e.g. auto-link, emoji) the
 * flag interpretation can expand without needing a PRD amendment — the flag
 * already means "profile opts into GFM extras, best effort".
 */
export declare const RENDER_PROFILE_CONFIG: Record<RenderProfile, ProfileConfig>;
/**
 * Minimal archive shape consumed by {@link getRenderProfileForArchive}. Kept
 * structural so each client (which has its own Archive type) can pass through
 * without re-exporting the full interface.
 */
export interface RenderProfileArchiveInput {
    /** Platform slug (threads, x, facebook, ...). */
    platform?: string;
    /** Explicit content-type hint when the platform is ambiguous. */
    contentType?: 'post' | 'article' | 'timeline' | 'note';
    /** Long-form article flag (X article, Naver blog, Brunch, etc). */
    isArticle?: boolean;
    /** Explicit X-article flag retained for parity with mobile's isXArticleArchive(). */
    isXArticle?: boolean;
    /** Explicit web-article flag (share-web article view). */
    isWebArticle?: boolean;
}
/**
 * Determine the canonical render profile for a given archive (PRD §4.8).
 *
 * Decision rules (verbatim from PRD §4.8 with additive compatibility for
 * existing mobile flags):
 *  1. `contentType === 'timeline'`                                        → TimelineMd
 *  2. `isWebArticle === true`                                              → WebArticle
 *  3. `isArticle` | `isXArticle` | `contentType === 'article'`            → StructuredMd
 *  4. otherwise                                                            → SocialPlain
 *
 * Rule 2 is an additive extension of the PRD pseudo-code to match the mobile
 * app's existing `isStructuredMd` decision (`isXArticleArchive() || isArticle
 * || isWebArticle()`). `WebArticle` and `StructuredMd` share the same renderer
 * knobs (Appendix B) so this only affects the profile label recorded in
 * `TextHighlight.createdProfile`, never the coordinate mapping.
 */
export declare function getRenderProfileForArchive(archive: RenderProfileArchiveInput): RenderProfile;
//# sourceMappingURL=render-profile.d.ts.map