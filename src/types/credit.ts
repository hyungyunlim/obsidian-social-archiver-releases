/**
 * Credit and cost tracking types
 */

/**
 * Supported platforms for cost tracking
 */
export type Platform = 'facebook' | 'linkedin' | 'instagram' | 'tiktok' | 'x' | 'threads';

/**
 * Platform cost matrix (in credits)
 */
export const PLATFORM_COSTS: Record<Platform, number> = {
  facebook: 2,
  linkedin: 3,
  instagram: 2,
  tiktok: 2,
  x: 1,
  threads: 1,
} as const;

/**
 * User plan types
 */
export type UserPlan = 'free' | 'pro';

/**
 * Plan credit limits
 */
export const PLAN_LIMITS: Record<UserPlan, number> = {
  free: 10,
  pro: 500,
} as const;

/**
 * Operation types for credit costs
 */
export enum OperationType {
  BASIC_ARCHIVE = 'basic_archive',
  WITH_AI = 'with_ai',
  DEEP_RESEARCH = 'deep_research',
}

/**
 * Operation cost matrix (in credits)
 */
export const OPERATION_COSTS: Record<OperationType, number> = {
  [OperationType.BASIC_ARCHIVE]: 1,
  [OperationType.WITH_AI]: 3,
  [OperationType.DEEP_RESEARCH]: 5,
} as const;

/**
 * Maximum credit rollover for pro plan
 */
export const MAX_CREDIT_ROLLOVER = 100;

/**
 * Credit threshold levels for alerts
 */
export enum CreditThreshold {
  CRITICAL = 0,    // 0% remaining
  LOW = 10,        // 10% remaining
  MEDIUM = 20,     // 20% remaining
}

/**
 * License information
 */
export interface License {
  /** License key */
  key: string;
  /** User plan */
  plan: UserPlan;
  /** Credits remaining */
  creditsRemaining: number;
  /** Credit limit for current period */
  creditLimit: number;
  /** Next reset date */
  resetDate: string;
  /** Features available */
  features: string[];
}

/**
 * Credit transaction types
 */
export enum TransactionType {
  DEDUCT = 'deduct',
  REFUND = 'refund',
  RESERVE = 'reserve',
  RELEASE = 'release',
  RESET = 'reset',
}

/**
 * Credit transaction record
 */
export interface CreditTransaction {
  /** Transaction ID */
  id: string;
  /** Transaction type */
  type: TransactionType;
  /** Platform */
  platform: Platform;
  /** Credits amount */
  amount: number;
  /** Timestamp */
  timestamp: number;
  /** Request ID or reference */
  reference?: string;
  /** Success status */
  success: boolean;
  /** Error if failed */
  error?: string;
  /** Balance before transaction */
  balanceBefore: number;
  /** Balance after transaction */
  balanceAfter: number;
}

/**
 * Cost estimation for batch operations
 */
export interface CostEstimate {
  /** Total credits required */
  totalCredits: number;
  /** Breakdown by platform */
  breakdown: Record<Platform, number>;
  /** Number of requests */
  requestCount: number;
  /** Whether user has enough credits */
  affordable: boolean;
  /** Credits needed if insufficient */
  creditsNeeded?: number;
}

/**
 * Usage statistics for a time period
 */
export interface UsageStats {
  /** Period identifier (e.g., "2024-01", "2024-01-15") */
  period: string;
  /** Total credits used */
  creditsUsed: number;
  /** Total requests */
  requestCount: number;
  /** Breakdown by platform */
  byPlatform: Record<Platform, {
    credits: number;
    requests: number;
  }>;
  /** Breakdown by success status */
  byStatus: {
    successful: number;
    failed: number;
    refunded: number;
  };
  /** Average cost per request */
  averageCost: number;
}

/**
 * Daily usage aggregation
 */
export interface DailyUsage extends UsageStats {
  /** Date in YYYY-MM-DD format */
  date: string;
}

/**
 * Monthly usage aggregation
 */
export interface MonthlyUsage extends UsageStats {
  /** Month in YYYY-MM format */
  month: string;
  /** Days in this month */
  days: DailyUsage[];
}

/**
 * Credit alert configuration
 */
