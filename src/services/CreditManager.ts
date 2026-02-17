/**
 * CreditManager - Integrated credit management service
 */

import { Notice } from 'obsidian';
import {
  Platform,
  License,
  CreditTransaction,
  TransactionType,
  CreditReservation,
  CreditAlert,
  CreditThreshold,
  CreditAlertConfig,
  CreditEvent,
  CreditEventType,
  CostEstimate,
  OperationType,
  OPERATION_COSTS,
  PLAN_LIMITS,
  MAX_CREDIT_ROLLOVER,
} from '../types/credit';
import { IService } from '../types/services';
import { CloudflareAPI } from './CloudflareAPI';
import { CostTracker } from './CostTracker';
import { Logger } from './Logger';
import { PromoCodeValidator } from './licensing/PromoCodeValidator';
import { PromoCodeStorage } from './licensing/PromoCodeStorage';
import {
  PromoCodeType,
  AppliedPromoCode,
} from '../types/license';

/**
 * Credit manager configuration
 */
export interface CreditManagerConfig {
  /** License key */
  licenseKey?: string;
  /** Alert configuration */
  alerts: CreditAlertConfig;
  /** Reservation timeout in milliseconds */
  reservationTimeout: number;
  /** Whether to auto-refund on failure */
  autoRefund: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<CreditManagerConfig> = {
  alerts: {
    enabled: true,
    thresholds: [CreditThreshold.CRITICAL, CreditThreshold.LOW, CreditThreshold.MEDIUM],
    showNotifications: true,
    logToConsole: true,
  },
  reservationTimeout: 300000, // 5 minutes
  autoRefund: true,
};

/**
 * Credit manager service
 */
export class CreditManager implements IService {
  private config: CreditManagerConfig;
  private api: CloudflareAPI;
  private tracker: CostTracker;
  private logger?: Logger;
  private initialized = false;
  private promoValidator?: PromoCodeValidator;
  private promoStorage?: PromoCodeStorage;

  // Current license and balance
  private license?: License;
  private balance = 0;
  private lastResetDate?: Date;
  private rolloverCredits = 0;

  // Reservations
  private reservations: Map<string, CreditReservation> = new Map();
  private reservationCleanupInterval?: NodeJS.Timeout;

  // Alert tracking
  private alertedThresholds: Set<CreditThreshold> = new Set();

  // Event listeners
  private eventListeners: Map<CreditEventType, Set<(event: CreditEvent) => void>> = new Map();

  constructor(
    config: CreditManagerConfig,
    api: CloudflareAPI,
    tracker: CostTracker,
    logger?: Logger
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config } as CreditManagerConfig;
    this.api = api;
    this.tracker = tracker;
    this.logger = logger;
  }

  /**
   * Initialize the credit manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('CreditManager already initialized');
      return;
    }

    this.logger?.info('Initializing CreditManager', {
      hasLicenseKey: !!this.config.licenseKey,
      alertsEnabled: this.config.alerts.enabled,
    });

    // Initialize dependencies
    this.api.initialize();
    this.tracker.initialize();

    // Set initialized before loading license
    this.initialized = true;

    // Load license if key is provided
    if (this.config.licenseKey) {
      await this.loadLicense(this.config.licenseKey);

      // Check if credits need to be reset
      if (this.shouldResetCredits()) {
        this.logger?.info('Credits need reset on initialization');
        this.resetMonthlyCredits();
      }
    }

    // Start reservation cleanup
    this.startReservationCleanup();

    this.logger?.info('CreditManager initialized successfully');
  }

  /**
   * Shutdown the credit manager
   */
  shutdown(): void {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down CreditManager');

    // Stop reservation cleanup
    if (this.reservationCleanupInterval) {
      clearInterval(this.reservationCleanupInterval);
      this.reservationCleanupInterval = undefined;
    }

    // Shutdown dependencies
    this.tracker.shutdown();
    this.api.shutdown();

    // Clear event listeners
    this.eventListeners.clear();

    this.initialized = false;
  }

