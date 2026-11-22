import type { ThreadsConnectionStatus } from '@/types/crosspost';
import {
  AuthenticationError,
  NetworkError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from '@/types/errors/http-errors';

export type ThreadsConnectionIssueKind =
  | 'api_unreachable'
  | 'auth_expired'
  | 'not_connected'
  | 'rate_limited'
  | 'server_error'
  | 'token_expired'
  | 'token_error'
  | 'unknown';

export interface ThreadsConnectionIssue {
  kind: ThreadsConnectionIssueKind;
  message: string;
}

const SETTINGS_HINT = 'Settings > Cross-Post';

/**
 * Whether the server can reach the Threads API at all (posting, connect, delete).
 * Only an explicit `false` turns it off, so servers that predate the field keep working.
 * Archiving Threads posts by link does not use the API and is unaffected.
 */
export function isThreadsApiAvailable(status: Pick<ThreadsConnectionStatus, 'apiAvailable'>): boolean {
  return status.apiAvailable !== false;
}

export function isThreadsConnectionUsable(status: ThreadsConnectionStatus): boolean {
  return (
    isThreadsApiAvailable(status) &&
    status.connected &&
    status.status !== 'disconnected' &&
    status.status !== 'revoked' &&
    status.status !== 'error' &&
    status.tokenStatus !== 'expired' &&
    status.tokenStatus !== 'error'
  );
}

export function getThreadsConnectionIssueFromStatus(
  status: ThreadsConnectionStatus,
  options: { crossPostEnabled?: boolean } = {}
): ThreadsConnectionIssue | null {
  // Nothing to fix on the user's side: the Threads options are simply hidden.
  if (!isThreadsApiAvailable(status)) {
    return null;
  }

  if (status.connected && (status.status === 'disconnected' || status.status === 'revoked')) {
    return {
      kind: 'not_connected',
      message: `Threads is no longer connected. Reconnect it in ${SETTINGS_HINT} before cross-posting.`,
    };
  }

  if (status.connected && status.status === 'error') {
    return {
      kind: 'token_error',
      message: `Threads connection needs attention. Reconnect it in ${SETTINGS_HINT} before cross-posting.`,
    };
  }

  if (status.connected && status.tokenStatus === 'expired') {
    return {
      kind: 'token_expired',
      message: `Threads connection expired. Refresh the Threads token in ${SETTINGS_HINT} before cross-posting.`,
    };
  }

  if (status.connected && status.tokenStatus === 'error') {
    return {
      kind: 'token_error',
      message: `Threads connection needs attention. Refresh the Threads token in ${SETTINGS_HINT} before cross-posting.`,
    };
  }

  if (!status.connected && options.crossPostEnabled) {
    return {
      kind: 'not_connected',
      message: `Threads cross-posting is enabled, but Threads is not connected. Connect it in ${SETTINGS_HINT}.`,
    };
  }

  return null;
}

export function getThreadsConnectionIssueFromError(
  error: unknown,
  endpoint?: string
): ThreadsConnectionIssue {
  if (error instanceof AuthenticationError) {
    return {
      kind: 'auth_expired',
      message: `Your Social Archiver session has expired. Sign in again, then reconnect Threads in ${SETTINGS_HINT}.`,
    };
  }

  if (error instanceof RateLimitError) {
    return {
      kind: 'rate_limited',
      message: `Social Archiver is rate limiting Threads status checks. Try again from ${SETTINGS_HINT} in a moment.`,
    };
  }

  if (error instanceof ServerError) {
    return {
      kind: 'server_error',
      message: `Social Archiver could not check Threads status right now. Try again from ${SETTINGS_HINT}.`,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  if (
    error instanceof NetworkError ||
    error instanceof TimeoutError ||
    /ERR_CONNECTION_REFUSED|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|Network request failed/i.test(rawMessage)
  ) {
    const endpointText = endpoint ? ` at ${endpoint}` : '';
    return {
      kind: 'api_unreachable',
      message: `Cannot reach Social Archiver API${endpointText}. Threads status could not be checked, so cross-posting is paused.`,
    };
  }

  return {
    kind: 'unknown',
    message: `Threads status could not be checked. Try again from ${SETTINGS_HINT}.`,
  };
}
