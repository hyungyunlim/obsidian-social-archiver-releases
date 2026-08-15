/**
 * Threads SSR parser — shared between the scraping proxy and the Chrome extension.
 *
 * A Threads permalink ships the whole conversation inside `<script data-sjs>`
 * blocks (~49 of them, ~1.1MB). That payload is the ONLY complete source: the
 * rendered DOM is virtualized, so only the posts near the viewport are mounted
 * and a page holding 47 replies can show 7 nodes. Reading the SSR JSON gets the
 * full thread with no scrolling, no pagination call, and structured authors,
 * timestamps and media instead of scraped text.
 *
 * The proxy feeds this HTML it fetched; the extension feeds it the live page's
 * script contents. Same parser, same shapes.
 */

// ─── SSR post structure (raw Threads shapes) ─────────────────────────────────

export interface MediaCandidate {
	url?: string;
	width?: number;
	height?: number;
}

export interface VideoVersion {
	url?: string;
	width?: number;
	height?: number;
}

export interface CarouselItem {
	image_versions2?: {
		candidates?: MediaCandidate[];
	};
	video_versions?: VideoVersion[];
}

export interface LinkPreview {
	url?: string;
	title?: string;
	display_url?: string;
	image_url?: string;
}

export interface TextFragment {
	text?: string;
	type?: string;
}

export interface SSRPost {
	pk?: string;
	id?: string;
	code?: string;
	user?: {
		pk?: string;
		username?: string;
		full_name?: string;
		profile_pic_url?: string;
		is_verified?: boolean;
	};
	caption?: {
		text?: string;
	};
	caption_is_edited?: boolean;
	taken_at?: number;
	like_count?: number;
	media_type?: number;
	image_versions2?: {
		candidates?: MediaCandidate[];
	};
	video_versions?: VideoVersion[];
	carousel_media?: CarouselItem[];
	text_post_app_info?: {
		direct_reply_count?: number;
		repost_count?: number;
		quote_count?: number;
		reshare_count?: number;
		is_reply?: boolean;
		reply_to_author?: {
			username?: string;
		};
		reply_control?: string;
		share_info?: {
			quoted_post?: SSRPost;
			reposted_post?: SSRPost;
		};
		link_preview_attachment?: LinkPreview;
		link_preview_response?: LinkPreview;
		text_fragments?: {
			fragments?: TextFragment[];
		};
		snippet_attachment_info?: {
			text_fragments?: {
				fragments?: TextFragment[];
			};
			link_preview_attachment?: LinkPreview;
		};
	};
	thread_items?: ThreadItem[];
}

export interface ThreadItem {
	post?: SSRPost;
}

export interface EdgeNode {
	node?: {
		thread_items?: ThreadItem[];
	};
}

export interface ExtractedPosts {
	mainPost: SSRPost | null;
	selfThreadPosts: SSRPost[];
	replyThreads: SSRPost[][];
	feedPosts: SSRPost[];
	threadItemsFound: boolean;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Extract data-sjs script blocks from HTML.
 *
 * Only the proxy needs this — it holds HTML text. In a live page the blocks are
 * already elements, so the extension collects `script[data-sjs]` textContent
 * directly and passes it to {@link extractPostsFromSSR}.
 */
export function extractDataSjs(html: string): string[] {
	const regex = /<script[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g;
	const scripts: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = regex.exec(html)) !== null) {
		scripts.push(match[1]);
	}

	return scripts;
}

/**
 * Extract posts from SSR scripts
 * Returns main post, self-thread posts, and reply threads
 */
