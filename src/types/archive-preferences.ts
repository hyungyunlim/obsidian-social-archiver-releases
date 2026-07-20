import { z } from 'zod';

const AutoArchiveInboxDaysSchema = z.union([
  z.literal(0), z.literal(7), z.literal(14), z.literal(30), z.literal(60), z.literal(90),
]);
const FailedArchiveAttemptRetentionDaysSchema = z.union([
  z.literal(30), z.literal(90), z.literal(180), z.literal(365),
]);
const MapSearchProviderPreferenceSchema = z.union([
  z.literal('auto'), z.literal('kakaomap'), z.literal('googlemaps'),
]);

const MapSearchProviderAvailabilitySchema = z.object({
  kakaomap: z.boolean(),
  googlemaps: z.boolean(),
}).strict();

const ArchivePreferencesSchema = z.object({
  autoArchiveInboxDays: AutoArchiveInboxDaysSchema,
  retainFailedArchiveAttempts: z.boolean(),
  failedArchiveAttemptRetentionDays: FailedArchiveAttemptRetentionDaysSchema,
  mapSearchProvider: MapSearchProviderPreferenceSchema,
  mapSearchProviderAvailability: MapSearchProviderAvailabilitySchema,
  autoArchiveLastRunAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const DirectArchivePreferencesEnvelopeSchema = z.object({
  success: z.literal(true),
  preferences: ArchivePreferencesSchema,
}).passthrough();

const NestedArchivePreferencesEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ preferences: ArchivePreferencesSchema }).passthrough(),
}).passthrough();

const ArchivePreferencesErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    details: z.unknown().optional(),
  }).passthrough().optional(),
}).passthrough();

export type AutoArchiveInboxDays = z.infer<typeof AutoArchiveInboxDaysSchema>;
export type MapSearchProviderPreference = z.infer<typeof MapSearchProviderPreferenceSchema>;
export type ArchivePreferences = Readonly<z.infer<typeof ArchivePreferencesSchema>>;
export type ArchivePreferencesPatch = Partial<Pick<
  ArchivePreferences,
  | 'autoArchiveInboxDays'
  | 'retainFailedArchiveAttempts'
  | 'failedArchiveAttemptRetentionDays'
  | 'mapSearchProvider'
>>;

export function parseArchivePreferencesResponse(value: unknown): ArchivePreferences | null {
  const direct = DirectArchivePreferencesEnvelopeSchema.safeParse(value);
  if (direct.success) return direct.data.preferences;
  const nested = NestedArchivePreferencesEnvelopeSchema.safeParse(value);
  return nested.success ? nested.data.data.preferences : null;
}

export class ArchivePreferencesApiError extends Error {
  readonly code: string | undefined;
  readonly details: unknown;
  readonly status: number;

  constructor(
    operation: 'load' | 'update',
    status: number,
    response: unknown,
  ) {
    const parsed = ArchivePreferencesErrorEnvelopeSchema.safeParse(response);
    const serverError = parsed.success ? parsed.data.error : undefined;
    const successfulStatus = status >= 200 && status < 300;
    super(successfulStatus
      ? 'Invalid archive preferences response'
      : serverError?.message ?? `Failed to ${operation} archive preferences`);
    this.name = 'ArchivePreferencesApiError';
    this.code = serverError?.code;
    this.details = serverError?.details;
    this.status = status;
  }
}
