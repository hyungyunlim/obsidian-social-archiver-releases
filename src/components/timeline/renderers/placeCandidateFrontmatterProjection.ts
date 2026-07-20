import type {
  ArchiveLocation,
  PlaceCandidateAttachmentResult,
} from '@/services/WorkersAPIClient';

const PRIMARY_LOCATION_FIELDS = [
  'location',
  'latitude',
  'longitude',
  'coordinates',
  'locationSource',
  'locationExternalId',
  'locationAddress',
  'locationUrl',
  'locationCategory',
  'locations',
  'locationCount',
] as const;

export function getNewlyAttachedPrimaryLocation(
  result: PlaceCandidateAttachmentResult,
): ArchiveLocation | null {
  const primaryId = result.primaryLocationId;
  if (!primaryId) return null;
  if (!result.outcomes.some((outcome) => outcome.locationId === primaryId)) return null;
  return result.activeLocations.find(
    (location) => location.id === primaryId && location.isPrimary,
  ) ?? null;
}

export function applyPrimaryCandidateLocationFrontmatter(
  frontmatter: Record<string, unknown>,
  primary: ArchiveLocation,
): void {
  for (const field of PRIMARY_LOCATION_FIELDS) delete frontmatter[field];
  frontmatter.location = primary.name;
  if (primary.latitude !== null && primary.longitude !== null) {
    frontmatter.latitude = primary.latitude;
    frontmatter.longitude = primary.longitude;
    frontmatter.coordinates = `${primary.latitude}, ${primary.longitude}`;
  }
  if (primary.source) frontmatter.locationSource = primary.source;
  if (primary.externalId) frontmatter.locationExternalId = primary.externalId;
  if (primary.address) frontmatter.locationAddress = primary.address;
  if (primary.url) frontmatter.locationUrl = primary.url;
  if (primary.category) frontmatter.locationCategory = primary.category;
}
