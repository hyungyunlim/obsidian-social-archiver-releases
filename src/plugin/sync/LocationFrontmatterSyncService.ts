/**
 * Reconciles server-owned place identity frontmatter on existing vault notes.
 * Both live WebSocket updates and library reconnect catch-up are authoritative;
 * unrelated user note/comment/tag/content fields are never touched.
 */

import type { App, TFile } from 'obsidian';
import type { LocalLockRegistry } from '../locks/LocalLockRegistry';

export interface RemoteArchiveLocationSource {
  readonly id: string;
  readonly location?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly locationSource?: string | null;
  readonly locationExternalId?: string | null;
}

export interface DesiredLocationFrontmatter {
  readonly location?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly coordinates?: string;
  readonly locationSource?: string;
  readonly locationExternalId?: string;
}

export interface LocationFrontmatterSyncDeps {
  readonly app: App;
  readonly apiClient: () => {
    getUserArchive(archiveId: string): Promise<{ archive: RemoteArchiveLocationSource }>;
  } | undefined;
  readonly findBySourceArchiveId: (archiveId: string) => TFile | null;
  readonly isLocationCategoryEnabled: () => boolean;
  readonly localLockRegistry?: LocalLockRegistry | undefined;
}

const LOG_PREFIX = '[Social Archiver] [LocationFrontmatterSync]';
const MANAGED_LOCATION_FIELDS = [
  'location',
  'latitude',
  'longitude',
  'coordinates',
  'locationSource',
  'locationExternalId',
] as const;

export const MAX_WS_RECONCILE_BATCH = 30;

export function buildDesiredLocationFrontmatter(
  archive: RemoteArchiveLocationSource,
): DesiredLocationFrontmatter | null {
  const location = typeof archive.location === 'string' && archive.location.trim().length > 0
    ? archive.location
    : null;
  const latitude = typeof archive.latitude === 'number' && Number.isFinite(archive.latitude)
    ? archive.latitude
    : null;
  const longitude = typeof archive.longitude === 'number' && Number.isFinite(archive.longitude)
    ? archive.longitude
    : null;
  const locationSource = typeof archive.locationSource === 'string'
    && archive.locationSource.trim().length > 0
    ? archive.locationSource
    : null;
  const locationExternalId = typeof archive.locationExternalId === 'string'
    && archive.locationExternalId.trim().length > 0
    ? archive.locationExternalId
    : null;
  const hasCoordinates = latitude !== null && longitude !== null;
  if (!location && !hasCoordinates && !locationSource && !locationExternalId) return null;

  return {
    ...(location ? { location } : {}),
    ...(hasCoordinates ? {
      latitude,
      longitude,
      coordinates: `${latitude}, ${longitude}`,
    } : {}),
    ...(locationSource ? { locationSource } : {}),
    ...(locationExternalId ? { locationExternalId } : {}),
  };
}

export function locationFrontmatterNeedsWrite(
  frontmatter: Record<string, unknown> | undefined,
  desired: DesiredLocationFrontmatter,
): boolean {
  const current = frontmatter ?? {};
  for (const key of MANAGED_LOCATION_FIELDS) {
    const desiredValue = desired[key];
    const currentValue = current[key];
    if (desiredValue === undefined) {
      if (currentValue !== undefined) return true;
      continue;
    }
    if (typeof desiredValue === 'number') {
      const currentNumber = typeof currentValue === 'number'
        ? currentValue
        : typeof currentValue === 'string'
          ? Number(currentValue)
          : Number.NaN;
      if (currentNumber !== desiredValue) return true;
    } else if (currentValue !== desiredValue) {
      return true;
    }
  }
  return false;
}

export function applyLocationFrontmatter(
  frontmatter: Record<string, unknown>,
  desired: DesiredLocationFrontmatter,
): void {
  for (const key of MANAGED_LOCATION_FIELDS) delete frontmatter[key];
  Object.assign(frontmatter, desired);
}

export class LocationFrontmatterSyncService {
  private disposed = false;

  constructor(private readonly deps: LocationFrontmatterSyncDeps) {}

  dispose(): void {
    this.disposed = true;
  }

  async reconcileArchiveIds(archiveIds: readonly string[]): Promise<void> {
    const apiClient = this.deps.apiClient();
    if (!apiClient || this.disposed) return;
    const uniqueIds = [...new Set(archiveIds)].slice(0, MAX_WS_RECONCILE_BATCH);
    if (uniqueIds.length < new Set(archiveIds).size) {
      console.debug(LOG_PREFIX, 'Capped authoritative reconcile batch', {
        requested: new Set(archiveIds).size,
        accepted: uniqueIds.length,
      });
    }

    for (const archiveId of uniqueIds) {
      if (this.disposed) return;
      const file = this.deps.findBySourceArchiveId(archiveId);
      if (!file) continue;
      try {
        const { archive } = await apiClient.getUserArchive(archiveId);
        if (this.disposed) return;
        await this.withWriteLocks(archiveId, () => this.reconcileFile(file, archive));
      } catch (error) {
        console.debug(LOG_PREFIX, 'Authoritative reconcile failed', {
          archiveId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async reconcileFromLibrarySync(
    file: TFile,
    archive: RemoteArchiveLocationSource,
  ): Promise<void> {
    await this.reconcileFile(file, archive);
  }

  private async reconcileFile(
    file: TFile,
    archive: RemoteArchiveLocationSource,
  ): Promise<void> {
    if (!this.deps.isLocationCategoryEnabled()) return;
    const cached = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
    const desired = buildDesiredLocationFrontmatter(archive) ?? {};
    if (!locationFrontmatterNeedsWrite(cached, desired)) return;
    await this.deps.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      applyLocationFrontmatter(frontmatter, desired);
    });
  }

  private async withWriteLocks<T>(archiveId: string, operation: () => Promise<T>): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return operation();
    return registry.withLocks([
      { kind: 'archiveMaterialization', archiveId },
      { kind: 'markdownWrite', archiveId },
    ], operation);
  }
}
