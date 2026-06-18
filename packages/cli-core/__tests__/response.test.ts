import { describe, it, expect } from 'vitest';
import {
  BILLING_FALLBACK_MESSAGE,
  ErrorCode,
  RETRYABLE_BY_CODE,
  err,
  format,
  ok,
  redact,
} from '../src/core/response';

describe('CliResponse envelope', () => {
  it('builds a success envelope', () => {
    const r = ok('social-archiver:archive', '1.2.3', { jobId: 'j1' });
    expect(r).toMatchObject({ ok: true, command: 'social-archiver:archive', version: '1.2.3', data: { jobId: 'j1' } });
    expect('warnings' in r).toBe(false);
  });

  it('attaches warnings only when non-empty', () => {
    expect(ok('c', '1', {}, { warnings: [] })).not.toHaveProperty('warnings');
    expect(ok('c', '1', {}, { warnings: ['w'] }).warnings).toEqual(['w']);
  });

  it('maps retryable from the code table', () => {
    expect(err('c', '1', ErrorCode.RATE_LIMITED, 'slow').error.retryable).toBe(true);
    expect(err('c', '1', ErrorCode.AUTH_REQUIRED, 'login').error.retryable).toBe(false);
    expect(RETRYABLE_BY_CODE[ErrorCode.NETWORK_ERROR]).toBe(true);
  });

  it('honors a retryable override and unknown codes default to false', () => {
    expect(err('c', '1', ErrorCode.OPERATION_FAILED, 'x', { retryable: true }).error.retryable).toBe(true);
    expect(err('c', '1', 'SOME_FUTURE_CODE', 'x').error.retryable).toBe(false);
  });

  it('truncates very long messages', () => {
    const long = 'a'.repeat(800);
    expect(err('c', '1', ErrorCode.OPERATION_FAILED, long).error.message.length).toBeLessThanOrEqual(500);
  });
});

describe('redaction', () => {
  it('redacts sensitive keys but not innocent lookalikes', () => {
    const out = redact({
      authToken: 'abc',
      accessToken: 'def',
      password: 'p',
      authenticated: true,
      tokenizer: 'safe',
      nested: { apiKey: 'k', note: 'fine' },
    }) as Record<string, unknown>;
    expect(out.authToken).toBe('[REDACTED]');
    expect(out.accessToken).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.authenticated).toBe(true);
    expect(out.tokenizer).toBe('safe');
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).note).toBe('fine');
  });

  it('redacts JWT-shaped strings inside values', () => {
    const out = redact({ note: 'jwt abcdefgh.ijklmnop.qrstuvwx here' }) as Record<string, string>;
    expect(out.note).toContain('[REDACTED]');
    expect(out.note).not.toContain('ijklmnop');
  });

  it('handles circular references without throwing', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });

  it('does not redact long opaque non-secret ids (jobId round-trips)', () => {
    // Real shape from AICommentJobService: `aicj_${crypto.randomUUID()}` (41 chars,
    // long enough to be caught by the opaque-token catch-all).
    const jobId = 'aicj_0f9d4c2a-7b1e-4f3a-9c8d-2e5a6b7c8d9e';
    const out = redact({ data: { jobId } }) as { data: { jobId: string } };
    expect(out.data.jobId).toBe(jobId);

    // Other documented safe id keys also survive intact.
    const ids = redact({
      id: 'Et4GOQVVKR',
      archiveId: '8f14e45fceea167a5a36dedd4bea2543abc1234567890def',
      clientId: 'c1d2e3f4-a5b6-7890-abcd-ef0123456789',
      // base64 pagination cursor — shape-identical to a secret, spared by key.
      nextCursor: 'eyJpZCI6IjEyMzQ1Njc4OTAiLCJ0cyI6MTcxMjM0NTY3OH0=',
    }) as Record<string, string>;
    expect(ids.id).toBe('Et4GOQVVKR');
    expect(ids.archiveId).toBe('8f14e45fceea167a5a36dedd4bea2543abc1234567890def');
    expect(ids.clientId).toBe('c1d2e3f4-a5b6-7890-abcd-ef0123456789');
    expect(ids.nextCursor).toBe('eyJpZCI6IjEyMzQ1Njc4OTAiLCJ0cyI6MTcxMjM0NTY3OH0=');
  });

  it('still redacts real secrets (Bearer / JWT / sk- / base64 under unknown keys)', () => {
    const out = redact({
      header: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
      token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dumm1Sign4tureValueAbcDef',
      providerKey: 'sk-proj-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz',
      // Same base64 cursor as above, but under an UNRECOGNIZED key → still scrubbed.
      blob: 'eyJpZCI6IjEyMzQ1Njc4OTAiLCJ0cyI6MTcxMjM0NTY3OH0=',
    }) as Record<string, string>;
    expect(out.header).toBe('Authorization: Bearer [REDACTED]');
    // `token` is a sensitive key → value-level key redaction.
    expect(out.token).toBe('[REDACTED]');
    expect(out.providerKey).toBe('[REDACTED]');
    expect(out.providerKey).not.toContain('sk-proj');
    expect(out.blob).toContain('[REDACTED]');
    expect(out.blob).not.toContain('eyJpZCI');
  });

  it('redacts a JWT even when it is the bare value of a non-safe key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.S1gn4tur3Value0123456789';
    const out = redact({ note: jwt }) as Record<string, string>;
    expect(out.note).toBe('[REDACTED]');
  });
});

describe('formatting', () => {
  it('renders json with a redaction safety net', () => {
    const json = format(err('c', '1', ErrorCode.OPERATION_FAILED, 'boom', { details: { authToken: 'secret' } }));
    const parsed = JSON.parse(json);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.details.authToken).toBe('[REDACTED]');
  });

  it('renders compact text lines', () => {
    expect(format(ok('cmd', '1', { jobId: 'j1', status: 'queued' }), 'text')).toBe('OK cmd: jobId=j1 status=queued');
    expect(format(err('cmd', '1', ErrorCode.RATE_LIMITED, 'slow down'), 'text')).toBe('ERR cmd RATE_LIMITED: slow down');
  });

  it('exposes the shared billing fallback message', () => {
    expect(BILLING_FALLBACK_MESSAGE).toContain('credits');
  });
});
