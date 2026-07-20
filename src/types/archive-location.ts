import { z } from 'zod';

export const PLACE_ARCHIVE_STATES = [
  'metadata_only',
  'archiving',
  'archived',
  'archive_failed',
] as const;

export const PlaceArchiveStateSchema = z.enum(PLACE_ARCHIVE_STATES);
export type PlaceArchiveState = z.infer<typeof PlaceArchiveStateSchema>;

export const ArchiveLocationSchema = z.object({
  id: z.string().min(1).max(128),
  archiveId: z.string().min(1).max(128),
  placeKey: z.string().min(1).max(600),
  name: z.string().trim().min(1).max(300),
  address: z.string().max(500).nullable(),
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
  source: z.string().max(64).nullable(),
  externalId: z.string().max(255).nullable(),
  url: z.string().max(2_048).nullable(),
  category: z.string().max(500).nullable(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int().min(0).max(1_000),
  placeArchiveId: z.string().min(1).max(128).nullable(),
  promotionStatus: PlaceArchiveStateSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict().superRefine((location, context) => {
  if ((location.latitude === null) !== (location.longitude === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['latitude'],
      message: 'Latitude and longitude must both be present or both be null',
    });
  }
  if ((location.source === null) !== (location.externalId === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source'],
      message: 'Provider source and external ID must both be present or both be null',
    });
  }
});

export type ArchiveLocation = z.infer<typeof ArchiveLocationSchema>;

export const LocationAttachmentResultSchema = z.object({
  sourceArchiveId: z.string().min(1).max(128),
  locationId: z.string().min(1).max(128),
  intent: z.literal('attach_location'),
  location: ArchiveLocationSchema,
  enrichment: z.literal('not_requested'),
}).strict();

export type LocationAttachmentResult = z.infer<typeof LocationAttachmentResultSchema>;

export const LocationPromotionResultSchema = z.object({
  sourceArchiveId: z.string().min(1).max(128),
  location: ArchiveLocationSchema,
  targetArchiveId: z.string().min(1).max(128),
  intent: z.literal('archive_place'),
  enrichment: z.enum(['queued', 'completed']),
}).strict();

export type LocationPromotionResult = z.infer<typeof LocationPromotionResultSchema>;
