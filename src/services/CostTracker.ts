/**
 * CostTracker - Cost calculation and usage tracking service
 */

import {
  Platform,
  PLATFORM_COSTS,
  CreditTransaction,
  TransactionType,
  CostEstimate,
  UsageStats,
  DailyUsage,
  MonthlyUsage,
  UsageAnalytics,
  OptimizationSuggestion,
  OptimizationSuggestionType,
} from '../types/credit';
import { IService } from '../types/services';
import { Logger } from './Logger';

/**
 * Cost tracker configuration
 */
export interface CostTrackerConfig {
  /** Maximum transactions to keep in memory */
  maxTransactions: number;
  /** Whether to enable analytics */
  enableAnalytics: boolean;
  /** Whether to persist transactions to disk */
  persistTransactions: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CostTrackerConfig = {
  maxTransactions: 1000,
  enableAnalytics: true,
  persistTransactions: true,
};

/**
 * Cost tracker service
 */
export class CostTracker implements IService {
  private config: CostTrackerConfig;
  private logger?: Logger;
  private initialized = false;

  // In-memory transaction store
  private transactions: Map<string, CreditTransaction> = new Map();
  private transactionIndex: string[] = [];

  // Usage cache (bounded to prevent unbounded growth)
  private static readonly MAX_USAGE_CACHE_SIZE = 90; // ~3 months of daily entries
  private dailyUsageCache: Map<string, DailyUsage> = new Map();
  private monthlyUsageCache: Map<string, MonthlyUsage> = new Map();

  constructor(config?: Partial<CostTrackerConfig>, logger?: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Initialize the cost tracker
   */
  initialize(): void {
    if (this.initialized) {
      this.logger?.warn('CostTracker already initialized');
      return;
    }

    this.logger?.info('Initializing CostTracker', {
      config: this.config,
    });

    // Load persisted transactions if enabled
    if (this.config.persistTransactions) {
      this.loadTransactions();
    }

    this.initialized = true;
    this.logger?.info('CostTracker initialized successfully');
  }

  /**
   * Shutdown the cost tracker
   */
  shutdown(): void {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down CostTracker');

    // Persist transactions if enabled
    if (this.config.persistTransactions) {
      this.persistTransactions();
    }

    this.initialized = false;
  }

  /**
   * Get cost for a platform
   */
  getCost(platform: Platform): number {
    return PLATFORM_COSTS[platform];
  }

  /**
   * Record a credit transaction
   */
  recordTransaction(transaction: CreditTransaction): void {
    this.ensureInitialized();

    this.logger?.debug('Recording transaction', {
      id: transaction.id,
      type: transaction.type,
      platform: transaction.platform,
      amount: transaction.amount,
    });

    // Store transaction
    this.transactions.set(transaction.id, transaction);
    this.transactionIndex.push(transaction.id);

    // Enforce max transactions limit
    while (this.transactionIndex.length > this.config.maxTransactions) {
      const oldestId = this.transactionIndex.shift();
      if (oldestId) {
        this.transactions.delete(oldestId);
      }
    }

    // Invalidate usage cache
    this.invalidateUsageCache(transaction.timestamp);

    this.logger?.debug('Transaction recorded', { id: transaction.id });
  }

  /**
   * Get transaction by ID
   */
  getTransaction(id: string): CreditTransaction | undefined {
    this.ensureInitialized();
    return this.transactions.get(id);
  }

  /**
   * Get all transactions
   */
  getAllTransactions(): CreditTransaction[] {
    this.ensureInitialized();
    return this.transactionIndex.map((id) => this.transactions.get(id)!).filter(Boolean);
  }

  /**
   * Get transactions for a date range
   */
  getTransactions(startDate: Date, endDate: Date): CreditTransaction[] {
    this.ensureInitialized();

    const start = startDate.getTime();
    const end = endDate.getTime();

    return this.getAllTransactions().filter(
      (tx) => tx.timestamp >= start && tx.timestamp <= end
    );
  }

  /**
   * Estimate cost for batch operations
   */
  estimateCost(platforms: Platform[]): CostEstimate {
    this.ensureInitialized();

    const breakdown: Record<Platform, number> = {
      facebook: 0,
      linkedin: 0,
      instagram: 0,
      tiktok: 0,
      x: 0,
      threads: 0,
    };

    let totalCredits = 0;

    for (const platform of platforms) {
      const cost = this.getCost(platform);
      breakdown[platform] += cost;
      totalCredits += cost;
    }

    return {
      totalCredits,
      breakdown,
      requestCount: platforms.length,
      affordable: false, // Will be set by CreditManager
    };
  }

  /**
   * Get daily usage for a specific date
   */
  getDailyUsage(date: Date): DailyUsage {
    this.ensureInitialized();

    const dateStr = this.formatDate(date);

    // Check cache
    const cached = this.dailyUsageCache.get(dateStr);
    if (cached) {
      return cached;
    }

    // Calculate usage
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const transactions = this.getTransactions(startOfDay, endOfDay);
    const usage = this.calculateUsageStats(dateStr, transactions);

    const dailyUsage: DailyUsage = {
      ...usage,
      date: dateStr,
    };

    // Cache result
    this.dailyUsageCache.set(dateStr, dailyUsage);

    // Evict oldest entries if cache is too large
    if (this.dailyUsageCache.size > CostTracker.MAX_USAGE_CACHE_SIZE) {
      const firstKey = this.dailyUsageCache.keys().next().value;
      if (firstKey !== undefined) this.dailyUsageCache.delete(firstKey);
    }

    return dailyUsage;
  }

  /**
   * Get monthly usage for a specific month
   */
  getMonthlyUsage(year: number, month: number): MonthlyUsage {
    this.ensureInitialized();

    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    // Check cache
    const cached = this.monthlyUsageCache.get(monthStr);
    if (cached) {
      return cached;
    }

    // Calculate usage
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const transactions = this.getTransactions(startOfMonth, endOfMonth);
    const usage = this.calculateUsageStats(monthStr, transactions);

    // Calculate daily breakdown
    const days: DailyUsage[] = [];
    const daysInMonth = endOfMonth.getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      days.push(this.getDailyUsage(date));
    }

    const monthlyUsage: MonthlyUsage = {
      ...usage,
      month: monthStr,
      days,
    };

    // Cache result
    this.monthlyUsageCache.set(monthStr, monthlyUsage);

    // Evict oldest entries if cache is too large
    if (this.monthlyUsageCache.size > CostTracker.MAX_USAGE_CACHE_SIZE) {
      const firstKey = this.monthlyUsageCache.keys().next().value;
      if (firstKey !== undefined) this.monthlyUsageCache.delete(firstKey);
    }

    return monthlyUsage;
  }

