/**
 * Settings-surface strings: key prefix "xpost.".
 * Populated by the i18n extraction pass — every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const crossPostStrings = {
  'xpost.tokenExpiry.expired': { en: '{date} (expired)', ko: '{date} (만료됨)' },
  'xpost.tokenExpiry.oneDay': { en: '{date} (1 day remaining)', ko: '{date} (1일 남음)' },
  'xpost.tokenExpiry.days': { en: '{date} ({days} days remaining)', ko: '{date} ({days}일 남음)' },
  'xpost.error.loginFirst': {
    en: 'Please log in to Social Archiver first. Go to the Authentication section above to sign in.',
    ko: 'Social Archiver에 먼저 로그인해 주세요. 위의 인증 섹션에서 로그인할 수 있습니다.',
  },
  'xpost.error.startAuthFailed': {
    en: 'Failed to start authentication. Please try again.',
    ko: '인증을 시작하지 못했습니다. 다시 시도해 주세요.',
  },
  'xpost.error.unknown': { en: 'Unknown error', ko: '알 수 없는 오류' },
  'xpost.error.startAuthFailedWithMessage': {
    en: 'Failed to start authentication: {message}',
    ko: '인증을 시작하지 못했습니다: {message}',
  },
  'xpost.error.disconnectFailed': {
    en: 'Failed to disconnect: {message}',
    ko: '연결 해제에 실패했습니다: {message}',
  },
  'xpost.error.refreshTokenFailed': {
    en: 'Failed to refresh token: {message}',
    ko: '토큰 갱신에 실패했습니다: {message}',
  },
  'xpost.confirmDisconnect.title': {
    en: 'Disconnect Threads account?',
    ko: 'Threads 계정 연결을 해제할까요?',
  },
  'xpost.confirmDisconnect.message': {
    en: 'You will need to re-authorize to cross-post again.',
    ko: '다시 크로스 포스트하려면 재인증이 필요합니다.',
  },
  'xpost.disconnect': { en: 'Disconnect', ko: '연결 해제' },
  'xpost.cancel': { en: 'Cancel', ko: '취소' },
  'xpost.error.timeout': {
    en: 'Connection timed out. Please try again.',
    ko: '연결 시간이 초과되었습니다. 다시 시도해 주세요.',
  },
  'xpost.checkingStatus': { en: 'Checking connection status...', ko: '연결 상태를 확인하는 중...' },
  'xpost.connected': { en: 'Connected', ko: '연결됨' },
  'xpost.tokenExpiresLabel': { en: 'Token expires:', ko: '토큰 만료일:' },
  'xpost.tokenExpiredNotice': {
    en: 'Token has expired or is invalid. Refresh to continue posting.',
    ko: '토큰이 만료되었거나 유효하지 않습니다. 계속 게시하려면 토큰을 갱신해 주세요.',
  },
  'xpost.refreshTokenAria': { en: 'Refresh Threads token', ko: 'Threads 토큰 갱신' },
  'xpost.refreshing': { en: 'Refreshing...', ko: '갱신 중...' },
  'xpost.refreshToken': { en: 'Refresh Token', ko: '토큰 갱신' },
  'xpost.disconnectAria': { en: 'Disconnect Threads account', ko: 'Threads 계정 연결 해제' },
  'xpost.disconnecting': { en: 'Disconnecting...', ko: '연결 해제 중...' },
  'xpost.notConnected': { en: 'Not connected', ko: '연결되지 않음' },
  'xpost.waitingForAuth': {
    en: 'Waiting for authorization in your browser...',
    ko: '브라우저에서 인증을 기다리는 중...',
  },
  'xpost.cancelAuthAria': { en: 'Cancel Threads authorization', ko: 'Threads 인증 취소' },
  'xpost.connectAria': { en: 'Connect Threads account', ko: 'Threads 계정 연결' },
  'xpost.starting': { en: 'Starting...', ko: '시작하는 중...' },
  'xpost.connectAccount': { en: 'Connect Threads Account', ko: 'Threads 계정 연결' },
  'xpost.retryAria': {
    en: 'Retry Threads connection status check',
    ko: 'Threads 연결 상태 확인 다시 시도',
  },
  'xpost.checking': { en: 'Checking...', ko: '확인 중...' },
  'xpost.retry': { en: 'Retry', ko: '다시 시도' },
  'xpost.comingSoon': { en: 'Coming soon', ko: '출시 예정' },
  'xpost.comingSoonText': {
    en: 'X (Twitter) cross-posting will be available in a future update.',
    ko: 'X (Twitter) 크로스 포스트는 향후 업데이트에서 제공될 예정입니다.',
  },
} satisfies Record<string, LocaleText>;
