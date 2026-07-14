import { z } from 'zod';

const ProviderSearchCandidateSchema = z.object({
  provider: z.literal('kakaomap'),
  externalId: z.string().regex(/^\d{1,30}$/),
  name: z.string().min(1).max(300),
  categoryName: z.string().max(500),
  categoryGroupCode: z.string().max(20),
  categoryGroupName: z.string().max(100),
  address: z.string().max(500),
  roadAddress: z.string().max(500),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  phone: z.string().max(100),
  placeUrl: z.string().url().max(500),
  selectionToken: z.string().min(1).max(4_096),
}).strict();

export const ProviderSearchResponseSchema = z.object({
  provider: z.literal('kakaomap'),
  query: z.string().min(1).max(100),
  page: z.number().int().min(1).max(45),
  size: z.number().int().min(1).max(15),
  isEnd: z.boolean(),
  pageableCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  attribution: z.object({
    provider: z.literal('Kakao'),
    label: z.string().min(1).max(200),
    url: z.string().url().max(500),
  }).strict(),
  results: z.array(ProviderSearchCandidateSchema).max(15),
}).strict();

export const ProviderPlaceSelectionResponseSchema = z.object({
  sourceArchiveId: z.string().min(1).max(64),
  targetArchiveId: z.string().min(1).max(64),
  enrichment: z.literal('queued'),
  place: z.object({
    provider: z.literal('kakaomap'),
    externalId: z.string().regex(/^\d{1,30}$/),
    name: z.string().min(1).max(300),
    category: z.string().max(500),
    address: z.string().max(500),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    phone: z.string().max(100),
    canonicalUrl: z.string().url().max(500),
  }).strict(),
}).strict();

export type ProviderSearchCandidate = Readonly<z.infer<typeof ProviderSearchCandidateSchema>>;
export type ProviderSearchResponse = Readonly<z.infer<typeof ProviderSearchResponseSchema>>;
export type ProviderPlaceSelectionResponse = Readonly<z.infer<typeof ProviderPlaceSelectionResponseSchema>>;

export class InvalidPlaceApiResponseError extends Error {
  readonly operation: 'search' | 'selection';

  constructor(operation: 'search' | 'selection') {
    super(`Invalid place ${operation} response`);
    this.name = 'InvalidPlaceApiResponseError';
    this.operation = operation;
  }
}
