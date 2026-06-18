/**
 * CliResponse — re-export shim.
 *
 * The canonical implementation now lives in the shared, host-agnostic
 * `@social-archiver/cli-core` package (see docs/specs/desktop-cli-agent-skill-prd.md).
 * This module re-exports it so existing `./CliResponse` imports keep working
 * while there is a single source of truth shared with the desktop CLI.
 */

export {
  ErrorCode,
  RETRYABLE_BY_CODE,
  BILLING_FALLBACK_MESSAGE,
  ok,
  err,
  redact,
  format,
} from '@social-archiver/cli-core';

export type {
  ErrorCodeValue,
  CliResponse,
  CliResponseSuccess,
  CliResponseError,
  OkOptions,
  ErrOptions,
  CliFormat,
} from '@social-archiver/cli-core';