  /**
   * Load license and refresh balance
   */
  async loadLicense(licenseKey: string): Promise<License> {
    this.ensureInitialized();

    this.logger?.info('Loading license');

    this.api.setLicenseKey(licenseKey);
    this.config.licenseKey = licenseKey;

    const response = await this.api.validateLicense(licenseKey);

    this.license = {
      key: licenseKey,
      plan: response.plan,
      creditsRemaining: response.creditsRemaining,
      creditLimit: response.creditLimit,
      resetDate: response.resetDate,
      features: response.features,
    };

    this.balance = response.creditsRemaining;
    this.lastResetDate = response.resetDate ? new Date(response.resetDate) : undefined;

    this.logger?.info('License loaded', {
      plan: this.license.plan,
      creditsRemaining: this.balance,
    });

    // Check thresholds
    this.checkThresholds();

    // Emit event
    this.emitEvent({
      type: CreditEventType.BALANCE_UPDATED,
      timestamp: Date.now(),
      data: { balance: this.balance },
    });

    return this.license;
  }

  /**
   * Get current license
   */
  getLicense(): License | undefined {
    return this.license;
  }

  /**
   * Get current credit balance
   */
  getBalance(): number {
    return this.balance;
  }

  /**
   * Refresh balance from server
   */
  async refreshBalance(): Promise<number> {
    this.ensureInitialized();

    if (!this.config.licenseKey) {
      throw new Error('License key not set');
    }

    this.logger?.debug('Refreshing balance');

    const balance = await this.api.getBalance();
    this.balance = balance;

    if (this.license) {
      this.license.creditsRemaining = balance;
    }

    this.checkThresholds();

    this.emitEvent({
      type: CreditEventType.BALANCE_UPDATED,
      timestamp: Date.now(),
      data: { balance: this.balance },
    });

    return balance;
  }

  /**
   * Reserve credits for a request
   */
  reserveCredits(platform: Platform, reference: string): string {
    this.ensureInitialized();

    const cost = this.tracker.getCost(platform);

    if (this.getAvailableBalance() < cost) {
      throw new Error(`Insufficient credits: need ${cost}, have ${this.getAvailableBalance()}`);
    }

    const reservationId = this.generateId();
    const now = Date.now();

    const reservation: CreditReservation = {
      id: reservationId,
      platform,
      amount: cost,
      createdAt: now,
      expiresAt: now + this.config.reservationTimeout,
      reference,
      active: true,
    };

    this.reservations.set(reservationId, reservation);

    this.logger?.debug('Credits reserved', {
      reservationId,
      platform,
      amount: cost,
    });

    this.emitEvent({
      type: CreditEventType.RESERVATION_CREATED,
      timestamp: now,
      data: { reservationId, platform, amount: cost },
    });

    return reservationId;
  }

  /**
   * Commit a reservation and deduct credits
   */
  async commitReservation(
    reservationId: string,
    success: boolean = true
  ): Promise<CreditTransaction> {
    this.ensureInitialized();

    const reservation = this.reservations.get(reservationId);
    if (!reservation || !reservation.active) {
      throw new Error(`Invalid or expired reservation: ${reservationId}`);
    }

    this.logger?.debug('Committing reservation', {
      reservationId,
      success,
    });

    const transaction = await this.deductCredits(
      reservation.platform,
      reservation.amount,
      reservation.reference,
      success
    );

    // Release reservation
    this.releaseReservation(reservationId);

    return transaction;
  }

  /**
   * Release a reservation without committing
   */
  releaseReservation(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (reservation) {
      reservation.active = false;
      this.reservations.delete(reservationId);

      this.logger?.debug('Reservation released', { reservationId });

      this.emitEvent({
        type: CreditEventType.RESERVATION_RELEASED,
        timestamp: Date.now(),
        data: { reservationId },
      });
    }
  }

