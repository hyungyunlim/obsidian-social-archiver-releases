import { z } from 'zod';
import { ArchiveLocationSchema, type ArchiveLocation } from './archive-location';

const OpaqueIdSchema = z.string().min(1).max(128);
const IdempotencyKeySchema = z.string().min(1).max(128);

/**
 * Capability token advertised via `X-Client-Capabilities` on the place-candidate
 * GET + attach endpoints. Advertising it opts this client into the server's
 * caption_llm candidates and the optional `role` field (Places P3b, §5.5). Old
 * clients that don't send it get byte-identical legacy responses, so the parser
 * below stays tolerant of the field in the same release that adds the header.
 */
export const PLACE_EXTRACT_CAPABILITY = 'place-extract-v1';

/**
 * Semantic role of a place candidate — display/filter hint only, never identity
 * or sort order (§3). `caption_llm` rows may carry one; determinstic rows won't.
 * Typed as a plain string in {@link PlaceCandidate} so a future server-side role
 * value can't reject the whole candidate — the chip renderer maps known values
 * and drops the rest.
 */
export const PLACE_CANDIDATE_ROLES = [
  'visited',
  'recommended',
  'venue',
  'route_stop',
  'mentioned',
  'sponsor',
  'other',
] as const;
export type PlaceCandidateRole = (typeof PLACE_CANDIDATE_ROLES)[number];

export type PlaceCandidate = {
  readonly id: string;
  readonly archiveId: string;
  readonly name: string | null;
  readonly addressText: string | null;
  readonly cityHint: string | null;
  readonly evidenceType: string;
  readonly evidenceText: string;
  readonly confidenceBucket: string | null;
  readonly score: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly externalSource: string | null;
  readonly externalPlaceId: string | null;
  readonly state: 'pending' | 'confirmed' | 'rejected' | 'superseded';
  readonly ordinal: number;
  readonly resolvedLocationId: string | null;
  readonly createdAt: string;
  /** Optional (Places P3b). Absent on legacy/ungated responses. */
  readonly role?: string | null;
};

export const PlaceCandidateSchema: z.ZodType<PlaceCandidate> = z.object({
  id: OpaqueIdSchema,
  archiveId: OpaqueIdSchema,
  name: z.string().max(300).nullable(),
  addressText: z.string().max(500).nullable(),
  cityHint: z.string().max(300).nullable(),
  evidenceType: z.string().min(1).max(64),
  evidenceText: z.string().max(2_048),
  confidenceBucket: z.string().max(64).nullable(),
  score: z.number().finite().nullable(),
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
  externalSource: z.string().max(64).nullable(),
  externalPlaceId: z.string().max(255).nullable(),
  state: z.enum(['pending', 'confirmed', 'rejected', 'superseded']),
  // caption_llm rows can take an ordinal beyond the legacy 0–7 window (§5.4);
  // any nonnegative int is valid so a high ordinal never nulls the response.
  ordinal: z.number().int().nonnegative(),
  resolvedLocationId: OpaqueIdSchema.nullable(),
  createdAt: z.string().min(1),
  // Known key so `.strict()` accepts it; plain string so an unrecognized server
  // role value degrades to "no chip" instead of failing the whole candidate.
  role: z.string().max(64).nullish(),
}).strict();

export type PlaceCandidatesResponse = {
  readonly items: readonly PlaceCandidate[];
  readonly pendingCount: number;
};

export const PlaceCandidatesResponseSchema: z.ZodType<PlaceCandidatesResponse> = z.object({
  items: z.array(PlaceCandidateSchema),
  pendingCount: z.number().int().nonnegative(),
}).strict();

// ---------------------------------------------------------------------------
// LLM place-extraction trigger (Places P3b, §5.1)
// POST /api/user/archives/:archiveId/place-candidates/extract
// ---------------------------------------------------------------------------

export type ExtractPlaceCandidatesExecutionPreference = 'auto' | 'server' | 'local';

export type ExtractPlaceCandidatesBody = {
  readonly idempotencyKey: string;
  /** Include server-held OCR notes/altText in the extraction input. Default true. */
  readonly includeOcr?: boolean;
  readonly executionPreference?: ExtractPlaceCandidatesExecutionPreference;
};

/** 202 — a new run was started (or an in-flight run was joined). */
export type ExtractPlaceCandidatesRunning = {
  readonly status: 'running';
  readonly runId: string;
  readonly jobId: string;
  readonly inFlight?: boolean;
};