export function extractPostsFromSSR(scripts: string[], targetShortcode: string): ExtractedPosts {
	const mainPostEdges: EdgeNode[] = [];
	const relatedPosts: { thread_items?: ThreadItem[] }[] = [];
	let threadItemsFound = false;

	// Parse all scripts and find edges
	for (const text of scripts) {
		if (!text.includes('thread_items')) continue;

		try {
			const json = JSON.parse(text);
			threadItemsFound = true;
			findEdges(json, mainPostEdges, relatedPosts);
		} catch {
			// Skip non-JSON or malformed JSON
		}
	}

	// Find main post and classify threads
	let mainPost: SSRPost | null = null;
	let mainPostEdgeIdx = -1;

	// Find username from main post
	const mainUsername = (() => {
		for (const edge of mainPostEdges) {
			const items = edge.node?.thread_items ?? [];
			for (const ti of items) {
				if (ti.post?.code === targetShortcode) {
					return ti.post.user?.username;
				}
			}
		}
		return null;
	})();

	const selfThreadPosts: SSRPost[] = [];
	const replyThreads: SSRPost[][] = [];
	// The author's continuation posts are the edges that FOLLOW the main post
	// with no other account in between. Threads gives a continuation and a
	// self-reply the same shape, so position is the only signal: once someone
	// else has spoken, later author posts are replies, not article body. Same
	// rule the extension's DOM walk applies, so both surfaces agree.
	// ponytail: assumes edges arrive thread-first, replies after. If that order
	// ever breaks, a continuation lands in the comments — reach for taken_at
	// gaps or reply_to_author then.
	let continuationRun = true;

	// Process each edge
	for (const [i, edge] of mainPostEdges.entries()) {
		const items = edge.node?.thread_items ?? [];
		const posts = items
			.map((ti) => ti.post)
			.filter((p): p is SSRPost => p !== undefined && p !== null);

		// Check if this edge contains the main post
		const mainInEdge = posts.find((p) => p.code === targetShortcode);
		if (mainInEdge) {
			mainPost = mainInEdge;
			mainPostEdgeIdx = i;
			continue;
		}

		// Skip edges before main post
		if (mainPostEdgeIdx === -1) continue;

		// Split at the first post by another account: the author's leading run is
		// the continuation, whatever follows is a reply TO it. Judging the whole
		// edge (`every`) flipped an entire continuation into the comment section
		// the moment one stranger replied to it.
		const otherIdx = posts.findIndex((p) => p.user?.username !== mainUsername);
		if (continuationRun && otherIdx !== 0) {
			const cut = otherIdx === -1 ? posts.length : otherIdx;
			selfThreadPosts.push(...posts.slice(0, cut));
			if (cut < posts.length) replyThreads.push(posts.slice(cut));
		} else {
			continuationRun = false;
			replyThreads.push(posts);
		}
	}

	// Fallback: flat search if main post not found in edges
	if (!mainPost) {
		const allPosts: SSRPost[] = [];
		for (const text of scripts) {
			if (!text.includes('thread_items')) continue;
			try {
				findThreadItemsFlat(JSON.parse(text), allPosts);
			} catch {
				// Skip
			}
		}
		mainPost = allPosts.find((p) => p.code === targetShortcode) ?? null;
	}

	// Extract feed posts from related section
	const feedPosts: SSRPost[] = [];
	for (const thread of relatedPosts) {
		const items = thread.thread_items ?? [];
		for (const ti of items) {
			if (ti.post) {
				feedPosts.push(ti.post);
			}
		}
	}

	return {
		mainPost,
		selfThreadPosts,
		replyThreads,
		feedPosts,
		threadItemsFound,
	};
}

/**
 * Reply threads from reply-pagination RESPONSES, with no main-post anchoring.
 *
 * {@link extractPostsFromSSR} classifies edges by their position relative to
 * the main post, and skips everything when it cannot find that post — which is
 * right for a permalink's SSR payload but wrong for these: a reply-pagination
 * response contains replies and nothing else, so every edge is a reply thread.
 * Anchoring them threw away whole pages whenever the document's SSR payload
 * belonged to a different page (SPA navigation), reporting 9 captured pages and
 * 0 comments.
 *
 * Each returned thread is `[topReply, ...subReplies]`, matching the shape
 * `extractPostsFromSSR` produces for `replyThreads`.
 */
