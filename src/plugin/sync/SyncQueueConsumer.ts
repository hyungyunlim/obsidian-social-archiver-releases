/**
 * Runtime wiring for the v2 sync-queue drain stack (Todo 34, wire-up).
 *
 * The plugin's single sync-queue consumption entry point routes through here.
 * We decide, per session, whether the server serves the signed-cursor v2 queue
 * (D1 read mode) or the legacy KV queue, then route accordingly:
 *
 *   - v2 available  -> SyncQueueDrainService.drainOnce() (interruption-safe loop,
 *                      idempotent v2 ACK carrying the item's version token + a
 *                      persisted mutation id). WS + poll share the ONE drain, so
 *                      its `inFlight` guard collapses concurrent triggers.
 *   - not available -> the UNCHANGED v1 catch-up (`runV1Fallback`), byte-identical
 *                      to before this module existed.
 *
 * Availability detection leans on the server's documented graceful degradation
 * (workers/src/handlers/sync-queue-list.ts): at the committed KV default the
 * route IGNORES `protocolVersion=2` and returns `{ items }` with NO `hasMore`.
 * Only the D1 v2 window returns `hasMore`. So the presence of `hasMore` on a
 * probe response is the availability signal — no new setting, no extra handshake.
 */

import type { PendingPost } from '../../services/SubscriptionManager';
import type { UserArchive, WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { PostData } from '../../types/post';
import type { DeviceLocalStorage } from '../../services/DeviceScopedIdStorage';
import {
  SyncQueueDrainService,
  type ProcessOutcome,
  type SyncQueueDrainItem,
  type SyncQueueDrainLimits,
  type SyncQueueListOutcome,
} from './SyncQueueDrainService';
import { SyncQueueMutationIdStore, type MutationIdStorage } from './SyncQueueMutationIdStore';
import { getRetryAfterMs, isRateLimitError, type SyncRateLimitGate } from './SyncRateLimitCoordinator';

/** Obsidian per-device localStorage backing for the mutation-id store. */
class DeviceLocalMutationStorage implements MutationIdStorage {
  constructor(private readonly storage: DeviceLocalStorage) {}
  getItem(key: string): string | null {
    const value = this.storage.loadLocalStorage(key);
    return typeof value === 'string' ? value : null;
  }
  setItem(key: string, value: string): void {
    this.storage.saveLocalStorage(key, value);
  }
  removeItem(key: string): void {
    this.storage.saveLocalStorage(key, null);
  }
}

export interface SyncQueueConsumerDeps {
  apiClient: () => WorkersAPIClient | undefined;
  /** The device's sync client id (settings.syncClientId). Empty => nothing to drain. */
  clientId: () => string;
  archivePath: () => string;
  /** Obsidian `App` — per-device localStorage for durable mutation ids. */
  localStorage: DeviceLocalStorage;
  saveSubscriptionPost: (post: PendingPost) => Promise<boolean>;
  convertUserArchiveToPostData: (archive: UserArchive) => PostData;
  hasRecentlyArchivedUrl: (url: string | null | undefined) => boolean;
  refreshTimelineView: () => void;
  /** Plugin's tracked timeout (cleared centrally on unload) — the drain's only cadence. */
  schedule: (callback: () => void, delayMs: number) => number;
  /** The unchanged v1 catch-up; byte-identical fallback when v2 is unavailable. */
  runV1Fallback: () => Promise<void>;
  rateLimiter?: SyncRateLimitGate;
  limits?: SyncQueueDrainLimits;
}

/** Routes the sync-queue entry point to the v2 drain or the v1 catch-up. */
export class SyncQueueConsumer {
  private readonly mutationStore: SyncQueueMutationIdStore;
  private readonly drain: SyncQueueDrainService;
  /** null = not yet probed this session; cached so we probe once, not per poll. */
  private v2Available: boolean | null = null;

  constructor(private readonly deps: SyncQueueConsumerDeps) {
    this.mutationStore = new SyncQueueMutationIdStore(new DeviceLocalMutationStorage(deps.localStorage));
    this.drain = new SyncQueueDrainService({
      listPage: (params) => this.listPage(params),
      processItem: (item) => this.processItem(item),
      scheduleContinuation: (delayMs) => {
        this.deps.schedule(() => { void this.drain.drainOnce(); }, delayMs);
      },
      limits: deps.limits,
    });
  }

  /** The sync-queue consumption entry point. Safe to call from WS and poll paths. */
  async consume(): Promise<void> {
    const api = this.deps.apiClient();
    const clientId = this.deps.clientId();
    if (!api || !clientId) {
      await this.deps.runV1Fallback();
      return;
    }
    if (this.v2Available === true) { await this.drain.drainOnce(); return; }
    if (this.v2Available === false) { await this.deps.runV1Fallback(); return; }

    let detected: boolean;
    try {
      const probe = await api.getSyncQueueV2(clientId, { limit: 1 });
      // KV-legacy omits `hasMore` entirely; the D1 v2 window always includes it.
      detected = 'hasMore' in probe;
    } catch {
      // Transient (503/429/network): don't cache; fall back and re-detect next time.
      await this.deps.runV1Fallback();
      return;
    }
    this.v2Available = detected;
    if (detected) await this.drain.drainOnce();
    else await this.deps.runV1Fallback();
  }

  /** Reset session detection (sign-out / unload). Idempotent. */
  clearState(): void {
    this.v2Available = null;
  }

  // -- drain deps (v2 only; listPage/processItem run solely once v2 is confirmed) --

  private async listPage(
    { cursor, limit }: { cursor: string | null; limit: number },
  ): Promise<SyncQueueListOutcome> {
    const api = this.deps.apiClient();
    const clientId = this.deps.clientId();
    if (!api || !clientId) return { kind: 'error' };
    try {
      const page = await api.getSyncQueueV2(clientId, { cursor, limit });
      return {
        kind: 'page',
        items: page.items.map((raw): SyncQueueDrainItem => ({
          queueId: raw.queueId,
          archiveId: raw.archiveId,
          clientId: raw.clientId ?? clientId,
          versionToken: raw.versionToken,
        })),
        nextCursor: page.nextCursor ?? null,
        hasMore: page.hasMore === true,
      };
    } catch (error) {
      if (isRateLimitError(error)) return { kind: 'rate-limited', retryAfterMs: getRetryAfterMs(error) };
      const enriched = error as { status?: number; code?: string } | null;
      if (enriched?.status === 426 || enriched?.code === 'SYNC_PROTOCOL_UPGRADE_REQUIRED') {
        return { kind: 'upgrade-required' };
      }
      if (enriched?.status === 400 || enriched?.code === 'SYNC_CURSOR_INVALID') {
        return { kind: 'cursor-invalid' };
      }
      return { kind: 'error' };
    }
  }

  private async processItem(item: SyncQueueDrainItem): Promise<ProcessOutcome> {
    const api = this.deps.apiClient();
    if (!api) return 'failed';
    try {
      await this.deps.rateLimiter?.acquire();
      const { archive } = await api.getUserArchive(item.archiveId);
      if (!archive) return 'failed';
      if (this.deps.hasRecentlyArchivedUrl(archive.originalUrl)) {
        await this.ackItem(api, item);
        return 'acked-duplicate';
      }
      const post = this.deps.convertUserArchiveToPostData(archive);
      const saved = await this.deps.saveSubscriptionPost({
        id: item.queueId,
        archiveId: item.archiveId,
        subscriptionId: `mobile-sync-${item.archiveId}`,
        subscriptionName: 'Mobile Sync',
        post,
        destinationFolder: this.deps.archivePath(),
        archivedAt: new Date().toISOString(),
      });
      if (!saved) return 'failed';
      await this.ackItem(api, item);
      this.deps.refreshTimelineView();
      return 'saved';
    } catch (error) {
      if (isRateLimitError(error)) {
        this.deps.rateLimiter?.reportRateLimited(error);
        return 'rate-limited';
      }
      // Not ACKed -> the item survives server-side; the next drain re-lists and
      // retries it. No per-item retry bookkeeping needed (self-healing property).
      console.error('[Social Archiver] v2 sync-queue item failed:', error);
      return 'failed';
    }
  }

  /** Idempotent v2 ACK: stable mutation id survives a lost response; settle on 2xx. */
  private async ackItem(api: WorkersAPIClient, item: SyncQueueDrainItem): Promise<void> {
    const mutationId = this.mutationStore.getOrCreate(item.queueId, 'ack');
    await api.ackSyncItemV2(item.queueId, item.clientId, item.versionToken, mutationId);
    this.mutationStore.settle(item.queueId, 'ack');
  }
}
