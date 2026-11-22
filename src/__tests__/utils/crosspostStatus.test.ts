import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  NetworkError,
} from '@/types/errors/http-errors';
import {
  getThreadsConnectionIssueFromError,
  getThreadsConnectionIssueFromStatus,
  isThreadsApiAvailable,
  isThreadsConnectionUsable,
} from '@/utils/crosspostStatus';

describe('crosspostStatus utilities', () => {
  it('treats expired Threads tokens as unusable and user-facing', () => {
    const status = {
      connected: true,
      username: 'alice',
      tokenStatus: 'expired' as const,
    };

    expect(isThreadsConnectionUsable(status)).toBe(false);
    expect(getThreadsConnectionIssueFromStatus(status)?.message).toContain('Refresh the Threads token');
  });

  it('treats revoked Threads connections as disconnected even when a row exists', () => {
    const status = {
      connected: true,
      username: 'alice',
      status: 'revoked' as const,
      tokenStatus: 'valid' as const,
    };

    expect(isThreadsConnectionUsable(status)).toBe(false);
    expect(getThreadsConnectionIssueFromStatus(status)?.message).toContain('no longer connected');
  });

  it('surfaces disconnected status only when cross-posting was enabled', () => {
    const status = { connected: false };

    expect(getThreadsConnectionIssueFromStatus(status)).toBeNull();
    expect(getThreadsConnectionIssueFromStatus(status, { crossPostEnabled: true })?.message)
      .toContain('Threads cross-posting is enabled');
  });

  it('maps app authentication failures to a sign-in message', () => {
    const issue = getThreadsConnectionIssueFromError(
      new AuthenticationError('Unauthorized', 401),
      'https://api.example.com'
    );

    expect(issue.kind).toBe('auth_expired');
    expect(issue.message).toContain('Sign in again');
  });

  it('maps connection failures to an API reachability message with endpoint context', () => {
    const issue = getThreadsConnectionIssueFromError(
      new NetworkError('Network request failed: net::ERR_CONNECTION_REFUSED'),
      'http://localhost:8787'
    );

    expect(issue.kind).toBe('api_unreachable');
    expect(issue.message).toContain('http://localhost:8787');
    expect(issue.message).toContain('cross-posting is paused');
  });

  describe('Threads API availability (server kill switch)', () => {
    it('treats only an explicit apiAvailable: false as unavailable', () => {
      expect(isThreadsApiAvailable({ apiAvailable: false })).toBe(false);
      expect(isThreadsApiAvailable({ apiAvailable: true })).toBe(true);
      // Servers from before the field: keep every Threads feature.
      expect(isThreadsApiAvailable({})).toBe(true);
    });

    it('never treats a connection as usable while the API is unavailable', () => {
      const status = {
        connected: true,
        apiAvailable: false,
        username: 'alice',
        tokenStatus: 'valid' as const,
      };

      expect(isThreadsConnectionUsable(status)).toBe(false);
      expect(isThreadsConnectionUsable({ ...status, apiAvailable: true })).toBe(true);
      expect(isThreadsConnectionUsable({ connected: true, username: 'alice' })).toBe(true);
    });

    it('raises no reconnect issue while the API is unavailable, even with cross-posting enabled', () => {
      // What the server answers today: { success: true, connected: false, apiAvailable: false }.
      const status = { connected: false, apiAvailable: false };

      expect(getThreadsConnectionIssueFromStatus(status, { crossPostEnabled: true })).toBeNull();
      expect(
        getThreadsConnectionIssueFromStatus(
          { connected: true, apiAvailable: false, tokenStatus: 'expired' as const },
          { crossPostEnabled: true }
        )
      ).toBeNull();
    });
  });
});
