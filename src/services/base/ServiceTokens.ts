/**
 * Service tokens for type-safe dependency injection
 * Each service is identified by a unique Symbol
 */

// Core Services
export const SERVICE_TOKENS = {
  // Archive orchestration
  ARCHIVE_SERVICE: Symbol.for('ArchiveService'),
  ARCHIVE_ORCHESTRATOR: Symbol.for('ArchiveOrchestrator'),

  // Data transformation
  MARKDOWN_CONVERTER: Symbol.for('MarkdownConverter'),

  // Storage and persistence
  VAULT_MANAGER: Symbol.for('VaultManager'),
  MEDIA_HANDLER: Symbol.for('MediaHandler'),

  // External API communication
  API_CLIENT: Symbol.for('ApiClient'),

  // Licensing and credit management
  GUMROAD_CLIENT: Symbol.for('GumroadClient'),
  LICENSE_VALIDATOR: Symbol.for('LicenseValidator'),
  LICENSE_STORAGE: Symbol.for('LicenseStorage'),
  CREDIT_MANAGER: Symbol.for('CreditManager'),
  CREDIT_RESET_SCHEDULER: Symbol.for('CreditResetScheduler'),
  GUMROAD_WEBHOOK_HANDLER: Symbol.for('GumroadWebhookHandler'),
  PROMO_CODE_VALIDATOR: Symbol.for('PromoCodeValidator'),
  PROMO_CODE_STORAGE: Symbol.for('PromoCodeStorage'),
  LICENSE_EXPIRATION_NOTIFIER: Symbol.for('LicenseExpirationNotifier'),
  GRACE_PERIOD_MANAGER: Symbol.for('GracePeriodManager'),

  // Plugin instance (special token for accessing Obsidian plugin)
  PLUGIN_INSTANCE: Symbol.for('PluginInstance'),

  // Job management
  PENDING_JOBS_MANAGER: Symbol.for('PendingJobsManager'),
} as const;

// Type-safe token type
export type ServiceToken = typeof SERVICE_TOKENS[keyof typeof SERVICE_TOKENS];

/**
 * Helper to get token description for debugging
 */
export function getTokenDescription(token: symbol): string {
  const entry = Object.entries(SERVICE_TOKENS).find(([_, value]) => value === token);
  return entry ? entry[0] : token.toString();
}