  /**
   * Deduct credits for a request
   */
  async deductCredits(
    platform: Platform,
    amount: number,
    reference?: string,
    success: boolean = true
  ): Promise<CreditTransaction> {
    this.ensureInitialized();

    if (!this.config.licenseKey) {
      throw new Error('License key not set');
    }

    const balanceBefore = this.balance;

    this.logger?.debug('Deducting credits', {
      platform,
      amount,
      reference,
      success,
    });

    let transactionSuccess = success;
    let error: string | undefined;

    try {
      // Only deduct from server if request was successful
      if (success) {
        const response = await this.api.useCredits(platform, amount);
        this.balance = response.creditsRemaining;
      }
    } catch (err) {
      transactionSuccess = false;
      error = err instanceof Error ? err.message : String(err);
      this.logger?.error('Credit deduction failed', err instanceof Error ? err : undefined, { error });
    }

    // Record transaction
    const transaction: CreditTransaction = {
      id: this.generateId(),
      type: TransactionType.DEDUCT,
      platform,
      amount,
      timestamp: Date.now(),
      reference,
      success: transactionSuccess,
      error,
      balanceBefore,
      balanceAfter: this.balance,
    };

    this.tracker.recordTransaction(transaction);

    // Check thresholds
    this.checkThresholds();

    // Emit event
    this.emitEvent({
      type: CreditEventType.TRANSACTION_COMPLETED,
      timestamp: transaction.timestamp,
      data: { transaction },
    });

    this.emitEvent({
      type: CreditEventType.BALANCE_UPDATED,
      timestamp: transaction.timestamp,
      data: { balance: this.balance },
    });

    return transaction;
  }

