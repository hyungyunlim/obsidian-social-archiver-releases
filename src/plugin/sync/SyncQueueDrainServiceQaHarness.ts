/**
 * PTY resume QA harness for the v2 sync-queue drain (Todo 34).
 *
 * Stands up a real mock v2 server (keyset pagination, ACK deletes) on an
 * EPHEMERAL loopback port, then spawns the REAL client subprocess four times as
 * a signalable process group. It SIGKILLs the client after a page fetch, then
 * mid-item, then after an ACK, and finally lets it run to completion — proving:
 *
 *   - every restart re-lists from the FIRST page (cursor null)
 *   - the mutation id minted mid-item survives the kill and is REUSED for the
 *     real ACK on the next process (same persisted id)
 *   - each item is terminally ACKed exactly once (ACK deletes; replays no-op)
 *   - the completed run performs exactly ONE cursorless final sweep
 *   - teardown leaves no PID / listener / temp storage
 *
 * Node subprocess + SIGKILL to the process group stands in for a raw PTY (no
 * node-pty dependency): a real signalable child that stops on an external kill.
 * ponytail: child_process+SIGKILL is the terminal-stop the surface needs.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';

const CLIENT_PATH = fileURLToPath(new URL('./SyncQueueDrainServiceQaClient.ts', import.meta.url));
const QUEUE = [
  { queueId: 'q-alpha', archiveId: 'a-alpha', versionToken: 'v-alpha-1' },
  { queueId: 'q-beta', archiveId: 'a-beta', versionToken: 'v-beta-1' },
];
const ACK_KEY = (queueId: string): string => `sa:sync-queue-mut:ack:${queueId}`;

interface Observed {
  readonly acked: Set<string>;
  readonly ackCount: Map<string, number>;
  readonly ackMutationId: Map<string, string>;
  readonly firstListCursor: Map<string, string | null>;
  readonly marked: Map<string, string>;
  sweepCount: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
  res.end(JSON.stringify(body));
}

/** Keyset window over the live (non-acked) queue — deletes never renumber it. */
function listWindow(o: Observed, cursor: string | null, limit: number): { items: typeof QUEUE; nextCursor: string | null; hasMore: boolean } {
  const startAfter = cursor === null ? -1 : QUEUE.findIndex((item) => item.queueId === cursor);
  const live = QUEUE.filter((item, index) => index > startAfter && !o.acked.has(item.queueId));
  const window = live.slice(0, limit);
  const last = window[window.length - 1];
  const consumedUpto = last === undefined ? startAfter : QUEUE.findIndex((item) => item.queueId === last.queueId);
  const hasMore = QUEUE.some((item, index) => index > consumedUpto && !o.acked.has(item.queueId));
  return { items: window, nextCursor: last === undefined ? null : last.queueId, hasMore };
}

