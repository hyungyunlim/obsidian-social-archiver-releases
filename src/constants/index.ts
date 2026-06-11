export const SUPPORTED_PLATFORMS = {
  FACEBOOK: {
    name: 'Facebook',
    domains: ['facebook.com', 'fb.com'],
    patterns: [/facebook\.com\/(.*?)\/posts\/(.*)/],
    icon: '📘'
  },
  LINKEDIN: {
    name: 'LinkedIn',
    domains: ['linkedin.com'],
    patterns: [/linkedin\.com\/posts\/(.*)/],
    icon: '💼'
  },
  INSTAGRAM: {
    name: 'Instagram',
    domains: ['instagram.com'],
    patterns: [/instagram\.com\/p\/(.*)/],
    icon: '📷'
  },
  TIKTOK: {
    name: 'TikTok',
    domains: ['tiktok.com'],
    patterns: [/tiktok\.com\/@(.*?)\/video\/(.*)/],
    icon: '🎵'
  },
  X: {
    name: 'X (Twitter)',
    domains: ['x.com', 'twitter.com'],
    patterns: [/(?:x|twitter)\.com\/(.*?)\/status\/(.*)/],
    icon: '🐦'
  },
  THREADS: {
    name: 'Threads',
    domains: ['threads.net', 'threads.com'],
    patterns: [/threads\.(?:net|com)\/@(.*?)\/post\/(.*)/],
    icon: '🧵'
  }
} as const;

export const CREDIT_COSTS = {
  BASIC_ARCHIVE: 1,
  WITH_AI: 3,
  DEEP_RESEARCH: 5
} as const;

export const API_ENDPOINTS = {
  BASE_URL: 'https://social-archiver-api.social-archive.org',
  ARCHIVE: '/api/archive',
  JOB_STATUS: '/api/job',
  SHARE: '/api/share',
  VALIDATE_LICENSE: '/api/validate-license'
} as const;

export const FILE_NAME_TOKENS = {
  DATE: '{date}',
  PLATFORM: '{platform}',
  AUTHOR: '{author}',
  SLUG: '{slug}',
  ID: '{id}',
  SHORT_ID: '{shortId}'
} as const;

export const RATE_LIMITS = {
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY: 1000,
  MAX_RETRY_DELAY: 16000,
  TIMEOUT: 30000
} as const;

/**
 * Anonymous (logged-out) mode: the browser extension is the archiving entry
 * point, so every logged-out surface funnels to these two targets.
 * See .taskmaster/docs/prd-plugin-anonymous-local-mode.md (S1).
 */
export const BROWSER_EXTENSION_LINKS = {
  CHROME_WEB_STORE:
    'https://chromewebstore.google.com/detail/social-archiver/gifddgdekeffpnadpdcgjaehmlblomaf',
  GUIDE: 'https://docs.social-archive.org/en/guide/browser-extension'
} as const;