  /**
   * Get usage analytics
   */
  getAnalytics(): UsageAnalytics {
    this.ensureInitialized();

    if (!this.config.enableAnalytics) {
      throw new Error('Analytics not enabled');
    }

    const now = new Date();
    const currentMonth = this.getMonthlyUsage(now.getFullYear(), now.getMonth() + 1);

    const previousMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonth = this.getMonthlyUsage(
      previousMonthDate.getFullYear(),
      previousMonthDate.getMonth() + 1
    );

    // Calculate total usage (all time)
    const allTransactions = this.getAllTransactions();
    const totalCreditsUsed = allTransactions
      .filter((tx) => tx.type === TransactionType.DEDUCT && tx.success)
      .reduce((sum, tx) => sum + tx.amount, 0);

    const totalRequests = allTransactions.filter(
      (tx) => tx.type === TransactionType.DEDUCT
    ).length;

    // Find most used platform
    const platformCounts: Record<Platform, number> = {
      facebook: 0,
      linkedin: 0,
      instagram: 0,
      tiktok: 0,
      x: 0,
      threads: 0,
    };

    allTransactions.forEach((tx) => {
      if (tx.type === TransactionType.DEDUCT && tx.success) {
        platformCounts[tx.platform]++;
      }
    });

    const mostUsedPlatform = (Object.keys(platformCounts) as Platform[]).reduce((a, b) =>
      platformCounts[a] > platformCounts[b] ? a : b
    );

    // Calculate trend
    const trend = this.calculateTrend(currentMonth, previousMonth);

    // Calculate average daily usage
    const averageDailyUsage = currentMonth.days.length > 0
      ? currentMonth.creditsUsed / currentMonth.days.length
      : 0;

    // Project next month's usage
    const projectedUsage = this.projectUsage(currentMonth, previousMonth);

    // Generate optimization suggestions
    const suggestions = this.generateOptimizationSuggestions({
      currentMonth,
      previousMonth,
      platformCounts,
      averageDailyUsage,
    });

    return {
      totalCreditsUsed,
      totalRequests,
      currentMonth,
      previousMonth,
      mostUsedPlatform,
      averageDailyUsage,
      trend,
      projectedUsage,
      suggestions,
    };
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CostTracker not initialized. Call initialize() first.');
    }
  }

  private calculateUsageStats(period: string, transactions: CreditTransaction[]): UsageStats {
    const byPlatform: Record<Platform, { credits: number; requests: number }> = {
      facebook: { credits: 0, requests: 0 },
      linkedin: { credits: 0, requests: 0 },
      instagram: { credits: 0, requests: 0 },
      tiktok: { credits: 0, requests: 0 },
      x: { credits: 0, requests: 0 },
      threads: { credits: 0, requests: 0 },
    };

    const byStatus = {
      successful: 0,
      failed: 0,
      refunded: 0,
    };

    let creditsUsed = 0;
    let requestCount = 0;

    transactions.forEach((tx) => {
      if (tx.type === TransactionType.DEDUCT) {
        requestCount++;
        if (tx.success) {
          creditsUsed += tx.amount;
          byPlatform[tx.platform].credits += tx.amount;
          byPlatform[tx.platform].requests++;
          byStatus.successful++;
        } else {
          byStatus.failed++;
        }
      } else if (tx.type === TransactionType.REFUND) {
        byStatus.refunded++;
      }
    });

    const averageCost = requestCount > 0 ? creditsUsed / requestCount : 0;

    return {
      period,
      creditsUsed,
      requestCount,
      byPlatform,
      byStatus,
      averageCost,
    };
  }

