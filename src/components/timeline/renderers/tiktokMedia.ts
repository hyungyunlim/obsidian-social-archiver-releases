import type { Media, PostData } from '../../../types/post';
import { isVideoUrl } from '../../../utils/mediaType';

/**
 * Extract a TikTok video id from either a canonical URL or a stored post id.
 * Short URLs cannot be resolved locally, so callers should pass the parsed
 * archive id as a secondary candidate.
 */
export function extractTikTokVideoId(url?: string | null, candidateId?: string | null): string | null {
  const candidates = [candidateId, url];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = candidate.trim();
    if (!value) continue;

    if (/^\d{6,}$/.test(value)) {
      return value;
    }

    const match = value.match(/\/(?:@[^/]+\/)?video\/(\d+)/i)
      || value.match(/(?:data-video-id|video_id)=["']?(\d+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function isTikTokWebPostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
      return true;
    }
    if (host === 'tiktok.com' || host === 'www.tiktok.com' || host === 'm.tiktok.com') {
      return /\/(?:@[^/]+\/)?(?:video|photo)\/\d+/i.test(parsed.pathname);
    }
    return false;
  } catch {
    return /^(?:https?:\/\/)?(?:vm|vt)\.tiktok\.com\//i.test(url)
      || /^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/(?:@[^/]+\/)?(?:video|photo)\/\d+/i.test(url);
  }
}

export function isDirectVideoMedia(media: Media): boolean {
  const url = media.url?.trim();
  if (!url) {
    return false;
  }

  if (isTikTokWebPostUrl(url)) {
    return false;
  }

  return media.type === 'video' || isVideoUrl(url);
}

export function hasDirectTikTokVideoMedia(media: PostData['media'] | undefined): boolean {
  return (media ?? []).some(isDirectVideoMedia);
}
