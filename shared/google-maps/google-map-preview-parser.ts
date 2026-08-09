import { z } from 'zod';

/**
 * Anonymous Google Maps preview parsing, shared verbatim between the two
 * fetch tiers (synced by scripts/sync-shared.mjs — edit here, not the copies):
 *
 * - Cloudflare Workers (`workers/src/shared/google-maps/`) — the edge-direct
 *   tier fetches the Maps shell + `/maps/preview/place` payload itself
 *   (~0.8s, measured) before falling back to the residential proxy.
 * - threads-ssr-proxy (`threads-ssr-proxy/src/services/`) — the residential
 *   fallback tier, for when Google stops serving datacenter egress.
 *
 * The payload is positional (record[78] = place id, [11] = name, [72] = lead
 * photo…) and Google shifts these indices at will. One source means one fix
 * per shift — two server deploys, zero client releases. Keep this module
 * dependency-clean: zod only, no runtime imports from either host project.
 */

const GOOGLE_MAPS_ORIGIN = 'https://www.google.com';
const GOOGLE_MAPS_PREVIEW_PATH = '/maps/preview/place';
const MAX_LINK_TAGS = 64;
const MAX_LINK_TAG_UNITS = 8 * 1024;
const MAX_PREVIEW_URL_UNITS = 8 * 1024;
const MAX_PREVIEW_PAYLOAD_UNITS = 1024 * 1024;
const LINK_TAG_PATTERN = /<link\b[^>]{0,8192}>/gi;
const HREF_PATTERN = /\bhref\s*=\s*(["'])([\s\S]{1,8192}?)\1/i;
const PREVIEW_QUERY_KEYS = new Set(['authuser', 'hl', 'gl', 'q', 'pb']);
const XSSI_PREFIX_LF = ")]}'\n";
const XSSI_PREFIX_CRLF = ")]}'\r\n";
const MAX_PHOTOS = 12;
const MAX_REVIEWS = 10;
const PHOTO_LONG_SIDE = 1600;

const PlaceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const NameSchema = z.string().trim().min(1).max(256);
const OptionalTextSchema = z.string().trim().min(1).max(512);
const PhoneSchema = z.string().trim().min(1).max(64);
const UrlTextSchema = z.string().trim().min(1).max(2_048);
const LatitudeSchema = z.number().finite().min(-90).max(90);
const LongitudeSchema = z.number().finite().min(-180).max(180);
const RatingSchema = z.number().finite().min(0).max(5);
const ReviewCountSchema = z.number().int().nonnegative().max(1_000_000_000);
const ValueArraySchema = z.array(z.unknown()).max(512);
const RootSchema = z.array(z.unknown()).min(7).max(64);
const RecordSchema = z.array(z.unknown()).min(179).max(512);
const PhotoUrlSchema = z.string().trim().min(1).max(2_048);
const PhotoDimensionSchema = z.number().int().min(1).max(65_535);
const ReviewTextSchema = z.string().trim().min(1).max(2_000);

export type GoogleMapDirectPhoto = {
	readonly url: string;
	readonly width: number;
	readonly height: number;
};

export type GoogleMapDirectReview = {
	readonly text: string;
};

export type GoogleMapDirectPlace = {
	readonly externalId: string;
	readonly name: string;
	readonly address?: string;
	readonly latitude?: number;
	readonly longitude?: number;
	readonly category?: string;
	readonly website?: string;
	readonly phone?: string;
	readonly businessHours?: readonly string[];
	readonly rating?: number;
	readonly reviewCount?: number;
	readonly photos?: readonly GoogleMapDirectPhoto[];
	readonly reviews?: readonly GoogleMapDirectReview[];
};

export type GoogleMapDirectParseErrorCode =
	| 'GOOGLE_MAP_IDENTITY_MISMATCH'
	| 'GOOGLE_MAP_SCHEMA_MISMATCH';

export class GoogleMapDirectParseError extends Error {
	readonly name = 'GoogleMapDirectParseError';

	constructor(readonly code: GoogleMapDirectParseErrorCode) {
		super(code === 'GOOGLE_MAP_IDENTITY_MISMATCH'
			? 'Google Maps public data did not match the selected place'
			: 'Google Maps public data did not match the approved schema');
	}
}

type GoogleMapDirectMedia = {
	readonly photos?: readonly GoogleMapDirectPhoto[];
	readonly reviews?: readonly GoogleMapDirectReview[];
};

function parseError(code: GoogleMapDirectParseErrorCode): GoogleMapDirectParseError {
	return new GoogleMapDirectParseError(code);
}

function parsedValue<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

function valueArray(value: unknown): readonly unknown[] | undefined {
	return parsedValue(ValueArraySchema, value);
}

function decodedHtmlAttribute(value: string): string {
	return value.replace(/&(?:amp|#38|#x26);/gi, '&');
}

function isApprovedPreviewUrl(url: URL): boolean {
	if (
		url.protocol !== 'https:'
		|| url.hostname !== 'www.google.com'
		|| url.port !== ''
		|| url.username !== ''
		|| url.password !== ''
		|| url.pathname !== GOOGLE_MAPS_PREVIEW_PATH
		|| url.hash !== ''
		|| url.href.length > MAX_PREVIEW_URL_UNITS
		|| !url.searchParams.get('q')
		|| !url.searchParams.get('pb')
	) return false;
	const keys = [...url.searchParams.keys()];
	return keys.every((key) => (
		PREVIEW_QUERY_KEYS.has(key)
		&& url.searchParams.getAll(key).length === 1
	));
}

function previewPayloadBody(payload: string): string {
	if (payload.length > MAX_PREVIEW_PAYLOAD_UNITS) {
		throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');
	}
	if (payload.startsWith(XSSI_PREFIX_LF)) return payload.slice(XSSI_PREFIX_LF.length);
	if (payload.startsWith(XSSI_PREFIX_CRLF)) return payload.slice(XSSI_PREFIX_CRLF.length);
	throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');
}

function normalizedHttpUrl(value: unknown): string | undefined {
	const text = parsedValue(UrlTextSchema, value);
	if (!text) return undefined;
	try {
		const url = new URL(text);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
	} catch (error) {
		if (error instanceof TypeError) return undefined;
		throw error;
	}
}

function googlePhotoUrl(value: unknown): string | undefined {
	const parsed = PhotoUrlSchema.safeParse(value);
	if (!parsed.success) return undefined;
	try {
		const url = new URL(parsed.data);
		if (
			url.protocol !== 'https:'
			|| !/^lh\d+\.googleusercontent\.com$/.test(url.hostname)
			|| url.port !== ''
			|| url.username !== ''
			|| url.password !== ''
			|| url.hash !== ''
		) return undefined;
		return url.href;
	} catch (error) {
		if (error instanceof TypeError) return undefined;
		throw error;
	}
}

function publicReviewText(value: unknown): string | undefined {
	const parsed = ReviewTextSchema.safeParse(value);
	if (!parsed.success || parsed.data.startsWith('/geo/type/')) return undefined;
	return parsed.data;
}

/**
 * The payload's photo URLs carry the UI's render suffix (`=w86-h117-k-no` — a
 * 6KB thumbnail), while the node's dimension slot holds the ORIGINAL size
 * (e.g. 6764×9248). Archiving the URL as-is stored the thumbnail as the only
 * place photo. Rewrite the suffix to a bounded long side so the archive gets a
 * real photo, and report the dimensions that render will actually serve.
 * Only URLs with a `=` render suffix are rewritten — a suffix-less URL serves
 * the original and appending directives to it is not universally valid.
 */
function boundedPhotoUrl(url: string): string {
	const separator = url.indexOf('=');
	if (separator === -1) return url;
	return `${url.slice(0, separator)}=s${PHOTO_LONG_SIDE}-k-no`;
}

function boundedDimensions(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(1, PHOTO_LONG_SIDE / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

function collectPhotos(record: readonly unknown[]): GoogleMapDirectPhoto[] {
	const groups = valueArray(record[72]);
	const items = valueArray(groups?.[0]);
	if (!items) return [];
	const photos: GoogleMapDirectPhoto[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (photos.length >= MAX_PHOTOS) break;
		const image = valueArray(valueArray(item)?.[6]);
		const dimensions = valueArray(image?.[2]);
		const url = googlePhotoUrl(image?.[0]);
		const width = PhotoDimensionSchema.safeParse(dimensions?.[0]);
		const height = PhotoDimensionSchema.safeParse(dimensions?.[1]);
		if (!url || !width.success || !height.success) continue;
		// Size variants of one photo share the URL before the suffix, so the
		// rewritten URL doubles as the dedup key.
		const bounded = boundedPhotoUrl(url);
		if (seen.has(bounded)) continue;
		seen.add(bounded);
		photos.push({ url: bounded, ...boundedDimensions(width.data, height.data) });
	}
	return photos;
}

function collectReviews(record: readonly unknown[]): GoogleMapDirectReview[] {
	const summary = valueArray(record[100]);
	const groups = valueArray(summary?.[1]);
	const items = valueArray(valueArray(groups?.[0])?.[2]);
	if (!items) return [];
	const reviews: GoogleMapDirectReview[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (reviews.length >= MAX_REVIEWS) break;
		const text = publicReviewText(valueArray(item)?.[0]);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		reviews.push({ text });
	}
	return reviews;
}

export function parseGoogleMapDirectMedia(record: readonly unknown[]): GoogleMapDirectMedia {
	const photos = collectPhotos(record);
	const reviews = collectReviews(record);
	return {
		...(photos.length > 0 ? { photos } : {}),
		...(reviews.length > 0 ? { reviews } : {}),
	};
}

export function googleMapPreviewUrlFromHtml(html: string): URL | undefined {
	const approved = new Map<string, URL>();
	let inspected = 0;
	for (const match of html.matchAll(LINK_TAG_PATTERN)) {
		if (inspected >= MAX_LINK_TAGS) break;
		inspected += 1;
		const tag = match[0];
		if (!tag || tag.length > MAX_LINK_TAG_UNITS) continue;
		const href = HREF_PATTERN.exec(tag)?.[2];
		if (!href) continue;
		let url: URL;
		try {
			url = new URL(decodedHtmlAttribute(href), GOOGLE_MAPS_ORIGIN);
		} catch (error) {
			if (error instanceof TypeError) continue;
			throw error;
		}
		if (isApprovedPreviewUrl(url)) approved.set(url.href, url);
	}
	if (approved.size !== 1) return undefined;
	for (const url of approved.values()) return url;
	return undefined;
}

export function parseGoogleMapPreviewPayload(
	payload: string,
	expectedPlaceId: string,
): GoogleMapDirectPlace {
	if (!PlaceIdSchema.safeParse(expectedPlaceId).success) {
		throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(previewPayloadBody(payload));
	} catch (error) {
		if (error instanceof SyntaxError) throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');
		throw error;
	}
	const root = RootSchema.safeParse(decoded);
	if (!root.success) throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');
	const record = RecordSchema.safeParse(root.data[6]);
	if (!record.success) throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');

	const actualPlaceId = parsedValue(PlaceIdSchema, record.data[78]);
	if (!actualPlaceId) throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');
	if (actualPlaceId !== expectedPlaceId) {
		throw parseError('GOOGLE_MAP_IDENTITY_MISMATCH');
	}
	const name = parsedValue(NameSchema, record.data[11]);
	if (!name) throw parseError('GOOGLE_MAP_SCHEMA_MISMATCH');

	const ratingData = valueArray(record.data[4]);
	const websiteData = valueArray(record.data[7]);
	const locationData = valueArray(record.data[9]);
	const categoryData = valueArray(record.data[13]);
	const phoneGroups = valueArray(record.data[178]);
	const phoneData = valueArray(phoneGroups?.[0]);
	const latitude = parsedValue(LatitudeSchema, locationData?.[2]);
	const longitude = parsedValue(LongitudeSchema, locationData?.[3]);
	const address = parsedValue(OptionalTextSchema, record.data[39]);
	const category = parsedValue(OptionalTextSchema, categoryData?.[0]);
	const website = normalizedHttpUrl(websiteData?.[0]);
	const phone = parsedValue(PhoneSchema, phoneData?.[0]);
	const rating = parsedValue(RatingSchema, ratingData?.[7]);
	const reviewCount = parsedValue(ReviewCountSchema, ratingData?.[8]);

	return {
		externalId: expectedPlaceId,
		name,
		...(address ? { address } : {}),
		...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
		...(category ? { category } : {}),
		...(website ? { website } : {}),
		...(phone ? { phone } : {}),
		...(rating !== undefined ? { rating } : {}),
		...(reviewCount !== undefined ? { reviewCount } : {}),
		...parseGoogleMapDirectMedia(record.data),
	};
}