  /**
   * Refund credits for a failed request
   */
  async refundCredits(
    transactionId: string,
    reason?: string
  ): Promise<CreditTransaction> {
    this.ensureInitialized();

    if (!this.config.licenseKey) {
      throw new Error('License key not set');
    }

    const originalTransaction = this.tracker.getTransaction(transactionId);
    if (!originalTransaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    if (originalTransaction.type !== TransactionType.DEDUCT) {
      throw new Error(`Cannot refund non-deduct transaction: ${transactionId}`);
    }

    const balanceBefore = this.balance;

    this.logger?.info('Refunding credits', {
      transactionId,
      amount: originalTransaction.amount,
      reason,
    });

    let success = true;
    let error: string | undefined;

    try {
      const response = await this.api.refundCredits(
        originalTransaction.platform,
        originalTransaction.amount,
        transactionId
      );
      this.balance = response.creditsRemaining;
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      this.logger?.error('Credit refund failed', err instanceof Error ? err : undefined, { error });
    }

    // Record refund transaction
    const transaction: CreditTransaction = {
      id: this.generateId(),
      type: TransactionType.REFUND,
      platform: originalTransaction.platform,
      amount: originalTransaction.amount,
      timestamp: Date.now(),
      reference: transactionId,
      success,
      error,
      balanceBefore,
      balanceAfter: this.balance,
    };

    this.tracker.recordTransaction(transaction);

    // Emit event
    this.emitEvent({
      type: CreditEventType.REFUND_PROCESSED,
      timestamp: transaction.timestamp,
      data: { transaction, originalTransactionId: transactionId },
    });

    this.emitEvent({
      type: CreditEventType.BALANCE_UPDATED,
      timestamp: transaction.timestamp,
      data: { balance: this.balance },
    });

    return transaction;
  }

  /**
   * Estimate cost for batch operations
   */
  estimateCost(platforms: Platform[]): CostEstimate {
    this.ensureInitialized();

    const estimate = this.tracker.estimateCost(platforms);
    estimate.affordable = this.balance >= estimate.totalCredits;

    if (!estimate.affordable) {
      estimate.creditsNeeded = estimate.totalCredits - this.balance;
    }

    return estimate;
  }

  /**
   * Get available balance (excluding reserved credits)
   */
  getAvailableBalance(): number {
    let reserved = 0;
    this.reservations.forEach((reservation) => {
      if (reservation.active) {
        reserved += reservation.amount;
      }
    });
    return this.balance - reserved;
  }

  /**
   * Check if sufficient credits are available
   */
  hasCredits(amount: number): boolean {
    return this.getAvailableBalance() >= amount;
  }

  /**
   * Check if user can afford a specific operation type
   */
  canAffordOperation(operationType: OperationType): boolean {
    this.ensureInitialized();

    const cost = OPERATION_COSTS[operationType];
    return this.hasCredits(cost);
  }

  /**
   * Get monthly credit allowance for current plan
   */
  getMonthlyAllowance(): number {
    if (!this.license) {
      return PLAN_LIMITS.free; // Default to free plan
    }

    return PLAN_LIMITS[this.license.plan];
  }

  /**
   * Get operation cost
   */
  getOperationCost(operationType: OperationType): number {
    return OPERATION_COSTS[operationType];
  }

  /**
   * Reset monthly credits with rollover logic (subscription only)
   */
  resetMonthlyCredits(): void {
    this.ensureInitialized();

    if (!this.license) {
      throw new Error('No license loaded');
    }

    // Only reset for subscription and free tier licenses
    const licenseType = (this.license as any).licenseType;
    if (licenseType === 'credit_pack') {
      this.logger?.debug('Skipping reset for credit pack license');
      return;
    }

    this.logger?.info('Resetting monthly credits', {
      plan: this.license.plan,
      currentBalance: this.balance,
      licenseType,
    });

    const now = new Date();
    const monthlyAllowance = this.getMonthlyAllowance();

    // Calculate rollover for pro users
    let rollover = 0;
    if (this.license.plan === 'pro' && this.balance > 0) {
      rollover = Math.min(this.balance, MAX_CREDIT_ROLLOVER);
      this.logger?.info('Rolling over credits', {
        available: this.balance,
        rollover,
        max: MAX_CREDIT_ROLLOVER,
      });
    }

    // Reset balance with new allowance + rollover
    const previousBalance = this.balance;
    this.balance = monthlyAllowance + rollover;
    this.rolloverCredits = rollover;
    this.lastResetDate = now;

    // Update license
    if (this.license) {
      this.license.creditsRemaining = this.balance;
      this.license.creditLimit = monthlyAllowance + rollover;
    }

    // Record reset transaction
    const transaction: CreditTransaction = {
      id: this.generateId(),
      type: TransactionType.RESET,
      platform: 'facebook', // Placeholder, reset is not platform-specific
      amount: this.balance - previousBalance,
      timestamp: now.getTime(),
      success: true,
      balanceBefore: previousBalance,
      balanceAfter: this.balance,
    };

    this.tracker.recordTransaction(transaction);

    // Emit event
    this.emitEvent({
      type: CreditEventType.BALANCE_UPDATED,
      timestamp: transaction.timestamp,
      data: {
        balance: this.balance,
        rollover,
        monthlyAllowance,
        resetDate: now.toISOString(),
        licenseType,
      },
    });

    this.logger?.info('Monthly credits reset', {
      newBalance: this.balance,
      rollover,
      monthlyAllowance,
    });
  }

  /**
   * Check if credits need to be reset (subscription only)
   */
  shouldResetCredits(): boolean {
    if (!this.license) {
      return false;
    }

    // Only reset for subscription and free tier licenses
    const licenseType = (this.license as any).licenseType;
    if (licenseType === 'credit_pack') {
      return false; // Credit packs don't reset
    }

    if (!this.lastResetDate) {
      return true; // Never reset before
    }

    const now = new Date();
    const lastReset = this.lastResetDate;

    // Check if we're in a new month
    return (
      now.getFullYear() > lastReset.getFullYear() ||
      (now.getFullYear() === lastReset.getFullYear() && now.getMonth() > lastReset.getMonth())
    );
  }

  /**
   * Check if license is credit pack type
   */
  isCreditPack(): boolean {
    if (!this.license) {
      return false;
    }

    const licenseType = (this.license as any).licenseType;
    return licenseType === 'credit_pack';
  }

  /**
   * Get license type
   */
  getLicenseType(): string {
    if (!this.license) {
      return 'free_tier';
    }

    return (this.license as any).licenseType || 'subscription';
  }

  /**
   * Get last reset date
   */
  getLastResetDate(): Date | undefined {
    return this.lastResetDate;
  }

  /**
   * Get rollover credits from last period
   */
  getRolloverCredits(): number {
    return this.rolloverCredits;
  }

  /**
   * Set promo code validator
   */
  setPromoValidator(validator: PromoCodeValidator): void {
    this.promoValidator = validator;
    this.logger?.debug('PromoCodeValidator set');
  }

  /**
   * Set promo code storage
   */
  setPromoStorage(storage: PromoCodeStorage): void {
    this.promoStorage = storage;
    this.logger?.debug('PromoCodeStorage set');
  }

  /**
   * Apply promotional code
   */
  async applyPromoCode(code: string): Promise<AppliedPromoCode> {
    this.ensureInitialized();

    if (!this.promoValidator) {
      throw new Error('PromoCodeValidator not set');
    }

    if (!this.promoStorage) {
      throw new Error('PromoCodeStorage not set');
    }

    if (!this.license) {
      throw new Error('No license loaded');
    }

    this.logger?.info('Applying promotional code', { code });

    // Validate promo code
    const validation = await this.promoValidator.validatePromoCode(
      code,
      this.license.key,
      undefined // Email is optional
    );

    if (!validation.valid || !validation.promoCode) {
      throw new Error(validation.error || 'Invalid promotional code');
    }

    // Apply the promo code
    const appliedCode = await this.promoValidator.applyPromoCode(
      code,
      this.license.key,
      '' // Email
    );

    // Store the applied code
    await this.promoStorage.storeAppliedCode(appliedCode);

    // Apply benefits based on promo type
    this.applyPromoBenefits(appliedCode);

    this.logger?.info('Promotional code applied successfully', {
      code,
      benefit: appliedCode.benefit,
    });

    // Emit event
    this.emitEvent({
      type: CreditEventType.BALANCE_UPDATED,
      timestamp: Date.now(),
      data: {
        balance: this.balance,
        promoCodeApplied: code,
        benefit: appliedCode.benefit,
      },
    });

    return appliedCode;
  }

  /**
   * Check if a promo code has been applied
   */
  isPromoCodeApplied(code: string): boolean {
    this.ensureInitialized();

    if (!this.promoStorage || !this.license) {
      return false;
    }

    return this.promoStorage.isCodeApplied(code, this.license.key);
  }

  /**
   * Get all applied promo codes
   */
  getAppliedPromoCodes(): AppliedPromoCode[] {
    this.ensureInitialized();

    if (!this.promoStorage || !this.license) {
      return [];
    }

    return this.promoStorage.getAppliedCodes(this.license.key);
  }

  /**
   * Apply benefits from promotional code
   */
  private applyPromoBenefits(appliedCode: AppliedPromoCode): void {
    const { benefit } = appliedCode;

    switch (benefit.type) {
      case PromoCodeType.BONUS_CREDITS:
        // Add bonus credits to balance
        const previousBalance = this.balance;
        this.balance += benefit.amount;

        if (this.license) {
          this.license.creditsRemaining = this.balance;
          this.license.creditLimit += benefit.amount;
        }

        this.logger?.info('Bonus credits applied', {
          amount: benefit.amount,
          newBalance: this.balance,
        });

        // Record transaction
        const transaction: CreditTransaction = {
          id: this.generateId(),
          type: TransactionType.RESET, // Using RESET type for bonus credits
          platform: 'facebook', // Placeholder
          amount: benefit.amount,
          timestamp: Date.now(),
          reference: `promo-${appliedCode.code}`,
          success: true,
          balanceBefore: previousBalance,
          balanceAfter: this.balance,
        };

        this.tracker.recordTransaction(transaction);
        break;

      case PromoCodeType.EXTENDED_TRIAL:
        // Extended trial is handled at the license level
        // This would typically be processed by LicenseValidator
        this.logger?.info('Extended trial applied', {
          days: benefit.amount,
        });
        break;

      case PromoCodeType.PERCENTAGE_DISCOUNT:
      case PromoCodeType.FIXED_DISCOUNT:
        // Discounts are applied during purchase flow
        // No immediate credit changes
        this.logger?.info('Discount code applied (will apply on next purchase)', {
          type: benefit.type,
          amount: benefit.amount,
        });
        break;

      default:
        this.logger?.warn('Unknown promo code type', { type: benefit.type });
    }
  }

  /**
   * Add event listener
   */
  on(eventType: CreditEventType, listener: (event: CreditEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: CreditEventType, listener: (event: CreditEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CreditManager not initialized. Call initialize() first.');
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private checkThresholds(): void {
    if (!this.config.alerts.enabled || !this.license) {
      return;
    }

    const percentage = (this.balance / this.license.creditLimit) * 100;

    for (const threshold of this.config.alerts.thresholds) {
      if (percentage <= threshold && !this.alertedThresholds.has(threshold)) {
        this.triggerAlert(threshold, percentage);
        this.alertedThresholds.add(threshold);
      } else if (percentage > threshold && this.alertedThresholds.has(threshold)) {
        // Reset alert if balance increased above threshold
        this.alertedThresholds.delete(threshold);
      }
    }
  }

  private triggerAlert(threshold: CreditThreshold, percentageRemaining: number): void {
    const alert: CreditAlert = {
      threshold,
      creditsRemaining: this.balance,
      creditLimit: this.license!.creditLimit,
      percentageRemaining,
      timestamp: Date.now(),
      message: this.getAlertMessage(threshold, this.balance),
    };

    this.logger?.warn('Credit threshold alert', {
      threshold,
      creditsRemaining: this.balance,
      percentageRemaining,
    });

    if (this.config.alerts.showNotifications) {
      new Notice(alert.message, 10000);
    }

    this.emitEvent({
      type: CreditEventType.ALERT_TRIGGERED,
      timestamp: alert.timestamp,
      data: { alert },
    });
  }

  private getAlertMessage(threshold: CreditThreshold, balance: number): string {
    switch (threshold) {
      case CreditThreshold.CRITICAL:
        return `⚠️ No credits remaining! You have ${balance} credits left.`;
      case CreditThreshold.LOW:
        return `⚠️ Low credits warning! You have ${balance} credits left (10% remaining).`;
      case CreditThreshold.MEDIUM:
        return `💡 Credits running low. You have ${balance} credits left (20% remaining).`;
      default:
        return `Credit alert: ${balance} credits remaining.`;
    }
  }

  private startReservationCleanup(): void {
    this.reservationCleanupInterval = setInterval(() => {
      this.cleanupExpiredReservations();
    }, 60000); // Clean up every minute
  }

  private cleanupExpiredReservations(): void {
    const now = Date.now();
    let cleaned = 0;

    this.reservations.forEach((reservation, id) => {
      if (now > reservation.expiresAt && reservation.active) {
        reservation.active = false;
        this.reservations.delete(id);
        cleaned++;

        this.logger?.debug('Reservation expired and cleaned', { reservationId: id });

        this.emitEvent({
          type: CreditEventType.RESERVATION_RELEASED,
          timestamp: now,
          data: { reservationId: id, reason: 'expired' },
        });
      }
    });

    if (cleaned > 0) {
      this.logger?.debug(`Cleaned up ${cleaned} expired reservations`);
    }
  }

  private emitEvent(event: CreditEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          this.logger?.error('Event listener error', error instanceof Error ? error : undefined, { eventType: event.type });
        }
      });
    }
  }
}
