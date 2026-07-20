/**
 * Killable client subprocess for the Todo 34 PTY resume harness.
 *
 * A REAL, separate, signalable process that drives the production
 * SyncQueueDrainService + SyncQueueMutationIdStore against the harness's mock v2
 * server. Mutation IDs are persisted to a file under $SA_QA_STORAGE so they
 * survive the SIGKILL the harness delivers at each scripted point:
 *
 *   SA_QA_KILL=after-page-fetch -> list page one, then hang (nothing processed)
 *   SA_QA_KILL=mid-item         -> mint+persist the ack id, "save", then hang
 *                                  (BEFORE the ACK — the id must survive)
 *   SA_QA_KILL=after-ack        -> mint(reuse persisted id)+save+ACK+settle, hang
 *   SA_QA_KILL=(empty)          -> full drain + one cursorless sweep, exit 0
 *
 * Each session re-lists from the FIRST page (cursor null); the server deletes on
 * ACK, so a restart only ever sees the survivors. This is the resume property.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  SyncQueueDrainService,
  type ProcessOutcome,
  type SyncQueueDrainItem,
  type SyncQueueListOutcome,
} from './SyncQueueDrainService';
import { SyncQueueMutationIdStore, type MutationIdStorage } from './SyncQueueMutationIdStore';

const BASE = requireEnv('SA_QA_BASE_URL');
const STORAGE = requireEnv('SA_QA_STORAGE');
const SESSION = requireEnv('SA_QA_SESSION');
const KILL = process.env.SA_QA_KILL ?? '';
const CLIENT_ID = 'qa-client';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing env ${name}`);
  return value;
}

/** File-backed localStorage shape so mutation IDs survive a process restart. */
class FileStorage implements MutationIdStorage {
  private readonly file = join(STORAGE, 'mutations.json');
  private read(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }
  getItem(key: string): string | null {
    return this.read()[key] ?? null;
  }
  setItem(key: string, value: string): void {
    const state = this.read();
    state[key] = value;
    writeFileSync(this.file, JSON.stringify(state));
  }
  removeItem(key: string): void {
    const state = this.read();
    delete state[key];
    writeFileSync(this.file, JSON.stringify(state));
  }
}

const store = new SyncQueueMutationIdStore(new FileStorage());

async function mark(point: string): Promise<void> {
  await fetch(`${BASE}/qa/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ point, session: SESSION }),
  });
}

/** Block forever with the event loop kept alive so the harness's SIGKILL lands. */
function hang(): Promise<never> {
  setInterval(() => undefined, 1 << 30);
  return new Promise<never>(() => undefined);
}

let listIndex = 0;

async function listPage({ cursor, limit }: { cursor: string | null; limit: number }): Promise<SyncQueueListOutcome> {
  const isSweep = listIndex > 0 && cursor === null; // the only non-first cursorless list in a run is the final sweep
  const current = (listIndex += 1);
  const params = new URLSearchParams({ clientId: CLIENT_ID, protocolVersion: '2', limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`${BASE}/api/sync/queue?${params.toString()}`, {
    headers: { 'X-QA-Session': SESSION, 'X-QA-Phase': isSweep ? 'sweep' : 'page' },
  });
  const body = (await response.json()) as { data: { items: SyncQueueDrainItem[]; nextCursor: string | null; hasMore: boolean } };
  const page: SyncQueueListOutcome = {
    kind: 'page',
    items: body.data.items.map((raw) => ({
      queueId: raw.queueId,
      archiveId: raw.archiveId,
      clientId: CLIENT_ID,
      versionToken: raw.versionToken,
    })),
    nextCursor: body.data.nextCursor,
    hasMore: body.data.hasMore,
  };
  if (KILL === 'after-page-fetch' && current === 1) {
    await mark('after-page-fetch');
    await hang();
  }
  return page;
}

let processedCount = 0;

async function processItem(item: SyncQueueDrainItem): Promise<ProcessOutcome> {
  const mutationId = store.getOrCreate(item.queueId, 'ack');
  const isFirst = processedCount === 0;
  processedCount += 1;
  // "save": pull the archive body (retried across restarts, idempotent).
  await fetch(`${BASE}/qa/archive/${item.archiveId}`, { headers: { 'X-QA-Session': SESSION } });
  if (KILL === 'mid-item' && isFirst) {
    await mark('mid-item'); // persisted id is on disk, ACK NOT yet sent
    await hang();
  }
  await fetch(`${BASE}/api/sync/queue/ack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Sync-Mutation-Id': mutationId,
      'X-Sync-Version-Token': item.versionToken,
      'X-QA-Session': SESSION,
    },
    body: JSON.stringify({ queueId: item.queueId, clientId: CLIENT_ID }),
  });
  store.settle(item.queueId, 'ack');
  if (KILL === 'after-ack' && isFirst) {
    await mark('after-ack');
    await hang();
  }
  return 'saved';
}

const service = new SyncQueueDrainService({
  listPage,
  processItem,
  scheduleContinuation: () => undefined,
  limits: { pageLimit: 10, maxItemsPerRun: 100, maxPagesPerRun: 10 },
});

service
  .drainOnce()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'client failure'}\n`);
    process.exit(1);
  });
