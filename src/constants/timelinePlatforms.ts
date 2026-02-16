export const TIMELINE_PLATFORM_IDS = [
  'post',
  'facebook',
  'linkedin',
  'instagram',
  'tiktok',
  'x',
  'threads',
  'youtube',
  'reddit',
  'pinterest',
  'substack',
  'tumblr',
  'mastodon',
  'bluesky',
  'googlemaps',
  'velog',
  'medium',
  'podcast',
  'blog',
  'naver',
  'naver-webtoon',
  'brunch'
] as const;

/**
 * Platform groups for unified filtering
 * When filtering by 'naver-webtoon', also include 'webtoons' platform
 */
export const PLATFORM_FILTER_GROUPS: Record<string, string[]> = {
  'naver-webtoon': ['naver-webtoon', 'webtoons'],
};

export type TimelinePlatformId = typeof TIMELINE_PLATFORM_IDS[number];

export const TIMELINE_PLATFORM_LABELS: Record<TimelinePlatformId, string> = {
  post: 'Post',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  threads: 'Threads',
  youtube: 'YouTube',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  substack: 'Substack',
  tumblr: 'Tumblr',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  googlemaps: 'Google Maps',
  velog: 'Velog',
  medium: 'Medium',
  podcast: 'Podcast',
  blog: 'Blog',
  naver: 'Naver',
  'naver-webtoon': 'Webtoon',
  brunch: 'Brunch'
};
