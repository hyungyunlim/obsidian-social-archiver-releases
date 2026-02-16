/**
 * GumroadWebhookHandler - Processes Gumroad webhook events
 */

import { Plugin } from 'obsidian';
import { IService } from './base/IService';
import { Logger } from './Logger';
import { verifyHmacSignature } from '../utils/encryption';
import {
  GumroadWebhookEvent,
  GumroadWebhookPayload,
} from '../types/license';
import {
  WebhookHandlerResult,
  WebhookEventRecord,
  IWebhookEventProcessor,
  SignatureVerificationResult,
  WebhookQueueConfig,
  DEFAULT_WEBHOOK_QUEUE_CONFIG,
  WebhookEventStats,
} from '../types/webhook';

/**
 * Webhook handler configuration
 */
export interface GumroadWebhookHandlerConfig {
  /** Plugin instance for data persistence */
  plugin: Plugin;
  /** Webhook secret for signature verification */
  webhookSecret: string;
  /** Queue configuration */
  queueConfig?: Partial<WebhookQueueConfig>;
  /** Whether to enable event logging */
  enableEventLogging?: boolean;
}

/**
 * Webhook handler data stored in plugin
 */
interface WebhookHandlerData {
  /** Processed event IDs for idempotency */
  processedEvents: Record<string, WebhookHandlerResult>;
  /** Event queue */
  eventQueue: WebhookEventRecord[];
  /** Statistics */
  stats: WebhookEventStats;
  /** Data version */
  version: number;
}

/**
 * Current data version
 */
const DATA_VERSION = 1;

/**
 * Gumroad webhook handler service
 */
export class GumroadWebhookHandler implements IService, IWebhookEventProcessor {
  private config: Required<GumroadWebhookHandlerConfig>;
  private queueConfig: WebhookQueueConfig;
  private logger?: Logger;
  private initialized = false;

  // Handler data
  private handlerData?: WebhookHandlerData;

  // Processing queue
  private processingInterval?: NodeJS.Timeout;

  constructor(config: GumroadWebhookHandlerConfig, logger?: Logger) {
    this.config = {
      ...config,
      queueConfig: { ...DEFAULT_WEBHOOK_QUEUE_CONFIG, ...config.queueConfig },
      enableEventLogging: config.enableEventLogging ?? true,
    } as Required<GumroadWebhookHandlerConfig>;

    this.queueConfig = {
      ...DEFAULT_WEBHOOK_QUEUE_CONFIG,
      ...config.queueConfig,
    };

    this.logger = logger;
  }

  /**
   * Initialize the webhook handler
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('GumroadWebhookHandler already initialized');
      return;
    }

    this.logger?.info('Initializing GumroadWebhookHandler');

    // Load handler data
    await this.loadHandlerData();

    // Start queue processing
    this.startQueueProcessing();

    this.initialized = true;
    this.logger?.info('GumroadWebhookHandler initialized successfully');
  }

  /**
   * Shutdown the webhook handler
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down GumroadWebhookHandler');

    // Stop queue processing
    this.stopQueueProcessing();

    // Save handler data
    await this.saveHandlerData();

    this.initialized = false;
  }

  /**
   * Handle incoming webhook request
   */
  async handleWebhook(
    payload: string,
    signature: string
  ): Promise<WebhookHandlerResult> {
    this.ensureInitialized();

    this.logger?.debug('Handling webhook', {
      payloadLength: payload.length,
    });

    // Verify signature
    const verification = await this.verifySignature(payload, signature);
    if (!verification.valid) {
      this.logger?.error('Webhook signature verification failed', undefined, {
        error: verification.error,
      });

      return {
        success: false,
        eventId: 'unknown',
        eventType: GumroadWebhookEvent.SALE,
        processedAt: Date.now(),
        error: verification.error || 'Invalid signature',
      };
    }

    // Parse payload
    let webhookPayload: GumroadWebhookPayload;
    try {
      webhookPayload = JSON.parse(payload);
    } catch (error) {
      this.logger?.error('Failed to parse webhook payload', error instanceof Error ? error : undefined);

      return {
        success: false,
        eventId: 'unknown',
        eventType: GumroadWebhookEvent.SALE,
        processedAt: Date.now(),
        error: 'Invalid JSON payload',
      };
    }

    // Create event ID
    const eventId = this.generateEventId(webhookPayload);

    // Check idempotency
    if (await this.isEventProcessed(eventId)) {
      this.logger?.info('Event already processed (idempotent)', { eventId });

      const existingResult = this.handlerData!.processedEvents[eventId];
      if (!existingResult) {
        throw new Error(`Event ${eventId} marked as processed but result not found`);
      }
      return existingResult;
    }

    // Determine event type
    const eventType = this.determineEventType(webhookPayload);

    // Create event record
    const eventRecord: WebhookEventRecord = {
      id: eventId,
      type: eventType,
      payload: webhookPayload,
      receivedAt: Date.now(),
      attempts: 0,
      status: 'pending',
    };

    // Add to queue
    this.handlerData!.eventQueue.push(eventRecord);
    this.handlerData!.stats.totalReceived++;
    this.handlerData!.stats.byType[eventType] = (this.handlerData!.stats.byType[eventType] || 0) + 1;

    await this.saveHandlerData();

    this.logger?.info('Webhook event queued', {
      eventId,
      eventType,
    });

    // Process immediately (will be retried if fails)
    const result = await this.processEvent(eventRecord);

    return result;
  }