/** 200 — a completed run with the same content hash replayed; credits 0. */
export type ExtractPlaceCandidatesReplay = {
  readonly status: 'completed';
  readonly runId: string;
  readonly replayed: true;
  readonly insertedCount: number;
  readonly candidates: readonly PlaceCandidate[];
};

export type ExtractPlaceCandidatesResult =
  | ExtractPlaceCandidatesRunning
  | ExtractPlaceCandidatesReplay;

// Intentionally NOT `.strict()` — the server may add fields; unknown keys are
// ignored rather than failing the union.
export const ExtractPlaceCandidatesResultSchema: z.ZodType<ExtractPlaceCandidatesResult> = z.union([
  z.object({
    status: z.literal('running'),
    runId: z.string().min(1),
    jobId: z.string().min(1),
    inFlight: z.boolean().optional(),
  }),
  z.object({
    status: z.literal('completed'),
    runId: z.string().min(1),
    replayed: z.literal(true),
    insertedCount: z.number().int().nonnegative(),
    candidates: z.array(PlaceCandidateSchema),
  }),
]);

export type DirectCandidateAttachment = {
  readonly candidateId: string;
  readonly name?: string;
  readonly addressText?: string;
};

export type AttachPlaceCandidatesBatchBody = {
  readonly idempotencyKey: string;
  readonly candidates: readonly DirectCandidateAttachment[];
};

export type AttachPlaceCandidateProviderBody = {
  readonly idempotencyKey: string;
  readonly selectionToken: string;
};

export type AttachPlaceCandidateExistingBody = {
  readonly idempotencyKey: string;
  readonly representativeArchiveId: string;
  readonly placeKey?: string;
};

const DirectCandidateAttachmentSchema: z.ZodType<DirectCandidateAttachment> = z.object({
  candidateId: OpaqueIdSchema,
  name: z.string().trim().min(1).max(300).optional(),
  addressText: z.string().trim().min(1).max(500).optional(),
}).strict();

export const AttachPlaceCandidatesBatchBodySchema: z.ZodType<AttachPlaceCandidatesBatchBody> = z.object({
  idempotencyKey: IdempotencyKeySchema,
  candidates: z.array(DirectCandidateAttachmentSchema).min(1).max(8),
}).strict().superRefine((body, context) => {
  const seen = new Set<string>();
  body.candidates.forEach((candidate, index) => {
    if (seen.has(candidate.candidateId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates', index, 'candidateId'],
        message: 'Candidate IDs must be unique',
      });
    }
    seen.add(candidate.candidateId);
  });
});

export const AttachPlaceCandidateProviderBodySchema: z.ZodType<AttachPlaceCandidateProviderBody> = z.object({
  idempotencyKey: IdempotencyKeySchema,
  selectionToken: z.string().min(1).max(8_192),
}).strict();

export const AttachPlaceCandidateExistingBodySchema: z.ZodType<AttachPlaceCandidateExistingBody> = z.object({
  idempotencyKey: IdempotencyKeySchema,
  representativeArchiveId: OpaqueIdSchema,
  placeKey: z.string().min(1).max(600).optional(),
}).strict();

export const PLACE_CANDIDATE_ATTACHMENT_OPERATIONS = [
  'attach_batch',
  'attach_provider',
  'attach_existing',
] as const;

export const PLACE_CANDIDATE_ATTACHMENT_OUTCOMES = [
  'attached',
  'reused',
  'already_attached',
  'resolved_location_deleted',
] as const;

export type PlaceCandidateAttachmentOperation =
  (typeof PLACE_CANDIDATE_ATTACHMENT_OPERATIONS)[number];
export type PlaceCandidateAttachmentOutcome =
  (typeof PLACE_CANDIDATE_ATTACHMENT_OUTCOMES)[number];

export type PlaceCandidateAttachmentItemResult = {
  readonly candidateId: string;
  readonly ordinal: number;
  readonly outcome: PlaceCandidateAttachmentOutcome;
  readonly locationId: string;
  readonly canonicalLocation: ArchiveLocation | null;
  readonly candidateStatus: 'confirmed';
};

export type PlaceCandidateAttachmentResult = {
  readonly replayed: boolean;
  readonly archiveId: string;
  readonly request: {
    readonly idempotencyKey: string;
    readonly requestDigest: string;
    readonly operation: PlaceCandidateAttachmentOperation;
  };
  readonly outcomes: readonly PlaceCandidateAttachmentItemResult[];
  readonly activeLocations: readonly ArchiveLocation[];
  readonly primaryLocationId: string | null;
  readonly remainingPendingCandidates: readonly PlaceCandidate[];
  readonly remainingPendingCount: number;
  readonly globalPendingCount: number;
};

