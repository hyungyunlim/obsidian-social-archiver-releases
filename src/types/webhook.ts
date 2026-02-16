/**
 * Webhook types for Gumroad integration
 */

import { GumroadWebhookEvent, GumroadWebhookPayload } from './license';

/**
 * Webhook event handler result
 */
export interface WebhookHandlerResult {
  /** Whether the webhook was processed successfully */
  success: boolean;
  /** Event ID for idempotency */
  eventId: string;
  /** Event type that was processed */
  eventType: GumroadWebhookEvent;
  /** Processing timestamp */
  processedAt: number;
  /** Error message if failed */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Webhook event record for queue
 */
export interface WebhookEventRecord {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: GumroadWebhookEvent;
  /** Event payload */
  payload: GumroadWebhookPayload;
  /** Received timestamp */
  receivedAt: number;
  /** Number of processing attempts */
  attempts: number;
  /** Last attempt timestamp */
  lastAttemptAt?: number;
  /** Processing status */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Error from last attempt */
  lastError?: string;
  /** Next retry timestamp */
  nextRetryAt?: number;
}

/**
 * Webhook signature verification result
 */
export interface SignatureVerificationResult {
  /** Whether signature is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Webhook event processor interface
 */
export interface IWebhookEventProcessor {
  /**
   * Process a webhook event
   */
  processEvent(event: WebhookEventRecord): Promise<WebhookHandlerResult>;

  /**
   * Check if event has already been processed (idempotency)
   */
  isEventProcessed(eventId: string): Promise<boolean>;

  /**
   * Mark event as processed
   */
  markEventProcessed(eventId: string, result: WebhookHandlerResult): Promise<void>;
}

/**
 * Webhook queue configuration
 */
export interface WebhookQueueConfig {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Initial retry delay in milliseconds */
  initialRetryDelay: number;
  /** Maximum retry delay in milliseconds */
  maxRetryDelay: number;
  /** Retry delay multiplier */
  retryMultiplier: number;
  /** Event retention in milliseconds (for completed/failed events) */
  eventRetention: number;
}

/**
 * Default webhook queue configuration
 */
export const DEFAULT_WEBHOOK_QUEUE_CONFIG: WebhookQueueConfig = {
  maxRetries: 5,
  initialRetryDelay: 1000, // 1 second
  maxRetryDelay: 60000, // 1 minute
  retryMultiplier: 2,
  eventRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Webhook event statistics
 */
export interface WebhookEventStats {
  /** Total events received */
  totalReceived: number;
  /** Events successfully processed */
  totalProcessed: number;
  /** Events failed */
  totalFailed: number;
  /** Events pending */
  totalPending: number;
  /** Events by type */
  byType: Record<GumroadWebhookEvent, number>;
  /** Average processing time in milliseconds */
  averageProcessingTime: number;
}
