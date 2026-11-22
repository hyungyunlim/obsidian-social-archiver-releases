/**
 * Instagram logged-out post page reader.
 *
 * Instagram renders a post's media node into the logged-out page on the
 * server, so the page alone is enough to archive it — and it kept answering on
 * 2026-11-19 while the anonymous media GraphQL said "Rate limit exceeded".
 *
 * Pure on purpose (strings and JSON, no Node or Workers API): the same code
 * reads a page whichever side fetched it. The scraping proxy feeds it pages it
 * fetched (routes/instagram-post-page.ts); the worker copy is for a page a
 * signed-out device fetched and sent (prd-instagram-device-capture.md).
 * Synced by scripts/sync-shared.mjs — edit here, not the copies.
 *
 * Page shapes (probed 2026-11-19, about 30 posts, home IP and one LTE modem).
 * Every one of them is HTTP 200; only the markup tells them apart:
 *   - public post     route polaris.postPage, a JSON data block holds
 *                     xig_polaris_media.if_not_gated_logged_out = the media node
 *                     (V1-like: code, pk, media_type, user, caption, counts,
 *                     image_versions2, video_versions, every carousel_media item)
 *   - age-restricted  same route, if_not_gated_logged_out null + gating_ruling
 *   - private account route polaris.privatePostPage
 *   - not found       route polaris.httpErrorPage
 *   - bot-flagged     EITHER the post route with no data block, OR the very same
 *                     polaris.httpErrorPage a missing post gets (a request with
 *                     no Sec-Fetch-* headers got it for a live NASA post)
 *
 * The node is only in the page for a desktop Chrome navigation: Chrome UA plus
 * Sec-Fetch-Dest/Mode/Site = document/navigate/none. The same UA without those
 * headers got the error page, a non-browser UA the post route with no data
 * block, and (device-capture probe) Safari and iPhone UAs Open Graph tags only.
 */

export type PostPageRead =
	| { outcome: 'ok'; media: Record<string, unknown> }
	| { outcome: 'private' | 'gated' }
	| { outcome: 'error_page' | 'unreadable' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The page's `xig_polaris_media` object, from whichever JSON data block holds
 * it. The block sits several `__bbox` levels deep under keys that move between
 * builds, so look for the key instead of walking a path.
 */
function findPolarisMedia(html: string): Record<string, unknown> | null {
	const needle = '"xig_polaris_media"';
	let at = html.indexOf(needle);
	while (at !== -1) {
		const open = html.lastIndexOf('<script', at);
		const end = html.indexOf('</script>', at);
		if (open === -1 || end === -1) return null;
		const hit: { node?: Record<string, unknown> } = {};
		try {
			JSON.parse(html.slice(html.indexOf('>', open) + 1, end), (key, value: unknown) => {
				if (key === 'xig_polaris_media' && isRecord(value)) hit.node = value;
				return value;
			});
		} catch {
			// A script that only mentions the key; keep looking.
		}
		if (hit.node) return hit.node;
		at = html.indexOf(needle, end);
	}
	return null;
}

/**
 * Classify one post page. `error_page` is not yet "not found": Instagram sends
 * that page to requests it distrusts too. Whoever fetched the page has to
 * confirm it (the proxy reads a canary post on the same egress); a caller that
 * cannot must treat it as unreadable.
 */
export function readPostPage(html: string, shortcode: string): PostPageRead {
	const polaris = findPolarisMedia(html);
	if (polaris) {
		const media = polaris.if_not_gated_logged_out;
		// A node for another post would archive the wrong thing; treat as unreadable.
		if (isRecord(media) && media.code === shortcode) {
			// The owner's 12 latest posts ride along on the user object (~15 KB).
			if (isRecord(media.user)) delete media.user.polaris_ordered_timeline_connection;
			return { outcome: 'ok', media };
		}
		if (!media && polaris.gating_ruling) return { outcome: 'gated' };
		return { outcome: 'unreadable' };
	}

	const route = /"tracePolicy":"polaris\.(\w+)"/.exec(html)?.[1];
	if (route === 'privatePostPage') return { outcome: 'private' };
	if (route === 'httpErrorPage') return { outcome: 'error_page' };
	return { outcome: 'unreadable' };
}
