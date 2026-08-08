import { z } from 'zod';

const SelectionTokenSchema = z.string().min(1).max(8_192);
const LatitudeSchema = z.number().finite().min(-90).max(90);
const LongitudeSchema = z.number().finite().min(-180).max(180);
const KakaoExternalIdSchema = z.string().regex(/^\d{1,30}$/);
const GoogleExternalIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);

function isCanonicalKakaoPlaceUrl(url: string, externalId: string): boolean {
  return url === `https://place.map.kakao.com/${externalId}`
    || url === `http://place.map.kakao.com/${externalId}`;
}

const KakaoCandidateSchema = z.object({
  provider: z.literal('kakaomap'),
  externalId: KakaoExternalIdSchema,
  name: z.string().min(1).max(300),
  categoryName: z.string().max(500),
  categoryGroupCode: z.string().max(20),
  categoryGroupName: z.string().max(100),
  address: z.string().max(500),
  roadAddress: z.string().max(500),
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
  phone: z.string().max(100),
  placeUrl: z.string().url().max(500),
  selectionToken: SelectionTokenSchema,
}).strict().refine(
  candidate => isCanonicalKakaoPlaceUrl(candidate.placeUrl, candidate.externalId),
);

/** Declared in `X-Client-Capabilities` to receive the search preview fields. */
export const PLACE_SEARCH_PREVIEW_CAPABILITY = 'place-search-preview-v1';

const MAX_PREVIEW_PHOTOS = 3;
const MAX_PREVIEW_REVIEWS = 3;

const PreviewPhotoSchema = z.object({
  url: z.string().url().max(2_048).startsWith('https://'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

/**
 * Display-only preview on a Google search result, sent only when the request
 * declares `place-search-preview-v1` and the server answers from the free
 * direct lane. The paid Text Search fallback never carries it.
 *
 * `.catch(undefined)` on each field, unlike the identity fields above: this is
 * decoration, and the enclosing object is `.strict()`, so a malformed rating
 * would otherwise fail the whole candidate and delete the place from the list.
 */
const GoogleCandidateSchema = z.object({
  provider: z.literal('googlemaps'),
  externalId: GoogleExternalIdSchema,
  displayName: z.string().min(1).max(300),
  formattedAddress: z.string().max(500),
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
  primaryType: z.string().min(1).max(100).optional(),
  rating: z.number().min(0).max(5).optional().catch(undefined),
  reviewCount: z.number().int().nonnegative().optional().catch(undefined),
  photos: z.array(PreviewPhotoSchema).max(MAX_PREVIEW_PHOTOS).optional().catch(undefined),
  reviews: z.array(z.string().min(1).max(2_000)).max(MAX_PREVIEW_REVIEWS).optional()
    .catch(undefined),
  selectionToken: SelectionTokenSchema,
}).strict();

type ProviderAttributionSchema<Provider extends 'Kakao' | 'Google'> = z.ZodObject<{
  provider: z.ZodLiteral<Provider>;
  label: z.ZodString;
  url: z.ZodString;
}, 'strict'>;

const AttributionSchema = <Provider extends 'Kakao' | 'Google'>(
  provider: Provider,
): ProviderAttributionSchema<Provider> => z.object({
  provider: z.literal(provider),
  label: z.string().min(1).max(200),
  url: z.string().url().max(500),
}).strict();

const KakaoSearchResponseSchema = z.object({
  provider: z.literal('kakaomap'),
  query: z.string().min(1).max(100),
  page: z.number().int().min(1).max(45),
  size: z.number().int().min(1).max(15),
  isEnd: z.boolean(),
  pageableCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  attribution: AttributionSchema('Kakao'),
  results: z.array(KakaoCandidateSchema).max(15),
}).strict().refine(response => (
  response.pageableCount <= response.totalCount
  && response.results.length <= response.pageableCount
));

const GoogleSearchResponseSchema = z.object({
  provider: z.literal('googlemaps'),
  query: z.string().min(1).max(100),
  size: z.number().int().min(1).max(15),
  attribution: AttributionSchema('Google'),
  pagination: z.object({
    kind: z.literal('cursor'),
    nextCursor: z.string().min(1).max(4_096).optional(),
  }).strict(),
  cloudCredit: z.object({ remaining: z.number().int().nonnegative().nullable() }).strict(),
  results: z.array(GoogleCandidateSchema).max(15),
}).strict();

export const ProviderSearchResponseSchema = z.union([
  KakaoSearchResponseSchema,
  GoogleSearchResponseSchema,
]);

export const ProviderPlaceSelectionResponseSchema = z.union([
  z.object({
    sourceArchiveId: z.string().min(1).max(64),
    targetArchiveId: z.string().min(1).max(64),
    enrichment: z.literal('queued'),
    place: z.object({
      provider: z.literal('kakaomap'),
      externalId: KakaoExternalIdSchema,
      name: z.string().min(1).max(300),
      category: z.string().max(500),
      address: z.string().max(500),
      latitude: LatitudeSchema,
      longitude: LongitudeSchema,
      phone: z.string().max(100),
      canonicalUrl: z.string().url().max(200),
    }).strict().refine(
      place => isCanonicalKakaoPlaceUrl(place.canonicalUrl, place.externalId),
    ),
  }).strict(),
  z.object({
    sourceArchiveId: z.string().min(1).max(64),
    targetArchiveId: z.string().min(1).max(64),
    enrichment: z.literal('queued'),
    place: z.object({
      provider: z.literal('googlemaps'),
      externalId: GoogleExternalIdSchema,
    }).strict(),
  }).strict(),
]);

export type KakaoProviderSearchCandidate = Readonly<z.infer<typeof KakaoCandidateSchema>>;
export type GoogleProviderSearchCandidate = Readonly<z.infer<typeof GoogleCandidateSchema>>;
export type ProviderSearchCandidate = KakaoProviderSearchCandidate | GoogleProviderSearchCandidate;
export type ProviderSearchResponse = Readonly<z.infer<typeof ProviderSearchResponseSchema>>;
export type ProviderPlaceSelectionResponse = Readonly<z.infer<typeof ProviderPlaceSelectionResponseSchema>>;

export const ProviderSearchCandidateContextSchema = z.object({
  archiveId: z.string().trim().min(1).max(128),
  candidateId: z.string().trim().min(1).max(128),
}).strict();

export type ProviderSearchCandidateContext = Readonly<
  z.infer<typeof ProviderSearchCandidateContextSchema>
>;

const KakaoProviderSearchRequestSchema = z.object({
  provider: z.literal('kakaomap'),
  query: z.string().trim().min(1).max(100),
  page: z.number().int().min(1).max(45),
  size: z.number().int().min(1).max(15),
  candidateContext: ProviderSearchCandidateContextSchema.optional(),
}).strict();

const GoogleProviderSearchRequestSchema = z.object({
  provider: z.literal('googlemaps'),
  query: z.string().trim().min(1).max(100),
  size: z.number().int().min(1).max(15),
  languageCode: z.string().min(1).max(64).optional(),
  regionCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  nextCursor: z.string().min(1).max(4_096).optional(),
  candidateContext: ProviderSearchCandidateContextSchema.optional(),
}).strict();

export const ProviderSearchRequestSchema = z.discriminatedUnion('provider', [
  KakaoProviderSearchRequestSchema,
  GoogleProviderSearchRequestSchema,
]);

export type ProviderSearchRequest = Readonly<z.infer<typeof ProviderSearchRequestSchema>>;

const ExpectedProviderPlaceSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('kakaomap'), externalId: KakaoExternalIdSchema }).strict(),
  z.object({ provider: z.literal('googlemaps'), externalId: GoogleExternalIdSchema }).strict(),
]);