  /**
   * Process a webhook event
   */
  async processEvent(event: WebhookEventRecord): Promise<WebhookHandlerResult> {
    this.ensureInitialized();

    const startTime = Date.now();

    this.logger?.debug('Processing webhook event', {
      eventId: event.id,
      eventType: event.type,
      attempt: event.attempts + 1,
    });

    // Update event status
    event.status = 'processing';
    event.attempts++;
    event.lastAttemptAt = startTime;

    try {
      // Process based on event type
      const result = await this.processEventByType(event);

      // Mark as completed
      event.status = 'completed';

      // Update stats
      this.handlerData!.stats.totalProcessed++;
      this.handlerData!.stats.totalPending--;

      const processingTime = Date.now() - startTime;
      this.updateAverageProcessingTime(processingTime);

      // Mark as processed
      await this.markEventProcessed(event.id, result);

      this.logger?.info('Webhook event processed successfully', {
        eventId: event.id,
        eventType: event.type,
        processingTime,
      });

      await this.saveHandlerData();

      return result;
    } catch (error) {
      this.logger?.error('Failed to process webhook event', error instanceof Error ? error : undefined, {
        eventId: event.id,
        eventType: event.type,
      });

      event.status = event.attempts >= this.queueConfig.maxRetries ? 'failed' : 'pending';
      event.lastError = error instanceof Error ? error.message : String(error);

      if (event.status === 'failed') {
        this.handlerData!.stats.totalFailed++;
        this.handlerData!.stats.totalPending--;
      } else {
        // Calculate next retry time with exponential backoff
        const delay = Math.min(
          this.queueConfig.initialRetryDelay * Math.pow(this.queueConfig.retryMultiplier, event.attempts - 1),
          this.queueConfig.maxRetryDelay
        );
        event.nextRetryAt = Date.now() + delay;
      }

      await this.saveHandlerData();

      return {
        success: false,
        eventId: event.id,
        eventType: event.type,
        processedAt: Date.now(),
        error: event.lastError,
      };
    }
  }

  /**
   * Check if event has already been processed
   */
  async isEventProcessed(eventId: string): Promise<boolean> {
    this.ensureInitialized();

    return !!this.handlerData!.processedEvents[eventId];
  }

  /**
   * Mark event as processed
   */
  async markEventProcessed(eventId: string, result: WebhookHandlerResult): Promise<void> {
    this.ensureInitialized();

    this.handlerData!.processedEvents[eventId] = result;

    // Remove from queue
    this.handlerData!.eventQueue = this.handlerData!.eventQueue.filter(
      (e) => e.id !== eventId
    );

    await this.saveHandlerData();
  }

  /**
   * Get webhook event statistics
   */
  getStats(): WebhookEventStats {
    this.ensureInitialized();

    return { ...this.handlerData!.stats };
  }

  /**
   * Get pending events
   */
  getPendingEvents(): WebhookEventRecord[] {
    this.ensureInitialized();

    return this.handlerData!.eventQueue.filter((e) => e.status === 'pending');
  }

  // Private helper methods

