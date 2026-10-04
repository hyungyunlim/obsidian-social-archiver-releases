import type { EventRef, Events } from 'obsidian';
import type {
  CollectionActivityReadyEventData,
  CollectionItemsUpdatedEventData,
  UserCollectionsUpdatedEventData,
} from '../../types/websocket';

/**
 * Collection realtime events (prd-collections-obsidian-plugin §4.1), kept out
 * of RealtimeEventBridge so that class doesn't grow another concern.
 *
 * - `user_collections_updated` / `collection_items_updated` → one sync pass
 *   (own echoes skipped), then a UI refresh for the named collections.
 * - `ws:connected` → a catch-up pass for what was missed while offline.
 * - `collection_activity_ready` → shown once per notificationId.
 */

export interface CollectionRealtimeListenerDeps {
  events: Events;
  syncClientId: () => string | undefined;
  performSync: () => Promise<unknown>;
  /** After a sync caused by an event: which collections changed (undefined = the list itself). */
  onRemoteChange: (collectionIds: string[] | undefined) => void;
  onActivity: (data: CollectionActivityReadyEventData) => void;
}

interface Envelope<T> {
  type?: string;
  data?: T;
}

/** Enough to absorb a reconnect replay; old ids age out. */
const SEEN_NOTIFICATION_LIMIT = 200;

export class CollectionRealtimeListener {
  private refs: EventRef[] = [];
  private readonly seenNotifications = new Set<string>();

  constructor(private readonly deps: CollectionRealtimeListenerDeps) {}

  setup(): void {
    this.clear();
    const { events } = this.deps;
    this.refs.push(
      events.on('ws:user_collections_updated', (message: unknown) => {
        const data = (message as Envelope<UserCollectionsUpdatedEventData> | undefined)?.data;
        if (this.isOwnEcho(data?.sourceClientId)) return;
        void this.syncThenNotify(data?.collectionIds);
      }),
      events.on('ws:collection_items_updated', (message: unknown) => {
        const data = (message as Envelope<CollectionItemsUpdatedEventData> | undefined)?.data;
        if (this.isOwnEcho(data?.sourceClientId)) return;
        void this.syncThenNotify(data?.collectionIds);
      }),
      events.on('ws:connected', () => {
        void this.syncThenNotify(undefined);
      }),
      events.on('ws:collection_activity_ready', (message: unknown) => {
        const data = (message as Envelope<CollectionActivityReadyEventData> | undefined)?.data;
        if (!data?.notificationId || !data.collectionId) return;
        if (this.seenNotifications.has(data.notificationId)) return;
        this.rememberNotification(data.notificationId);
        this.deps.onActivity(data);
      }),
    );
  }

  clear(): void {
    for (const ref of this.refs) this.deps.events.offref(ref);
    this.refs = [];
  }

  private isOwnEcho(sourceClientId: string | undefined): boolean {
    const own = this.deps.syncClientId();
    return Boolean(sourceClientId && own && sourceClientId === own);
  }

  private async syncThenNotify(collectionIds: string[] | undefined): Promise<void> {
    try {
      await this.deps.performSync();
    } catch (error) {
      console.debug('[Social Archiver] Collection sync after a realtime event failed:', error);
    }
    this.deps.onRemoteChange(collectionIds);
  }

  private rememberNotification(id: string): void {
    this.seenNotifications.add(id);
    if (this.seenNotifications.size <= SEEN_NOTIFICATION_LIMIT) return;
    const oldest = this.seenNotifications.values().next().value;
    if (oldest !== undefined) this.seenNotifications.delete(oldest);
  }
}