export interface CreditAlertConfig {
  /** Whether alerts are enabled */
  enabled: boolean;
  /** Threshold percentages to alert on */
  thresholds: CreditThreshold[];
  /** Whether to show notifications */
  showNotifications: boolean;
  /** Whether to log to console */
  logToConsole: boolean;
}

/**
 * Credit alert event
 */
export interface CreditAlert {
  /** Alert threshold */
  threshold: CreditThreshold;
  /** Credits remaining */
  creditsRemaining: number;
  /** Credit limit */
  creditLimit: number;
  /** Percentage remaining */
  percentageRemaining: number;
  /** Timestamp */
  timestamp: number;
  /** Alert message */
  message: string;
}

/**
 * Credit reservation for queued requests
 */
export interface CreditReservation {
  /** Reservation ID */
  id: string;
  /** Platform */
  platform: Platform;
  /** Credits reserved */
  amount: number;
  /** Created timestamp */
  createdAt: number;
  /** Expires at timestamp */
  expiresAt: number;
  /** Request reference */
  reference: string;
  /** Whether reservation is active */
  active: boolean;
}

/**
 * Cost optimization suggestion types
 */
export enum OptimizationSuggestionType {
  CACHE_UTILIZATION = 'cache_utilization',
  PLATFORM_SELECTION = 'platform_selection',
  BATCH_REQUESTS = 'batch_requests',
  OFF_PEAK_USAGE = 'off_peak_usage',
  UPGRADE_PLAN = 'upgrade_plan',
}

/**
 * Cost optimization suggestion
 */
export interface OptimizationSuggestion {
  /** Suggestion type */
  type: OptimizationSuggestionType;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Potential credits saved */
  potentialSavings: number;
  /** Impact level */
  impact: 'high' | 'medium' | 'low';
  /** Priority */
  priority: number;
  /** Actionable steps */
  actions: string[];
}

/**
 * Usage analytics data
 */
export interface UsageAnalytics {
  /** Total credits used (all time) */
  totalCreditsUsed: number;
  /** Total requests (all time) */
  totalRequests: number;
  /** Current month usage */
  currentMonth: MonthlyUsage;
  /** Previous month usage */
  previousMonth?: MonthlyUsage;
  /** Most used platform */
  mostUsedPlatform: Platform;
  /** Average daily usage */
  averageDailyUsage: number;
  /** Trend (increasing/decreasing/stable) */
  trend: 'increasing' | 'decreasing' | 'stable';
  /** Projected credits needed for next period */
  projectedUsage: number;
  /** Cost optimization suggestions */
  suggestions: OptimizationSuggestion[];
}

/**
 * Cost tracker configuration
 */
export interface CostTrackerConfig {
  /** API endpoint for Cloudflare Workers */
  apiEndpoint: string;
  /** License key */
  licenseKey?: string;
  /** Alert configuration */
  alerts: CreditAlertConfig;
  /** Local cache for transactions (max entries) */
  maxLocalTransactions: number;
  /** Reservation timeout (milliseconds) */
  reservationTimeout: number;
  /** Whether to enable analytics */
  enableAnalytics: boolean;
}

/**
 * Credit manager events
 */
export enum CreditEventType {
  BALANCE_UPDATED = 'balance_updated',
  TRANSACTION_COMPLETED = 'transaction_completed',
  ALERT_TRIGGERED = 'alert_triggered',
  RESERVATION_CREATED = 'reservation_created',
  RESERVATION_RELEASED = 'reservation_released',
  REFUND_PROCESSED = 'refund_processed',
}

/**
 * Credit event
 */
export interface CreditEvent {
  /** Event type */
  type: CreditEventType;
  /** Timestamp */
  timestamp: number;
  /** Event data */
  data: Record<string, unknown>;
}

/**
 * Cloudflare API response types
 */
export interface CloudflareAPIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * License validation response
 */
export interface LicenseValidationResponse {
  valid: boolean;
  plan: UserPlan;
  creditsRemaining: number;
  creditLimit: number;
  resetDate: string;
  features: string[];
}

/**
 * Credit usage response
 */
export interface CreditUsageResponse {
  creditsUsed: number;
  creditsRemaining: number;
  transactionId: string;
}

/**
 * Credit refund response
 */
export interface CreditRefundResponse {
  creditsRefunded: number;
  creditsRemaining: number;
  transactionId: string;
}