  /**
   * Verify webhook signature
   */
  private async verifySignature(
    payload: string,
    signature: string
  ): Promise<SignatureVerificationResult> {
    try {
      const isValid = await verifyHmacSignature(
        payload,
        signature,
        this.config.webhookSecret
      );

      if (!isValid) {
        return {
          valid: false,
          error: 'Signature mismatch',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Signature verification error',
      };
    }
  }

  /**
   * Generate event ID from payload
   */
  private generateEventId(payload: GumroadWebhookPayload): string {
    return `${payload.sale_id}-${payload.sale_timestamp}`;
  }

  /**
   * Determine event type from payload
   */
  private determineEventType(payload: GumroadWebhookPayload): GumroadWebhookEvent {
    if (payload.refunded) {
      return GumroadWebhookEvent.REFUND;
    }

    if (payload.disputed) {
      return GumroadWebhookEvent.DISPUTE;
    }

    if (payload.subscription_id) {
      // Check for subscription events (would need additional webhook data)
      return GumroadWebhookEvent.SUBSCRIPTION_UPDATED;
    }

    return GumroadWebhookEvent.SALE;
  }

  /**
   * Process event by type
   */
  private async processEventByType(event: WebhookEventRecord): Promise<WebhookHandlerResult> {
    const { type, payload } = event;

    this.logger?.info(`Processing ${type} event`, {
      licenseKey: payload.license_key,
      email: payload.email,
    });

    // Log event if enabled
    if (this.config.enableEventLogging) {
      this.logEvent(event);
    }

    // Process based on type
    switch (type) {
      case GumroadWebhookEvent.SALE:
        return this.handleSaleEvent(event);

      case GumroadWebhookEvent.REFUND:
        return this.handleRefundEvent(event);

      case GumroadWebhookEvent.DISPUTE:
        return this.handleDisputeEvent(event);

      case GumroadWebhookEvent.SUBSCRIPTION_UPDATED:
        return this.handleSubscriptionUpdatedEvent(event);

      case GumroadWebhookEvent.SUBSCRIPTION_ENDED:
        return this.handleSubscriptionEndedEvent(event);

      default:
        this.logger?.warn('Unknown event type', { type });
        return {
          success: true, // Don't retry unknown events
          eventId: event.id,
          eventType: type,
          processedAt: Date.now(),
          metadata: { message: 'Unknown event type, skipped' },
        };
    }
  }

  /**
   * Handle sale event
   */
  private async handleSaleEvent(event: WebhookEventRecord): Promise<WebhookHandlerResult> {
    const { payload } = event;

    // In a real implementation, this would:
    // 1. Create or update license record
    // 2. Initialize credit balance
    // 3. Send welcome email
    // 4. Update analytics

    this.logger?.info('Sale event processed', {
      licenseKey: payload.license_key,
      productName: payload.product_name,
      price: payload.price,
    });

    return {
      success: true,
      eventId: event.id,
      eventType: event.type,
      processedAt: Date.now(),
      metadata: {
        licenseKey: payload.license_key,
        productName: payload.product_name,
      },
    };
  }

  /**
   * Handle refund event
   */
  private async handleRefundEvent(event: WebhookEventRecord): Promise<WebhookHandlerResult> {
    const { payload } = event;

    // In a real implementation, this would:
    // 1. Deactivate license
    // 2. Revoke credits
    // 3. Update analytics

    this.logger?.info('Refund event processed', {
      licenseKey: payload.license_key,
    });

    return {
      success: true,
      eventId: event.id,
      eventType: event.type,
      processedAt: Date.now(),
      metadata: {
        licenseKey: payload.license_key,
      },
    };
  }

  /**
   * Handle dispute event
   */
  private async handleDisputeEvent(event: WebhookEventRecord): Promise<WebhookHandlerResult> {
    const { payload } = event;

    // Similar to refund
    this.logger?.warn('Dispute event processed', {
      licenseKey: payload.license_key,
    });

    return {
      success: true,
      eventId: event.id,
      eventType: event.type,
      processedAt: Date.now(),
      metadata: {
        licenseKey: payload.license_key,
      },
    };
  }

  /**
   * Handle subscription updated event
   */
  private async handleSubscriptionUpdatedEvent(
    event: WebhookEventRecord
  ): Promise<WebhookHandlerResult> {
    const { payload } = event;

    this.logger?.info('Subscription updated event processed', {
      subscriptionId: payload.subscription_id,
    });

    return {
      success: true,
      eventId: event.id,
      eventType: event.type,
      processedAt: Date.now(),
    };
  }

  /**
   * Handle subscription ended event
   */
  private async handleSubscriptionEndedEvent(
    event: WebhookEventRecord
  ): Promise<WebhookHandlerResult> {
    const { payload } = event;

    this.logger?.info('Subscription ended event processed', {
      subscriptionId: payload.subscription_id,
    });

    return {
      success: true,
      eventId: event.id,
      eventType: event.type,
      processedAt: Date.now(),
    };
  }

  /**
   * Log event for debugging
   */
  private logEvent(event: WebhookEventRecord): void {
    this.logger?.debug('Webhook event details', {
      eventId: event.id,
      eventType: event.type,
      payload: event.payload,
    });
  }

  /**
   * Update average processing time
   */
  private updateAverageProcessingTime(processingTime: number): void {
    const stats = this.handlerData!.stats;
    const totalProcessed = stats.totalProcessed;

    if (totalProcessed === 1) {
      stats.averageProcessingTime = processingTime;
    } else {
      stats.averageProcessingTime =
        (stats.averageProcessingTime * (totalProcessed - 1) + processingTime) / totalProcessed;
    }
  }

  /**
   * Start queue processing
   */
  private startQueueProcessing(): void {
    this.stopQueueProcessing();

    this.processingInterval = setInterval(async () => {
      await this.processQueuedEvents();
    }, 60000); // Check every minute

    this.logger?.debug('Queue processing started');
  }

  /**
   * Stop queue processing
   */
  private stopQueueProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
      this.logger?.debug('Queue processing stopped');
    }
  }

  /**
   * Process queued events that are ready for retry
   */
  private async processQueuedEvents(): Promise<void> {
    const now = Date.now();
    const readyEvents = this.handlerData!.eventQueue.filter(
      (e) =>
        e.status === 'pending' &&
        (!e.nextRetryAt || e.nextRetryAt <= now) &&
        e.attempts < this.queueConfig.maxRetries
    );

    if (readyEvents.length === 0) {
      return;
    }

    this.logger?.debug('Processing queued events', {
      count: readyEvents.length,
    });

    for (const event of readyEvents) {
      await this.processEvent(event);
    }
  }

  /**
   * Load handler data from plugin
   */
  private async loadHandlerData(): Promise<void> {
    try {
      const data = await this.config.plugin.loadData();

      if (data && data.webhookHandler) {
        this.handlerData = data.webhookHandler;

        this.logger?.debug('Webhook handler data loaded', {
          processedEvents: Object.keys(this.handlerData?.processedEvents || {}).length,
          queuedEvents: this.handlerData?.eventQueue?.length || 0,
        });
      } else {
        // Initialize empty data
        this.handlerData = {
          processedEvents: {},
          eventQueue: [],
          stats: {
            totalReceived: 0,
            totalProcessed: 0,
            totalFailed: 0,
            totalPending: 0,
            byType: {} as Record<GumroadWebhookEvent, number>,
            averageProcessingTime: 0,
          },
          version: DATA_VERSION,
        };

        this.logger?.debug('Initialized empty webhook handler data');
      }

      // Cleanup old processed events
      await this.cleanupOldEvents();
    } catch (error) {
      this.logger?.error('Failed to load webhook handler data', error instanceof Error ? error : undefined);

      // Initialize empty data on error
      this.handlerData = {
        processedEvents: {},
        eventQueue: [],
        stats: {
          totalReceived: 0,
          totalProcessed: 0,
          totalFailed: 0,
          totalPending: 0,
          byType: {} as Record<GumroadWebhookEvent, number>,
          averageProcessingTime: 0,
        },
        version: DATA_VERSION,
      };
    }
  }

  /**
   * Save handler data to plugin
   */
  private async saveHandlerData(): Promise<void> {
    try {
      const existingData = await this.config.plugin.loadData() || {};

      existingData.webhookHandler = this.handlerData;

      await this.config.plugin.saveData(existingData);

      this.logger?.debug('Webhook handler data saved');
    } catch (error) {
      this.logger?.error('Failed to save webhook handler data', error instanceof Error ? error : undefined);
    }
  }

  /**
   * Cleanup old processed events
   */
  private async cleanupOldEvents(): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.queueConfig.eventRetention;

    // Remove old processed events
    const processedEventIds = Object.keys(this.handlerData!.processedEvents);
    let cleaned = 0;

    for (const eventId of processedEventIds) {
      const result = this.handlerData!.processedEvents[eventId];
      if (result && result.processedAt < cutoff) {
        delete this.handlerData!.processedEvents[eventId];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger?.info('Cleaned up old processed events', { count: cleaned });
      await this.saveHandlerData();
    }
  }

  /**
   * Ensure handler is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GumroadWebhookHandler not initialized. Call initialize() first.');
    }
  }
}
