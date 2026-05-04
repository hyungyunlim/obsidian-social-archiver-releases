import { describe, expect, it } from 'vitest';
import {
  formatRateLimitMessage,
  formatRetryAfter,
  getRateLimitDetails,
  isRateLimitError,
  isUpgradePromptScope,
  RATE_LIMIT_ERROR_CODE,
} from '@/utils/rateLimitError';

describe('rateLimitError utilities', () => {
  it('detects RATE_LIMIT_EXCEEDED by error code', () => {
    const error = Object.assign(new Error('Too many requests'), {
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
      details: {
        retryAfter: 45,
        scope: 'archive_create_rpm',
        tier: 'free',
        effectiveTier: 'free',
        limit: 5,
        remaining: 0,
        resetAt: 1777723260,
      },
    });

    expect(isRateLimitError(error)).toBe(true);
    expect(getRateLimitDetails(error)).toMatchObject({
      retryAfter: 45,
      scope: 'archive_create_rpm',
      tier: 'free',
      effectiveTier: 'free',
      limit: 5,
      remaining: 0,
      resetAt: 1777723260,
    });
  });

  it('detects RATE_LIMIT_EXCEEDED through nested apiError and cause', () => {
    const cause = {
      apiError: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        details: { retryAfter: 60, scope: 'archive_create_burst', tier: 'pro' },
      },
    };
    const wrapped = new Error('Archive failed');
    wrapped.cause = cause;

    expect(isRateLimitError(wrapped)).toBe(true);
    expect(getRateLimitDetails(wrapped)).toMatchObject({
      retryAfter: 60,
      scope: 'archive_create_burst',
      tier: 'pro',
    });
  });

  it('does not classify PAYWALL_REQUIRED errors as rate-limit', () => {
    const error = Object.assign(new Error('Monthly archive limit reached'), {
      code: 'PAYWALL_REQUIRED',
      status: 402,
      details: { used: 10, limit: 10 },
    });
    expect(isRateLimitError(error)).toBe(false);
  });

  it('does not classify INSUFFICIENT_CREDITS errors as rate-limit', () => {
    const error = Object.assign(new Error('Insufficient credits'), {
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
    });
    expect(isRateLimitError(error)).toBe(false);
  });

  it('falls back to top-level retryAfter when details blob is missing', () => {
    const error = {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'rate limited',
      retryAfter: 30,
    };
    expect(isRateLimitError(error)).toBe(true);
    expect(getRateLimitDetails(error)).toMatchObject({ retryAfter: 30 });
  });

  describe('isUpgradePromptScope', () => {
    it('returns true only for archive_create_rpm and archive_concurrent_jobs', () => {
      expect(isUpgradePromptScope('archive_create_rpm')).toBe(true);
      expect(isUpgradePromptScope('archive_concurrent_jobs')).toBe(true);
      expect(isUpgradePromptScope('archive_create_burst')).toBe(false);
      expect(isUpgradePromptScope('archive_polling_rpm')).toBe(false);
      expect(isUpgradePromptScope('ip_hourly_floor')).toBe(false);
      expect(isUpgradePromptScope(undefined)).toBe(false);
    });
  });

  describe('formatRetryAfter', () => {
    it('formats seconds, minutes, hours', () => {
      expect(formatRetryAfter(30)).toBe('30s');
      expect(formatRetryAfter(60)).toBe('1 minute');
      expect(formatRetryAfter(120)).toBe('2 minutes');
      expect(formatRetryAfter(3600)).toBe('1 hour');
    });

    it('falls back when retryAfter is missing or invalid', () => {
      expect(formatRetryAfter(undefined)).toBe('a moment');
      expect(formatRetryAfter(0)).toBe('a moment');
      expect(formatRetryAfter(-10)).toBe('a moment');
    });
  });

  describe('formatRateLimitMessage', () => {
    it('mentions Pro license for free tier on archive_create_rpm', () => {
      const error = Object.assign(new Error('Too many requests'), {
        code: 'RATE_LIMIT_EXCEEDED',
        details: { retryAfter: 45, scope: 'archive_create_rpm', tier: 'free' },
      });
      const msg = formatRateLimitMessage(error);
      expect(msg).toContain('Pro license');
      expect(msg).toContain('45s');
    });

    it('mentions Pro license for free tier on archive_concurrent_jobs', () => {
      const error = Object.assign(new Error('Too many concurrent jobs'), {
        code: 'RATE_LIMIT_EXCEEDED',
        details: { retryAfter: 60, scope: 'archive_concurrent_jobs', tier: 'free' },
      });
      expect(formatRateLimitMessage(error)).toContain('Pro license');
    });

    it('uses neutral copy for free tier on burst/polling/floor scopes', () => {
      for (const scope of [
        'archive_create_burst',
        'archive_polling_rpm',
        'ip_hourly_floor',
        'target_hourly_floor',
        'platform_global_floor',
      ]) {
        const error = Object.assign(new Error('Too many requests'), {
          code: 'RATE_LIMIT_EXCEEDED',
          details: { retryAfter: 30, scope, tier: 'free' },
        });
        const msg = formatRateLimitMessage(error);
        expect(msg).not.toContain('Pro license');
        expect(msg).toContain('Too many requests');
      }
    });

    it('uses neutral copy for paid tier even on archive_create_rpm', () => {
      const error = Object.assign(new Error('Too many requests'), {
        code: 'RATE_LIMIT_EXCEEDED',
        details: { retryAfter: 30, scope: 'archive_create_rpm', tier: 'pro', effectiveTier: 'pro' },
      });
      const msg = formatRateLimitMessage(error);
      expect(msg).not.toContain('Pro license');
    });
  });

  it('exposes the canonical error code constant', () => {
    expect(RATE_LIMIT_ERROR_CODE).toBe('RATE_LIMIT_EXCEEDED');
  });
});
