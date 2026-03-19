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
  | 'archive_deleted' // From archive deletion
  | 'archive_tags_updated' // From tag changes (mobile/web)
  | 'media_preserved' // From R2 media preservation
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

  constructor(
    private apiUrl: string,
    private username: string,
    public events: Events,
    ticketFetcher?: TicketFetcher
  ) {
    this.ticketFetcher = ticketFetcher ?? null;
  }

  /**
   * Connect to WebSocket server.
   * Attempts private channel first (if ticketFetcher provided), falls back to public.
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isIntentionallyClosed = false;

    const baseWsUrl = this.apiUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    // Try private channel first
    let wsUrl: string;
    if (this.ticketFetcher) {
      try {
        const ticket = await this.ticketFetcher();
        if (ticket) {
          wsUrl = `${baseWsUrl}/api/ws/private/${this.username}?ticket=${ticket}`;
          console.debug('[RealtimeClient] Connecting to private channel');
        } else {
          wsUrl = `${baseWsUrl}/api/ws/${this.username}`;
          console.debug('[RealtimeClient] No ticket available, falling back to public channel');
        }
      } catch (err) {
        wsUrl = `${baseWsUrl}/api/ws/${this.username}`;
        console.warn('[RealtimeClient] Ticket fetch failed, falling back to public channel:', err instanceof Error ? err.message : String(err));
      }
    } else {
      wsUrl = `${baseWsUrl}/api/ws/${this.username}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // Start ping/pong to keep connection alive
        this.startPing();

        this.events.trigger('ws:connected');
      };

      this.ws.onmessage = (event) => {
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

      this.ws.onerror = (error) => {
        console.error('[RealtimeClient] WebSocket error:', error);
        this.events.trigger('ws:error', error);
      };

      this.ws.onclose = (event) => {
        this.stopPing();
        this.events.trigger('ws:closed', event);

        // Reconnect if not intentionally closed
        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };

    } catch (error) {
      console.error('[RealtimeClient] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopPing();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
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

    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('[RealtimeClient] Failed to send ping:', error);
        }
      }
    }, 30000); // 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval !== null) {
      window.clearInterval(this.pingInterval);
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
