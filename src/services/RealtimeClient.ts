import { Events } from 'obsidian';

/**
 * WebSocket message types from Workers API
 */
export type RealtimeMessageType =
  | 'job_completed'
  | 'job_failed'
  | 'new_post'
  | 'update_post'
  | 'delete_post'
  | 'subscription_post' // From SubscriptionRunner webhook
  | 'profile_crawl_complete' // From Fediverse direct API crawls
  | 'client_sync' // From mobile app sync (multi-client sync)
  | 'archive_complete' // From archive job completion
  | 'share_created' // From share link creation
  | 'action_updated' // From web/mobile action (like, bookmark, share)
  | 'share_deleted' // From share deletion
  | 'archive_added' // From new archive creation (subscription or manual)
  | 'archive_deleted' // From archive deletion
  | 'archive_tags_updated' // From tag changes (mobile/web)
  | 'user_tags_updated'
  | 'author_profile_updated' // From editable author profile changes
  | 'archive_relation_updated' // From archive_link_relations create/update/soft-delete
  | 'subscription_changed' // From subscription create/update/delete
  | 'media_preserved' // From R2 media preservation
  | 'billing_status_updated' // From RevenueCat/server billing status changes
  | 'ai_comment_requested' // Targeted desktop Obsidian AI comment job hint
  | 'ai_comment_status_updated' // AI comment job status/progress update
  | 'ai_comment_updated' // Archive AI comments projection updated
  | 'ai_action_requested' // Targeted Obsidian AI action job hint
  | 'content_variant_updated' // Archive content variant projection updated
  | 'transcription_requested' // Targeted desktop Obsidian transcription job hint
  | 'transcription_status_updated' // Transcription job status/progress update
  | 'transcription_cancelled' // Targeted desktop Obsidian cancellation hint
  | 'transcription_updated' // Archive transcript projection updated
  | 'pong'; // WebSocket pong response

export interface RealtimeMessage {
  type: RealtimeMessageType;
  jobId?: string;
  status?: string;
  result?: unknown;
  shareId?: string;
  [key: string]: unknown;
}

/**
 * Function that fetches a one-time WS ticket for private channel auth.
 * Returns the ticket string, or null if auth is not available.
 */
export type TicketFetcher = () => Promise<string | null>;

/**
 * Which WebSocket channel is currently connected.
 * - `private`: authenticated channel; receives annotation & action events
 * - `public`:  degraded / unauthenticated channel; misses private-only events
 * - `none`:    not connected
 */
export type RealtimeChannelMode = 'private' | 'public' | 'none';

/**
 * Structured ticket failure log (§5.10).
 * Emitted one line per failure (not per retry).
 */
export interface TicketFailureLog {
  reason: 'rate-limit' | 'expired' | 'auth' | 'network' | 'other' | 'unavailable';
  httpStatus?: number;
  message?: string;
  at: string;
}

