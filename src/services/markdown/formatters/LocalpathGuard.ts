/**
 * Local-sentinel URL helpers (pure) — plugin mirror of the workers C1
 * (`workers/src/utils/local-sentinel.ts`) and share-web mirror
 * (`share-web/src/lib/utils/local-sentinel.ts`). MUST stay behaviorally
 * identical; the shared test vector (`LocalpathGuard.test.ts`) pins the
 * contract.
 *
 * A "local sentinel" is a media URL that does not point at a fetchable remote
 * resource — it is a placeholder for a file that lives only on the client
 * (e.g. an Instagram saved-post import where the media still has to be uploaded
 * from the browser). Two shapes are recognized:
 *
 *   1. The explicit `localpath:` prefix (canonical form).
 *   2. A bare relative `media/...` path (`media/`, `./media/`, `../media/`),
 *      which legacy import payloads use before they are normalized.
 *
 * Any absolute `http(s)://` URL is, by definition, NOT a local sentinel.
 *
 * Do NOT reimplement `isLocalSentinel` elsewhere in the plugin — import it here.
 */

const LOCALPATH_PREFIX = 'localpath:';

/** Matches bare relative media paths: "media/", "./media/", "../media/". */
const RELATIVE_MEDIA_RE = /^\.{0,2}\/?media\//;

/**
 * Returns true when `url` is a local sentinel (client-only placeholder).
 *
 * Order matters: the explicit `localpath:` prefix wins first, then absolute
 * http(s) URLs are rejected, then bare relative `media/` paths are accepted.
 */
export function isLocalSentinel(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url.startsWith(LOCALPATH_PREFIX)) return true;
  if (/^https?:\/\//i.test(url)) return false;
  return RELATIVE_MEDIA_RE.test(url);
}

/**
 * Strips the sentinel wrapper, returning the underlying relative path.
 *
 * - `localpath:media/a.jpg` -> `media/a.jpg`
 * - `./media/a.jpg`         -> `media/a.jpg`
 * - `../media/a.jpg`        -> `media/a.jpg` (only the leading `./`/`../` token)
 *
 * Note: only the single leading `./` or `../` token is removed (matching the
 * `RELATIVE_MEDIA_RE` anchor); `media/a.jpg` is returned unchanged. The
 * `localpath:` prefix is removed WITHOUT also removing a following `./` token
 * (matching the canonical workers behavior).
 */
export function stripLocalpathPrefix(url: string): string {
  if (url.startsWith(LOCALPATH_PREFIX)) return url.slice(LOCALPATH_PREFIX.length);
  return url.replace(/^\.{0,2}\//, '');
}

/**
 * Shared test vector pinning the {@link isLocalSentinel} /
 * {@link stripLocalpathPrefix} contract. `[input, strippedPath, isSentinel]`.
 *
 * Kept in lockstep with the workers C1 test vector
 * (`workers/src/__tests__/utils/local-sentinel.test.ts`).
 */
export const LOCALPATH_GUARD_VECTOR: ReadonlyArray<readonly [string, string, boolean]> = [
  ['localpath:media/a.jpg', 'media/a.jpg', true],
  ['localpath:./media/2024-01-01/02-image.jpg', './media/2024-01-01/02-image.jpg', true],
  ['localpath:anything', 'anything', true],
  ['media/a.jpg', 'media/a.jpg', true],
  ['./media/a.jpg', 'media/a.jpg', true],
  ['../media/a.jpg', 'media/a.jpg', true],
  ['attachments/a.jpg', 'attachments/a.jpg', false],
  ['media.jpg', 'media.jpg', false],
  ['https://cdn.example.com/media/a.jpg', 'https://cdn.example.com/media/a.jpg', false],
  ['HTTP://example.com/media/x', 'HTTP://example.com/media/x', false],
  ['', '', false],
];
