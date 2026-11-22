/**
 * Threads logged-out profile feed: parsing only.
 *
 * Since 2026-10-27 Meta has revoked our Threads API access, so subscriptions
 * read the same public profile page any logged-out visitor sees. Measured
 * 2026-11-15 (.taskmaster/docs/prd-threads-session-fallback.md §4):
 *
 * - `GET threads.com/@handle` embeds the first 4 threads in a `data-sjs` block
 *   at `…data.mediaData.edges[].node.thread_items[].post`, plus the page's own
 *   preloader declaration (queryID + variables, numeric `userID` inside).
 * - `POST /api/graphql` with that queryID and the same variables (with a larger
 *   `first`) answers logged-out with the same `data.mediaData` shape.
 *
 * Reading the queryID from the page means a Meta doc_id rotation needs no fix
 * here. Synced to threads-ssr-proxy/src/services/ by scripts/sync-shared.mjs.
 */

import { extractDataSjs, type SSRPost } from './ssr-parser.js';

export interface ProfileFeedPreloader {
	queryId: string;
	userId: string;
	/** The preloader's variables verbatim: ~60 Relay provider flags the query requires. */
	variables: Record<string, unknown>;
}

export interface ProfileFeedPage {
	/** One entry per thread: the root post first, then the author's continuations. */
	threads: SSRPost[][];
	hasNextPage: boolean;
	endCursor: string | null;
}

const PRELOADER_PATTERN =
	/"adp_BarcelonaProfileThreadsTabDirectQueryRelayPreloader_[^"]*","queryID":"(\d+)","variables":(\{[^{}]*\})/;

export function extractProfilePreloader(html: string): ProfileFeedPreloader | null {
	const match = html.match(PRELOADER_PATTERN);
	if (!match) return null;
	let variables: Record<string, unknown>;
	try {
		variables = JSON.parse(match[2]) as Record<string, unknown>;
	} catch {
		return null;
	}
	const userId = variables.userID;
	if (typeof userId !== 'string' || !/^\d+$/.test(userId)) return null;
	return { queryId: match[1], userId, variables };
}

/**
 * A private profile ships its own user object with
 * `"pk":"<userId>","text_post_app_is_private":true` and no posts. Keyed to the
 * profile's id because other users' objects on the page carry the same flag.
 */
export function isPrivateProfile(html: string, userId: string): boolean {
	const pk = `"pk":"${userId}"`;
	const flag = '"text_post_app_is_private":true';
	return new RegExp(`${pk}[^{}]{0,400}${flag}|${flag}[^{}]{0,400}${pk}`).test(html);
}

/** `/login` is where Threads sends a missing handle, and also a walled IP. */
export function isLoginRedirect(finalUrl: string): boolean {
	try {
		return /^\/login\b/.test(new URL(finalUrl).pathname);
	} catch {
		return false;
	}
}

/** The first `mediaData` connection anywhere in a parsed SSR block or GraphQL body. */
export function profileFeedFromJson(value: unknown): ProfileFeedPage | null {
	const connection = findMediaData(value, 0);
	if (!connection) return null;
	const threads = connection.edges
		.map((edge) =>
			(edge?.node?.thread_items ?? [])
				.map((item) => item?.post)
				.filter((post): post is SSRPost => Boolean(post && (post.pk || post.code)))
		)
		.filter((thread) => thread.length > 0);
	return {
		threads,
		hasNextPage: connection.page_info?.has_next_page === true,
		endCursor: connection.page_info?.end_cursor ?? null,
	};
}

/** The 4 threads the profile page embeds; `null` when the page carries none. */
export function profileFeedFromHtml(html: string): ProfileFeedPage | null {
	for (const block of extractDataSjs(html)) {
		if (!block.includes('"mediaData"')) continue;
		try {
			const page = profileFeedFromJson(JSON.parse(block));
			if (page) return page;
		} catch {
			// not JSON; keep looking
		}
	}
	return null;
}

/** `/api/graphql` answers `text/javascript`, sometimes behind `for (;;);`. */
export function parseGraphqlBody(text: string): unknown {
	const body = text.replace(/^for \(;;\);/, '');
	try {
		return JSON.parse(body);
	} catch {
		// Relay can stream extra lines after the first payload.
		return JSON.parse(body.split('\n')[0]);
	}
}

interface MediaDataConnection {
	edges: ({ node?: { thread_items?: ({ post?: SSRPost } | null)[] } } | null)[];
	page_info?: { has_next_page?: boolean; end_cursor?: string | null };
}

function findMediaData(value: unknown, depth: number): MediaDataConnection | null {
	if (!value || typeof value !== 'object' || depth > 40) return null;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findMediaData(item, depth + 1);
			if (found) return found;
		}
		return null;
	}
	const record = value as Record<string, unknown>;
	const media = record.mediaData as MediaDataConnection | undefined;
	if (media && Array.isArray(media.edges)) return media;
	for (const child of Object.values(record)) {
		const found = findMediaData(child, depth + 1);
		if (found) return found;
	}
	return null;
}