/**
 * RealtimeClient - WebSocket connection to Workers API
 * Handles real-time job completion notifications
 *
 * Connects to the PRIVATE channel when a ticketFetcher is provided,
 * falling back to the public channel if ticket fetch fails.
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private isIntentionallyClosed = false;
  private pingInterval: number | null = null;
  private ticketFetcher: TicketFetcher | null = null;
  private currentMode: RealtimeChannelMode = 'none';
  private connectionGeneration = 0;
  private connectPromise: Promise<void> | null = null;
  /** Track whether we logged a ticket failure for the current degraded session. */
  private ticketFailureLogged = false;

  /**
   * Optional callback invoked when the client transitions to the public
   * (degraded) channel. Consumers use this to start a fallback polling
   * loop (§5.8) to catch annotation events missed on the public channel.
   */
  onDegraded?: () => void;

  /**
   * Optional callback invoked when the client recovers to the private
   * channel. Consumers use this to stop the fallback polling loop.
   */
  onRecovered?: () => void;

  constructor(
    private apiUrl: string,
    private username: string,
    public events: Events,
    ticketFetcher?: TicketFetcher
  ) {
    this.ticketFetcher = ticketFetcher ?? null;
  }

  /** Return the active channel mode. */
  getChannelMode(): RealtimeChannelMode {
    return this.currentMode;
  }

  /**
   * Connect to WebSocket server.
   * Attempts private channel first (if ticketFetcher provided), falls back to public.
   */
  async connect(): Promise<void> {
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    if (this.connectPromise) return this.connectPromise;

    this.isIntentionallyClosed = false;
    const generation = ++this.connectionGeneration;

    const promise = this.openConnection(generation).finally(() => {
      if (this.connectPromise === promise) this.connectPromise = null;
    });
    this.connectPromise = promise;
    return promise;
  }

  private async openConnection(generation: number): Promise<void> {
    const baseWsUrl = this.apiUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    // Try private channel first
    let wsUrl: string;
    let nextMode: RealtimeChannelMode;
    if (this.ticketFetcher) {
      try {
        const ticket = await this.ticketFetcher();
        if (ticket) {
          wsUrl = `${baseWsUrl}/api/ws/private/${this.username}?ticket=${ticket}`;
          nextMode = 'private';
          console.debug('[RealtimeClient] Connecting to private channel');
        } else {
          wsUrl = `${baseWsUrl}/api/ws/${this.username}`;
          nextMode = 'public';
          this.logTicketFailure({
            reason: 'unavailable',
            message: 'ticketFetcher returned null',
            at: new Date().toISOString(),
          });
          console.debug('[RealtimeClient] No ticket available, falling back to public channel');
        }
      } catch (err) {
        wsUrl = `${baseWsUrl}/api/ws/${this.username}`;
        nextMode = 'public';
        this.logTicketFailure(this.classifyTicketFailure(err));
      }
    } else {
      wsUrl = `${baseWsUrl}/api/ws/${this.username}`;
      nextMode = 'public';
    }

    if (!this.isCurrentGeneration(generation)) return;

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (!this.isCurrentSocket(ws, generation)) return;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // Start ping/pong to keep connection alive
        this.startPing();

        this.setChannelMode(nextMode);

        this.events.trigger('ws:connected');
      };

      ws.onmessage = (event) => {
        if (!this.isCurrentSocket(ws, generation)) return;
        try {
          const message = JSON.parse(String(event.data)) as RealtimeMessage;

          // Skip logging pong messages (too verbose)
          // Emit specific event based on message type
          this.events.trigger(`ws:${message.type}`, message);

          // Also emit general message event
          this.events.trigger('ws:message', message);
        } catch (error) {
          console.error('[RealtimeClient] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        if (!this.isCurrentSocket(ws, generation)) return;
        console.error('[RealtimeClient] WebSocket error:', error);
        this.events.trigger('ws:error', error);
      };

      ws.onclose = (event) => {
        if (!this.isCurrentSocket(ws, generation)) return;
        this.stopPing();
        if (this.ws === ws) this.ws = null;
        // Mode resets to `none` on disconnect; the next connect() determines
        // whether we land on private or public. Do not emit onRecovered here.
        this.currentMode = 'none';
        this.events.trigger('ws:closed', event);

        // Reconnect if not intentionally closed
        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };

    } catch (error) {
      if (!this.isCurrentGeneration(generation)) return;
      console.error('[RealtimeClient] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.connectionGeneration && !this.isIntentionallyClosed;
  }

  private isCurrentSocket(ws: WebSocket, generation: number): boolean {
    return this.isCurrentGeneration(generation) && this.ws === ws;
  }

  /**
   * Transition channel mode and fire degraded/recovered callbacks exactly
   * at transition boundaries (public↔private). No-op on same-mode re-entry.
   */
  private setChannelMode(next: RealtimeChannelMode): void {
    const prev = this.currentMode;
    if (prev === next) return;
    this.currentMode = next;
    if (next === 'public') {
      try { this.onDegraded?.(); } catch (err) {
        console.warn('[RealtimeClient] onDegraded callback threw:', err instanceof Error ? err.message : String(err));
      }
    } else if (next === 'private' && prev !== 'private') {
      // Recovered: reset ticket-failure debounce so future degrade logs again
      this.ticketFailureLogged = false;
      try { this.onRecovered?.(); } catch (err) {
        console.warn('[RealtimeClient] onRecovered callback threw:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * Emit a single structured ticket-failure log line per degraded session
   * (not per retry). Resets after recovery to private.
   */
  private logTicketFailure(detail: TicketFailureLog): void {
    if (this.ticketFailureLogged) return;
    this.ticketFailureLogged = true;
    console.warn('[RealtimeClient] private ticket failure', {
      reason: detail.reason,
      httpStatus: detail.httpStatus,
      message: detail.message,
      at: detail.at,
    });
  }

  /**
   * Classify a ticket-fetch error into a coarse reason bucket for logging.
   * Avoids logging sensitive response bodies; only pulls HTTP status when
   * the error exposes it on a well-known field.
   */
  private classifyTicketFailure(err: unknown): TicketFailureLog {
    const message = err instanceof Error ? err.message : String(err);
    const lowered = message.toLowerCase();
    const statusCandidate =
      (err as { status?: unknown; statusCode?: unknown } | null)?.status ??
      (err as { status?: unknown; statusCode?: unknown } | null)?.statusCode;
    const httpStatus = typeof statusCandidate === 'number' ? statusCandidate : undefined;

    let reason: TicketFailureLog['reason'] = 'other';
    if (httpStatus === 429 || lowered.includes('rate')) reason = 'rate-limit';
    else if (httpStatus === 401 || httpStatus === 403 || lowered.includes('auth') || lowered.includes('forbidden')) reason = 'auth';
    else if (lowered.includes('expire')) reason = 'expired';
    else if (lowered.includes('network') || lowered.includes('fetch') || lowered.includes('timeout') || lowered.includes('offline')) reason = 'network';

    return {
      reason,
      httpStatus,
      message: message.length > 120 ? message.slice(0, 120) + '…' : message,
      at: new Date().toISOString(),
    };
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.connectionGeneration++;
    this.connectPromise = null;
    this.stopPing();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.currentMode = 'none';
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isConnecting(): boolean {
    return this.ws?.readyState === WebSocket.CONNECTING || this.connectPromise !== null;
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[RealtimeClient] Max reconnect attempts reached');
      this.events.trigger('ws:max_reconnect_reached');
      return;
    }

    this.clearReconnectTimer();

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectAttempts++;
      void this.connect();
    }, delay);
  }

  /**
   * Clear reconnect timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start ping/pong to keep connection alive
   * Sends ping every 30 seconds
   */
  private startPing(): void {
    this.stopPing();
    this.scheduleNextPing();
  }

  private scheduleNextPing(): void {
    this.pingInterval = window.setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('[RealtimeClient] Failed to send ping:', error);
        }
      }
      if (this.pingInterval !== null) {
        this.scheduleNextPing();
      }
    }, 30000); // 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval !== null) {
      window.clearTimeout(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.disconnect();
    // Note: Event listeners are managed by the parent (main.ts)
    // and cleaned up via clearRealtimeListeners()
  }
}