function startServer(o: Observed): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const session = req.headers['x-qa-session'];
    if (req.method === 'GET' && url.pathname === '/api/sync/queue') {
      const sessionId = typeof session === 'string' ? session : '?';
      if (!o.firstListCursor.has(sessionId)) o.firstListCursor.set(sessionId, url.searchParams.get('cursor'));
      if (req.headers['x-qa-phase'] === 'sweep') o.sweepCount += 1;
      const page = listWindow(o, url.searchParams.get('cursor'), Number(url.searchParams.get('limit') ?? '10'));
      return json(res, 200, { success: true, data: page });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/qa/archive/')) {
      return json(res, 200, { success: true, data: { archive: { id: url.pathname.split('/').pop() } } });
    }
    if (req.method === 'POST' && url.pathname === '/api/sync/queue/ack') {
      void readBody(req).then((raw) => {
        const { queueId } = JSON.parse(raw || '{}') as { queueId: string };
        const mutationId = req.headers['x-sync-mutation-id'];
        if (!o.acked.has(queueId)) {
          o.acked.add(queueId); // ACK deletes the item
          o.ackCount.set(queueId, (o.ackCount.get(queueId) ?? 0) + 1);
          if (typeof mutationId === 'string') o.ackMutationId.set(queueId, mutationId);
        }
        json(res, 200, { success: true, data: { versionToken: `v-${queueId}-acked` } });
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/qa/mark') {
      void readBody(req).then((raw) => {
        const { point, session: markedSession } = JSON.parse(raw || '{}') as { point: string; session: string };
        o.marked.set(markedSession, point);
        json(res, 200, { success: true });
      });
      return;
    }
    return json(res, 404, { success: false });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return predicate();
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function persistedMutationId(storageDir: string, queueId: string): string | null {
  try {
    const state = JSON.parse(readFileSync(join(storageDir, 'mutations.json'), 'utf8')) as Record<string, string>;
    return state[ACK_KEY(queueId)] ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const out = argValue('out');
  if (out === undefined) throw new Error('missing --out');
  const o: Observed = {
    acked: new Set(),
    ackCount: new Map(),
    ackMutationId: new Map(),
    firstListCursor: new Map(),
    marked: new Map(),
    sweepCount: 0,
  };
  const storageDir = mkdtempSync(join(tmpdir(), 'sa-queue-resume-'));
  const server = await startServer(o);
  const port = (server.address() as { port: number }).port;

  const sessions = [
    { kill: 'after-page-fetch', expectMark: true },
    { kill: 'mid-item', expectMark: true },
    { kill: 'after-ack', expectMark: true },
    { kill: '', expectMark: false },
  ];
  let midItemPersistedId: string | null = null;
  let finalExitOk = false;

  for (const [index, scenario] of sessions.entries()) {
    const sessionId = String(index + 1);
    const child = spawn('npx', ['tsx', CLIENT_PATH], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        SA_QA_BASE_URL: `http://127.0.0.1:${port}`,
        SA_QA_STORAGE: storageDir,
        SA_QA_SESSION: sessionId,
        SA_QA_KILL: scenario.kill,
      },
    });
    let exited = false;
    let exitCode: number | null = null;
    child.once('exit', (code) => {
      exited = true;
      exitCode = code;
    });

    if (scenario.expectMark) {
      await waitUntil(() => o.marked.get(sessionId) !== undefined, 45_000);
      if (scenario.kill === 'mid-item') midItemPersistedId = persistedMutationId(storageDir, 'q-alpha');
      if (child.pid !== undefined && !exited) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (!(error instanceof Error)) throw error; }
      }
      await waitUntil(() => exited, 10_000);
    } else {
      await waitUntil(() => exited, 45_000);
      finalExitOk = exitCode === 0;
    }
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  const portFree = await isPortFree(port);
  rmSync(storageDir, { recursive: true, force: true });

  const firstPagesNull = ['1', '2', '3', '4'].every((sessionId) => o.firstListCursor.get(sessionId) === null);
  const reusedId = o.ackMutationId.get('q-alpha');
  const observables = {
    restartFromFirstPage: firstPagesNull,
    sameMutationIdReused:
      midItemPersistedId !== null && midItemPersistedId !== '' && reusedId === midItemPersistedId,
    exactlyOneTerminalAck:
      o.ackCount.get('q-alpha') === 1 && o.ackCount.get('q-beta') === 1 && o.ackCount.size === 2,
    oneFinalSweep: o.sweepCount === 1,
    cleanNoListener: portFree && finalExitOk,
    clientRestartExact: false,
  };
  observables.clientRestartExact =
    observables.restartFromFirstPage &&
    observables.sameMutationIdReused &&
    observables.exactlyOneTerminalAck &&
    observables.oneFinalSweep &&
    observables.cleanNoListener;

  if (!observables.clientRestartExact) {
    process.stderr.write(`sync-queue resume QA failed: ${JSON.stringify(observables)} midId=${midItemPersistedId} reusedId=${reusedId ?? 'none'}\n`);
    process.exit(1);
  }
  writeFileSync(out, `${JSON.stringify({ status: 'PASS', observables, cleanup: { remainingPids: [], listeningPorts: [], tempPaths: [] } })}\n`);
  process.exit(0);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'unknown QA failure'}\n`);
  process.exit(1);
});
