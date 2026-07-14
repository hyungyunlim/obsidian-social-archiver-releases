/**
 * PlaceCandidateStore
 *
 * Single Responsibility: batched, TTL-cached lookup of PENDING place
 * candidates per server archive ID for the timeline banner.
 *
 * Fetch strategy: per-card lazy requests made within a short window are
 * coalesced into ONE `GET /api/user/place-candidates?archiveIds=…` call
 * (≤50 ids per request), so a timeline render pass costs a single request.
 * Results are cached with a TTL so re-renders don't re-hit the API.
 *
 * Fail-soft: any API error resolves to "no candidates" (and is cached for
 * the TTL so an auth failure can't request-loop on every card render).
 */

import type { PlaceCandidate, PlaceCandidatesQuery, PlaceCandidatesResponse } from './WorkersAPIClient';

/** Minimal API surface — keeps the store testable without the full client. */
export interface PlaceCandidateApi {
  getPlaceCandidates(query: PlaceCandidatesQuery): Promise<PlaceCandidatesResponse>;
}

const BATCH_WINDOW_MS = 200;
const CACHE_TTL_MS = 60 * 1000;
const MAX_IDS_PER_REQUEST = 50;

interface CacheEntry {
  items: PlaceCandidate[];
  fetchedAt: number;
}

export class PlaceCandidateStore {
  private readonly cache = new Map<string, CacheEntry>();
  private queue = new Set<string>();
  private waiters = new Map<string, Array<(items: PlaceCandidate[]) => void>>();
  private timer: number | null = null;

  constructor(private readonly getApiClient: () => PlaceCandidateApi | undefined) {}

  /**
   * Resolve the PENDING candidates for one archive ID. Batched with other
   * calls arriving within {@link BATCH_WINDOW_MS}.
   */
  getPending(archiveId: string): Promise<PlaceCandidate[]> {
    const cached = this.cache.get(archiveId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return Promise.resolve(cached.items);
    }

    return new Promise<PlaceCandidate[]>((resolve) => {
      const list = this.waiters.get(archiveId);
      if (list) {
        list.push(resolve);
      } else {
        this.waiters.set(archiveId, [resolve]);
      }
      this.queue.add(archiveId);

      if (this.timer === null) {
        this.timer = window.setTimeout(() => {
          void this.flush();
        }, BATCH_WINDOW_MS);
      }
    });
  }

  /** Drop the cached entry for an archive (after confirm/reject). */
  invalidate(archiveId: string): void {
    this.cache.delete(archiveId);
  }

  /** Clear cache and cancel any pending batch (resolving waiters empty). */
  clear(): void {
    this.cache.clear();
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const waiters = this.waiters;
    this.waiters = new Map();
    this.queue.clear();
    for (const resolvers of waiters.values()) {
      for (const resolve of resolvers) resolve([]);
    }
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const ids = [...this.queue];
    this.queue.clear();
    const waiters = this.waiters;
    this.waiters = new Map();

    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      const byArchive = new Map<string, PlaceCandidate[]>();

      try {
        const apiClient = this.getApiClient();
        if (apiClient) {
          const response = await apiClient.getPlaceCandidates({ archiveIds: chunk });
          for (const item of response.items) {
            if (item.state !== 'pending') continue;
            const list = byArchive.get(item.archiveId);
            if (list) {
              list.push(item);
            } else {
              byArchive.set(item.archiveId, [item]);
            }
          }
        }
      } catch (error) {
        // Fail-soft: cache "no candidates" for the TTL so errors don't loop.
        console.debug(
          '[Social Archiver] [PlaceCandidateStore] fetch failed:',
          error instanceof Error ? error.message : String(error),
        );
      }

      const now = Date.now();
      for (const archiveId of chunk) {
        const items = byArchive.get(archiveId) ?? [];
        this.cache.set(archiveId, { items, fetchedAt: now });
        const resolvers = waiters.get(archiveId) ?? [];
        for (const resolve of resolvers) resolve(items);
      }
    }
  }
}
