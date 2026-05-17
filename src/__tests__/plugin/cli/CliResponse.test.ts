import { describe, expect, it } from 'vitest';
import {
  BILLING_FALLBACK_MESSAGE,
  ErrorCode,
  RETRYABLE_BY_CODE,
  err,
  format,
  ok,
  redact,
} from '@/plugin/cli/CliResponse';

const COMMAND = 'social-archiver';
const VERSION = '3.6.2';

describe('CliResponse', () => {
  describe('ok()', () => {
    it('builds a success envelope with required fields', () => {
      const envelope = ok(COMMAND, VERSION, { jobId: 'job-1' });
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe(COMMAND);
      expect(envelope.version).toBe(VERSION);
      expect(envelope.data).toEqual({ jobId: 'job-1' });
      expect(envelope.warnings).toBeUndefined();
    });

    it('attaches warnings when present', () => {
      const envelope = ok(COMMAND, VERSION, {}, { warnings: ['watch out'] });
      expect(envelope.warnings).toEqual(['watch out']);
    });

    it('omits empty warnings arrays', () => {
      const envelope = ok(COMMAND, VERSION, {}, { warnings: [] });
      expect(envelope.warnings).toBeUndefined();
    });
  });

  describe('err()', () => {
    it('builds an error envelope and maps retryable from code table', () => {
      const envelope = err(COMMAND, VERSION, ErrorCode.NETWORK_ERROR, 'boom');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(envelope.error.retryable).toBe(true);
    });

    it('honors explicit retryable override', () => {
      const envelope = err(COMMAND, VERSION, ErrorCode.OPERATION_FAILED, 'x', {
        retryable: true,
      });
      expect(envelope.error.retryable).toBe(true);
    });

    it('redacts details before storing them', () => {
      const envelope = err(COMMAND, VERSION, ErrorCode.AUTH_REQUIRED, 'no auth', {
        details: { authToken: 'abc123', cookie: 'x=y' },
      });
      expect(envelope.error.details).toEqual({
        authToken: '[REDACTED]',
        cookie: '[REDACTED]',
      });
    });

    it('truncates very long messages', () => {
      const long = 'A'.repeat(2000);
      const envelope = err(COMMAND, VERSION, ErrorCode.OPERATION_FAILED, long);
      expect(envelope.error.message.length).toBeLessThanOrEqual(500);
    });
  });

  describe('RETRYABLE_BY_CODE coverage', () => {
    const cases: Array<[string, boolean]> = [
      [ErrorCode.CLI_UNAVAILABLE, false],
      [ErrorCode.AUTH_REQUIRED, false],
      [ErrorCode.INVALID_ARGUMENT, false],
      [ErrorCode.UNSUPPORTED_PLATFORM, false],
      [ErrorCode.SERVICE_NOT_READY, true],
      [ErrorCode.PAYWALL_REQUIRED, false],
      [ErrorCode.INSUFFICIENT_CREDITS, false],
      [ErrorCode.RATE_LIMITED, true],
      [ErrorCode.JOB_NOT_FOUND, false],
      [ErrorCode.NETWORK_ERROR, true],
      [ErrorCode.TIMEOUT_ERROR, true],
      [ErrorCode.CIRCUIT_OPEN, true],
      [ErrorCode.DOC_ID_STALE, true],
      [ErrorCode.OPERATION_FAILED, false],
    ];
    it.each(cases)('code %s → retryable=%s', (code, expected) => {
      const envelope = err(COMMAND, VERSION, code, 'x');
      expect(envelope.error.retryable).toBe(expected);
      expect((RETRYABLE_BY_CODE as Record<string, boolean>)[code]).toBe(expected);
    });
  });

  describe('redact()', () => {
    it('strips sensitive keys at every nesting level', () => {
      const input = {
        outer: 'safe',
        authToken: 'should-disappear',
        nested: {
          cookie: 'session=abc',
          deeper: {
            naverCookie: 'NID=xxx',
            Authorization: 'Bearer secret',
          },
        },
      };
      const out = redact(input) as Record<string, unknown>;
      expect(out.outer).toBe('safe');
      expect(out.authToken).toBe('[REDACTED]');
      const nested = out.nested as Record<string, unknown>;
      expect(nested.cookie).toBe('[REDACTED]');
      const deeper = nested.deeper as Record<string, unknown>;
      expect(deeper.naverCookie).toBe('[REDACTED]');
      expect(deeper.Authorization).toBe('[REDACTED]');
    });

    it('redacts JWT-like strings inside values', () => {
      const out = redact({
        note: 'token=aaaaaaaa.bbbbbbbb.cccccccc remains',
      }) as Record<string, string>;
      expect(out.note).toContain('[REDACTED]');
      expect(out.note).not.toContain('aaaaaaaa.bbbbbbbb.cccccccc');
    });

    it('redacts Bearer authorization values', () => {
      const out = redact({ note: 'Bearer abcdef123456' }) as Record<string, string>;
      expect(out.note).toBe('Bearer [REDACTED]');
    });

    it('collapses absolute user-home paths in messages', () => {
      const out = redact({
        note: 'failed reading /Users/alice/vault/secret.md',
      }) as Record<string, string>;
      expect(out.note).not.toContain('/Users/alice');
      expect(out.note).toContain('<absolute>');
    });

    it('handles circular references safely', () => {
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;
      expect(() => redact(a)).not.toThrow();
    });

    it('does not mutate the input', () => {
      const input = { authToken: 'abc' };
      redact(input);
      expect(input.authToken).toBe('abc');
    });
  });

  describe('format()', () => {
    it('JSON mode is valid JSON and includes the envelope', () => {
      const envelope = ok(COMMAND, VERSION, { jobId: 'job-1' });
      const out = format(envelope, 'json');
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.jobId).toBe('job-1');
    });

    it('text mode summarizes success in <=200 chars', () => {
      const envelope = ok(COMMAND, VERSION, { jobId: 'job-1', status: 'pending' });
      const out = format(envelope, 'text');
      expect(out.length).toBeLessThanOrEqual(200);
      expect(out.startsWith('OK')).toBe(true);
      expect(out).toContain('jobId=job-1');
    });

    it('text mode summarizes errors with code and message', () => {
      const envelope = err(COMMAND, VERSION, ErrorCode.PAYWALL_REQUIRED, 'no quota');
      const out = format(envelope, 'text');
      expect(out.startsWith('ERR')).toBe(true);
      expect(out).toContain(ErrorCode.PAYWALL_REQUIRED);
    });
  });

  describe('billing fallback message', () => {
    it('is exported as a stable constant', () => {
      expect(BILLING_FALLBACK_MESSAGE.length).toBeGreaterThan(20);
      expect(BILLING_FALLBACK_MESSAGE.toLowerCase()).toContain('mobile app');
    });
  });
});
