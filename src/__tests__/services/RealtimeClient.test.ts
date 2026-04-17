/**
 * RealtimeClient — channel mode & degraded logging tests
 *
 * Covers §5.8 / §5.10 behaviours added in Phase 3:
 *   - onDegraded fires exactly once when connect lands on the public channel
 *   - onRecovered fires when a subsequent connect lands on private
 *   - private → private transition does NOT refire onDegraded
 *   - ticket failure logs a single structured warning per degraded session
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeClient } from '../../services/RealtimeClient';
import { Events } from 'obsidian';

// ─── Mock WebSocket ─────────────────────────────────────────────────────────

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  });

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  fireOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  fireClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('RealtimeClient (channel mode + logging)', () => {
  const originalWs = globalThis.WebSocket;
  let events: Events;

  beforeEach(() => {
    FakeWebSocket.reset();
    // Stub globals: window.setInterval/setTimeout exist in jsdom; use stubs
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    events = new Events();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWs;
  });

  it('fires onDegraded when the ticketFetcher throws and the client lands on public', async () => {
    const onDegraded = vi.fn();
    const onRecovered = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = new RealtimeClient(
      'https://api.example.com',
      'alice',
      events,
      async () => { throw new Error('rate limit exceeded'); },
    );
    client.onDegraded = onDegraded;
    client.onRecovered = onRecovered;

    await client.connect();
    // Open the socket so the `onopen` handler runs and transitions the mode.
    FakeWebSocket.instances[0]?.fireOpen();

    expect(client.getChannelMode()).toBe('public');
    expect(onDegraded).toHaveBeenCalledTimes(1);
    expect(onRecovered).not.toHaveBeenCalled();
    // Structured log emitted exactly once
    const ticketWarn = warn.mock.calls.find((c) =>
      String(c[0]).includes('private ticket failure'),
    );
    expect(ticketWarn).toBeDefined();
    const payload = ticketWarn?.[1] as { reason: string };
    expect(payload.reason).toBe('rate-limit');
  });

  it('fires onRecovered only on public → private transition, not on first private connect', async () => {
    const onDegraded = vi.fn();
    const onRecovered = vi.fn();
    let ticketOk = false;

    const client = new RealtimeClient(
      'https://api.example.com',
      'alice',
      events,
      async () => (ticketOk ? 'valid-ticket' : null),
    );
    client.onDegraded = onDegraded;
    client.onRecovered = onRecovered;

    // First connect: no ticket → public (degraded)
    await client.connect();
    FakeWebSocket.instances[0]?.fireOpen();
    expect(client.getChannelMode()).toBe('public');
    expect(onDegraded).toHaveBeenCalledTimes(1);

    // Close and reconnect with a valid ticket → private
    ticketOk = true;
    FakeWebSocket.instances[0]?.fireClose();
    await client.connect();
    FakeWebSocket.instances[1]?.fireOpen();

    expect(client.getChannelMode()).toBe('private');
    expect(onRecovered).toHaveBeenCalledTimes(1);
    // Should not re-fire degraded on private→private re-entry
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });

  it('logs only one ticket failure line per degraded session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = new RealtimeClient(
      'https://api.example.com',
      'alice',
      events,
      async () => { throw new Error('network'); },
    );

    await client.connect();
    FakeWebSocket.instances[0]?.fireOpen();
    FakeWebSocket.instances[0]?.fireClose();
    // Reconnect still fails (same session)
    await client.connect();
    FakeWebSocket.instances[1]?.fireOpen();

    const logLines = warn.mock.calls.filter((c) =>
      String(c[0]).includes('private ticket failure'),
    );
    // Exactly one structured log across two degraded reconnects
    expect(logLines).toHaveLength(1);
  });
});