  private calculateTrend(
    current: MonthlyUsage,
    previous: MonthlyUsage | undefined
  ): 'increasing' | 'decreasing' | 'stable' {
    if (!previous || previous.creditsUsed === 0) {
      return 'stable';
    }

    const change = current.creditsUsed - previous.creditsUsed;
    const changePercentage = (change / previous.creditsUsed) * 100;

    if (changePercentage > 10) {
      return 'increasing';
    } else if (changePercentage < -10) {
      return 'decreasing';
    }
    return 'stable';
  }

  private projectUsage(
    current: MonthlyUsage,
    previous: MonthlyUsage | undefined
  ): number {
    if (!previous) {
      return current.creditsUsed;
    }

    // Simple linear projection based on current trend
    const change = current.creditsUsed - previous.creditsUsed;
    return Math.max(0, current.creditsUsed + change);
  }

  private generateOptimizationSuggestions(data: {
    currentMonth: MonthlyUsage;
    previousMonth?: MonthlyUsage;
    platformCounts: Record<Platform, number>;
    averageDailyUsage: number;
  }): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Suggest cache utilization if making repeated requests
    const repeatRequests = this.detectRepeatRequests();
    if (repeatRequests > 0) {
      suggestions.push({
        type: OptimizationSuggestionType.CACHE_UTILIZATION,
        title: 'Enable Cache for Repeat Requests',
        description: `You have ${repeatRequests} repeat requests that could be cached, saving credits.`,
        potentialSavings: repeatRequests,
        impact: repeatRequests > 10 ? 'high' : repeatRequests > 5 ? 'medium' : 'low',
        priority: 1,
        actions: [
          'Enable caching in plugin settings',
          'Review frequently accessed content',
          'Consider longer cache TTL for static content',
        ],
      });
    }

    // Suggest cheaper platforms if using expensive ones frequently
    const linkedinUsage = data.platformCounts.linkedin;
    if (linkedinUsage > 10) {
      suggestions.push({
        type: OptimizationSuggestionType.PLATFORM_SELECTION,
        title: 'LinkedIn is Most Expensive',
        description: `LinkedIn costs 3 credits per request. Consider if all ${linkedinUsage} requests are necessary.`,
        potentialSavings: linkedinUsage,
        impact: 'medium',
        priority: 2,
        actions: [
          'Review LinkedIn archiving frequency',
          'Use cache for frequently accessed LinkedIn posts',
          'Consider archiving in batches',
        ],
      });
    }

    // Suggest batching if making many individual requests
    if (data.currentMonth.requestCount > 50) {
      suggestions.push({
        type: OptimizationSuggestionType.BATCH_REQUESTS,
        title: 'Batch Requests for Better Efficiency',
        description: 'Making many individual requests. Batching can reduce overhead.',
        potentialSavings: Math.floor(data.currentMonth.requestCount * 0.1),
        impact: 'low',
        priority: 3,
        actions: [
          'Queue multiple posts for archiving at once',
          'Use bulk import features when available',
          'Schedule periodic batch archives',
        ],
      });
    }

    // Suggest plan upgrade if consistently near limit
    if (data.averageDailyUsage > 0.8) {
      suggestions.push({
        type: OptimizationSuggestionType.UPGRADE_PLAN,
        title: 'Consider Upgrading to Pro Plan',
        description: 'You are using credits heavily. Pro plan offers better value.',
        potentialSavings: 0,
        impact: 'high',
        priority: 1,
        actions: [
          'Review Pro plan features',
          'Calculate cost savings with Pro credits',
          'Upgrade for unlimited features',
        ],
      });
    }

    return suggestions.sort((a, b) => a.priority - b.priority);
  }

  private detectRepeatRequests(): number {
    const urls = new Map<string, number>();
    let repeats = 0;

    this.getAllTransactions().forEach((tx) => {
      if (tx.reference) {
        const count = urls.get(tx.reference) || 0;
        urls.set(tx.reference, count + 1);
        if (count >= 1) {
          repeats++;
        }
      }
    });

    return repeats;
  }

  private invalidateUsageCache(timestamp: number): void {
    const date = new Date(timestamp);
    const dateStr = this.formatDate(date);
    const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    this.dailyUsageCache.delete(dateStr);
    this.monthlyUsageCache.delete(monthStr);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private loadTransactions(): void {
    // TODO: Implement persistence loading from localStorage or IndexedDB
    this.logger?.debug('Loading persisted transactions');
  }

  private persistTransactions(): void {
    // TODO: Implement persistence to localStorage or IndexedDB
    this.logger?.debug('Persisting transactions');
  }
}