const PlaceCandidateAttachmentResultObjectSchema = z.object({
  replayed: z.boolean(),
  archiveId: OpaqueIdSchema,
  request: z.object({
    idempotencyKey: IdempotencyKeySchema,
    requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    operation: z.enum(PLACE_CANDIDATE_ATTACHMENT_OPERATIONS),
  }).strict(),
  outcomes: z.array(z.object({
    candidateId: OpaqueIdSchema,
    // Relaxed from 0–7: an attached caption_llm candidate can carry a higher
    // ordinal (§5.4 ordinal-space split), so the upper bound would otherwise
    // null a legitimate attach response.
    ordinal: z.number().int().nonnegative(),
    outcome: z.enum(PLACE_CANDIDATE_ATTACHMENT_OUTCOMES),
    locationId: OpaqueIdSchema,
    canonicalLocation: ArchiveLocationSchema.nullable(),
    candidateStatus: z.literal('confirmed'),
  }).strict()),
  activeLocations: z.array(ArchiveLocationSchema).max(20),
  primaryLocationId: OpaqueIdSchema.nullable(),
  remainingPendingCandidates: z.array(PlaceCandidateSchema),
  remainingPendingCount: z.number().int().nonnegative(),
  globalPendingCount: z.number().int().nonnegative(),
}).strict();

const PlaceCandidateAttachmentEnvelopeSchema = PlaceCandidateAttachmentResultObjectSchema.extend({
  ok: z.literal(true),
}).strict();

const PlaceCandidateAttachmentErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    requestId: z.string().min(1),
  }).strict(),
}).strict();

export type PlaceCandidateAttachmentExpectation =
  | {
    readonly operation: 'attach_batch';
    readonly idempotencyKey: string;
    readonly archiveId: string;
    readonly candidateIds: readonly string[];
  }
  | {
    readonly operation: 'attach_provider' | 'attach_existing';
    readonly idempotencyKey: string;
    readonly candidateId: string;
  };

export function parsePlaceCandidateAttachmentResult(
  value: unknown,
  expected: PlaceCandidateAttachmentExpectation,
): PlaceCandidateAttachmentResult | null {
  const parsed = PlaceCandidateAttachmentEnvelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const { ok: _ok, ...result } = parsed.data;
  if (result.request.operation !== expected.operation
    || result.request.idempotencyKey !== expected.idempotencyKey
    || result.remainingPendingCount !== result.remainingPendingCandidates.length) return null;
  const outcomeIds = new Set(result.outcomes.map((outcome) => outcome.candidateId));
  if (outcomeIds.size !== result.outcomes.length) return null;
  switch (expected.operation) {
    case 'attach_batch':
      if (result.archiveId !== expected.archiveId
        || result.outcomes.length !== expected.candidateIds.length
        || !expected.candidateIds.every(
          (candidateId, index) => result.outcomes[index]?.candidateId === candidateId,
        )) return null;
      break;
    case 'attach_provider':
    case 'attach_existing':
      if (result.outcomes.length !== 1
        || result.outcomes[0]?.candidateId !== expected.candidateId) return null;
      break;
    default: {
      const exhaustive: never = expected;
      return exhaustive;
    }
  }
  const primary = result.activeLocations.find((location) => location.id === result.primaryLocationId);
  if ((result.primaryLocationId === null && result.activeLocations.some((location) => location.isPrimary))
    || (result.primaryLocationId !== null && primary?.isPrimary !== true)) return null;
  return result;
}

export type ParsedPlaceCandidateAttachmentError = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly requestId: string;
};

export function parsePlaceCandidateAttachmentError(
  value: unknown,
): ParsedPlaceCandidateAttachmentError | null {
  const parsed = PlaceCandidateAttachmentErrorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data.error : null;
}

export class InvalidPlaceCandidateAttachmentResponseError extends Error {
  readonly name = 'InvalidPlaceCandidateAttachmentResponseError';

  constructor() {
    super('Invalid place candidate attachment response');
  }
}

export class PlaceCandidateAttachmentApiError extends Error {
  readonly name = 'PlaceCandidateAttachmentApiError';

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string,
  ) {
    super(message);
  }
}
