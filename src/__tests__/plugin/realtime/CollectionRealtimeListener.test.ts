import { describe, expect, it, vi } from 'vitest';
import { Events } from 'obsidian';
import { CollectionRealtimeListener } from '../../../plugin/realtime/CollectionRealtimeListener';

function setup() {
  const events = new Events();
  const performSync = vi.fn(async () => undefined);
  const onRemoteChange = vi.fn();
  const onActivity = vi.fn();
  const listener = new CollectionRealtimeListener({
    events,
    syncClientId: () => 'me',
    performSync,
    onRemoteChange,
    onActivity,
  });
  listener.setup();
  return { events, performSync, onRemoteChange, onActivity, listener };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CollectionRealtimeListener', () => {
  it('syncs on collection events from other clients and reports the collections', async () => {
    const { events, performSync, onRemoteChange } = setup();
    events.trigger('ws:collection_items_updated', { type: 'collection_items_updated', data: { collectionIds: ['col-1'], archiveIds: ['a'], updatedAt: 'u', timestamp: 1, sourceClientId: 'other' } });
    await flush();
    expect(performSync).toHaveBeenCalledTimes(1);
    expect(onRemoteChange).toHaveBeenCalledWith(['col-1']);
  });

  it('skips its own echoes', async () => {
    const { events, performSync } = setup();
    events.trigger('ws:user_collections_updated', { type: 'user_collections_updated', data: { updatedAt: 'u', timestamp: 1, sourceClientId: 'me' } });
    await flush();
    expect(performSync).not.toHaveBeenCalled();
  });

  it('catches up when the socket reconnects', async () => {
    const { events, performSync, onRemoteChange } = setup();
    events.trigger('ws:connected');
    await flush();
    expect(performSync).toHaveBeenCalledTimes(1);
    expect(onRemoteChange).toHaveBeenCalledWith(undefined);
  });

  it('shows an activity notification once per id', () => {
    const { events, onActivity } = setup();
    const data = { notificationId: 'n1', kind: 'items_added', collectionId: 'col-1', collectionName: 'Trips', actors: ['bob'], actorCount: 1, count: 2, displayNotification: true, createdAt: 'c' };
    events.trigger('ws:collection_activity_ready', { type: 'collection_activity_ready', data });
    events.trigger('ws:collection_activity_ready', { type: 'collection_activity_ready', data });
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('stops listening after clear()', async () => {
    const { events, performSync, listener } = setup();
    listener.clear();
    events.trigger('ws:connected');
    await flush();
    expect(performSync).not.toHaveBeenCalled();
  });
});
