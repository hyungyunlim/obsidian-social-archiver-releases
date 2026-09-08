import { z } from 'zod';

const PIN_PATH_REGEX = /^\/pin\/[A-Za-z0-9_-]+(?:\/.*)?$/i;
// api.pinterest.com/url_shortener/{code}/redirect — the hop pin.it 308s to,
// and what the Pinterest app's share sheet emits directly.
const SHORTENER_PATH_REGEX = /^\/url_shortener\/[A-Za-z0-9_-]+\/redirect$/i;

/** pinterest.com and its country subdomains; api.pinterest.com only ever redirects. */
function isPinterestContentHost(hostname: string): boolean {
	return (hostname === 'pinterest.com' || hostname.endsWith('.pinterest.com')) && hostname !== 'api.pinterest.com';
}

const DISALLOWED_BOARD_ROOTS = new Set(['ideas', 'explore', 'topics', 'login', 'settings', 'pin']);

function hasValidBoardPath(pathname: string): boolean {
	const segments = pathname.split('/').filter(Boolean);
	if (segments.length < 2) return false;

	const [firstSegment] = segments;
	if (!firstSegment) return false;
	if (DISALLOWED_BOARD_ROOTS.has(firstSegment.toLowerCase())) return false;
	if (firstSegment.toLowerCase() === 'pin') return false;

	return true;
}

export function isPinterestBoardUrl(url: string): boolean {
	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname.toLowerCase();
		const pathname = urlObj.pathname;
		if (!isPinterestContentHost(hostname)) return false;
		if (PIN_PATH_REGEX.test(pathname)) return false;
		return hasValidBoardPath(pathname);
	} catch {
		return false;
	}
}

/**
 * Pinterest pin ID validation
 * Pins are typically numeric but some shortlinks may use alphanumeric codes
 */
export const PinterestPinIdSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]{6,30}$/, { message: 'Invalid Pinterest pin ID format' })
	.describe('Pinterest pin ID');

/**
 * Pinterest pin/board URL validation
 * Supports standard pin URLs, pin.it / api.pinterest.com short links, and board URLs
 */
export const PinterestURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.refine(
		(url) => {
			try {
				const urlObj = new URL(url);
				const hostname = urlObj.hostname.toLowerCase();
				const pathname = urlObj.pathname.replace(/\/+$/, '');

				if (hostname === 'api.pinterest.com') {
					return SHORTENER_PATH_REGEX.test(pathname);
				}

				if (hostname === 'pin.it') {
					// pin.it short links: /abc123
					return /^\/[A-Za-z0-9_-]+$/i.test(pathname);
				}

				if (!isPinterestContentHost(hostname)) {
					return false;
				}

				if (PIN_PATH_REGEX.test(pathname)) {
					return true;
				}
				return hasValidBoardPath(pathname);
			} catch {
				return false;
			}
		},
		{ message: 'Invalid Pinterest post URL format' }
	)
	.describe('Pinterest pin or board URL');

/**
 * Type inference helpers
 */
export type PinterestURL = z.infer<typeof PinterestURLSchema>;
export type PinterestPinId = z.infer<typeof PinterestPinIdSchema>;