export const ProviderPlaceSelectionRequestSchema = z.object({
  archiveId: z.string().min(1).max(64),
  selectionToken: SelectionTokenSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  expectedPlace: ExpectedProviderPlaceSchema,
}).strict();

export type ProviderPlaceSelectionRequest = Readonly<
  z.infer<typeof ProviderPlaceSelectionRequestSchema>
>;

export function parseProviderSearchResponse(
  value: unknown,
  request: ProviderSearchRequest,
): ProviderSearchResponse | null {
  const parsed = ProviderSearchResponseSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.provider !== request.provider
    || parsed.data.query !== request.query
    || parsed.data.size !== request.size
    || parsed.data.results.length > request.size) return null;
  switch (request.provider) {
    case 'kakaomap':
      return parsed.data.provider === 'kakaomap' && parsed.data.page === request.page
        ? parsed.data
        : null;
    case 'googlemaps':
      return parsed.data.provider === 'googlemaps' ? parsed.data : null;
    default:
      return assertNeverProviderSearchRequest(request);
  }
}

function assertNeverProviderSearchRequest(request: never): never {
  throw new TypeError(`Unhandled provider search request: ${String(request)}`);
}

export function parseProviderPlaceSelectionResponse(
  value: unknown,
  request: ProviderPlaceSelectionRequest,
): ProviderPlaceSelectionResponse | null {
  const parsed = ProviderPlaceSelectionResponseSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.sourceArchiveId !== request.archiveId
    || parsed.data.place.provider !== request.expectedPlace.provider
    || parsed.data.place.externalId !== request.expectedPlace.externalId) return null;
  return parsed.data;
}

export class InvalidPlaceApiResponseError extends Error {
  readonly operation: 'search' | 'selection';

  constructor(operation: 'search' | 'selection') {
    super(`Invalid place ${operation} response`);
    this.name = 'InvalidPlaceApiResponseError';
    this.operation = operation;
  }
}
