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
export const RenderProfile = {
    /** Threads, X (non-article), FB posts, IG captions, LinkedIn posts, Reddit, YouTube desc, etc. */
    SocialPlain: 'social-plain',
    /** X article, Naver blog, Brunch, newsletters, podcast show notes, long-form articles. */
    StructuredMd: 'structured-md',
    /** Share-web article view (reserved for future web-article ingest). */
    WebArticle: 'web-article',
    /** Mobile timeline blocks (chronological short blocks). */
    TimelineMd: 'timeline-md',
};
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
export const RENDER_PROFILE_CONFIG = Object.freeze({
    [RenderProfile.SocialPlain]: Object.freeze({
        typographer: false,
        breaks: true,
        gfm: false,
        includeTitlePrefix: false,
        mediaPlaceholderToken: '\uFFFC',
    }),
    [RenderProfile.StructuredMd]: Object.freeze({
        typographer: true,
        breaks: false,
        gfm: true,
        // Archived article bodies already include the title as their first block
        // (see X/Medium/Substack ingest pipelines). Prepending the title again
        // would double it in fullText and break every cross-client offset. Kept
        // false so body-only is the single source of truth across profiles.
        includeTitlePrefix: false,
        mediaPlaceholderToken: '\uFFFC',
    }),
    [RenderProfile.WebArticle]: Object.freeze({
        typographer: true,
        breaks: false,
        gfm: true,
        // See StructuredMd note — article bodies carry their own title.
        includeTitlePrefix: false,
        mediaPlaceholderToken: '\uFFFC',
    }),
    [RenderProfile.TimelineMd]: Object.freeze({
        typographer: false,
        breaks: true,
        gfm: false,
        includeTitlePrefix: false,
        mediaPlaceholderToken: '\uFFFC',
    }),
});
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
export function getRenderProfileForArchive(archive) {
    if (archive.contentType === 'timeline')
        return RenderProfile.TimelineMd;
    if (archive.isWebArticle === true)
        return RenderProfile.WebArticle;
    if (archive.isArticle === true || archive.isXArticle === true || archive.contentType === 'article') {
        return RenderProfile.StructuredMd;
    }
    return RenderProfile.SocialPlain;
}
//# sourceMappingURL=render-profile.js.map