export function extractReplyThreadsFromPages(pages: string[]): SSRPost[][] {
	const threads: SSRPost[][] = [];
	for (const text of pages) {
		if (!text.includes('thread_items')) continue;
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			continue;
		}
		const edges: EdgeNode[] = [];
		findEdges(json, edges, []);
		for (const edge of edges) {
			const posts = (edge.node?.thread_items ?? [])
				.map((ti) => ti.post)
				.filter((p): p is SSRPost => p !== undefined && p !== null);
			if (posts.length > 0) threads.push(posts);
		}
	}
	return threads;
}

/**
 * Traverse JSON to find edges from two locations:
 * - data.data.edges[] → main thread + replies (keep)
 * - data.relatedPosts.threads[] → recommendations (filter out)
 */
function findEdges(
	obj: unknown,
	mainEdges: EdgeNode[],
	relatedPosts: { thread_items?: ThreadItem[] }[]
): void {
	if (!obj || typeof obj !== 'object') return;

	if (Array.isArray(obj)) {
		for (const item of obj) {
			findEdges(item, mainEdges, relatedPosts);
		}
		return;
	}

	const typedObj = obj as Record<string, unknown>;

	// Match: result.data.data.edges (main thread)
	if (typedObj.data && typeof typedObj.data === 'object' && !Array.isArray(typedObj.data)) {
		const data = typedObj.data as Record<string, unknown>;
		if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
			const innerData = data.data as Record<string, unknown>;
			if (Array.isArray(innerData.edges)) {
				mainEdges.push(...(innerData.edges as EdgeNode[]));
			}
		}

		// Match: result.data.relatedPosts.threads (recommendations)
		if (
			data.relatedPosts &&
			typeof data.relatedPosts === 'object' &&
			!Array.isArray(data.relatedPosts)
		) {
			const relatedPostsData = data.relatedPosts as Record<string, unknown>;
			if (Array.isArray(relatedPostsData.threads)) {
				relatedPosts.push(...(relatedPostsData.threads as { thread_items?: ThreadItem[] }[]));
			}
		}
	}

	// Recurse into nested objects
	for (const [key, value] of Object.entries(typedObj)) {
		if (key === 'data' && typedObj.data) {
			// Already handled above
			continue;
		}
		findEdges(value, mainEdges, relatedPosts);
	}
}

/**
 * Flat search fallback: find all posts in thread_items anywhere
 */
function findThreadItemsFlat(obj: unknown, posts: SSRPost[]): void {
	if (!obj || typeof obj !== 'object') return;

	if (Array.isArray(obj)) {
		for (const item of obj) {
			findThreadItemsFlat(item, posts);
		}
		return;
	}

	const typedObj = obj as Record<string, unknown>;

	if (Array.isArray(typedObj.thread_items)) {
		for (const ti of typedObj.thread_items) {
			if (ti && typeof ti === 'object' && 'post' in ti && ti.post) {
				posts.push(ti.post as SSRPost);
			}
		}
	}

	for (const value of Object.values(typedObj)) {
		findThreadItemsFlat(value, posts);
	}
}

/**
 * Validate parsed result meets quality gate requirements
 * Returns true if parsing is considered complete and valid
 */
export function validateParseResult(
	result: ExtractedPosts,
	scriptCount: number
): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	// FR-04: Quality Gate Criteria
	// 1. Main post identified
	if (!result.mainPost) {
		errors.push('Main post not found by shortcode');
	}

	// 2. Essential fields present
	if (result.mainPost) {
		if (!result.mainPost.user?.username && !result.mainPost.user?.full_name) {
			errors.push('Author information missing');
		}
		if (!result.mainPost.taken_at) {
			errors.push('Timestamp missing');
		}
	}

	// 3. Script count warning (not a hard failure)
	if (scriptCount < 40) {
		console.warn(`[SSR Parser] Warning: Low data-sjs count (${scriptCount}), expected ~49`);
	}

	// 4. Parseable thread_items blocks exist
	if (!result.threadItemsFound) {
		errors.push('No parseable thread_items blocks found');
	}

	return { valid: errors.length === 0, errors };
}
