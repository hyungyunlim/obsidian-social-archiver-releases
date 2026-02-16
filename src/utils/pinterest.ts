import { requestUrl } from 'obsidian';
import { URLExpander } from '@/services/URLExpander';
import { isPinterestBoardUrl } from '@/schemas/platforms';

const PINTEREST_SHORT_DOMAINS = new Set(['pin.it']);
const pinterestExpander = new URLExpander({ requestUrl });

/**
 * Check if URL is a Pinterest short link that needs expansion
 */
export function isPinterestShortLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return PINTEREST_SHORT_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve Pinterest URLs (expands pin.it short links) and detect board URLs
 */
export async function resolvePinterestUrl(url: string): Promise<{
  resolvedUrl: string;
  isBoard: boolean;
  expanded: boolean;
}> {
  let resolvedUrl = url.trim();
  let expanded = false;

  if (isPinterestShortLink(resolvedUrl)) {
    try {
      resolvedUrl = await pinterestExpander.expandUrl(resolvedUrl);
      expanded = resolvedUrl !== url;
    } catch {
      // Keep original URL if expansion fails
      resolvedUrl = url;
    }
  }

  return {
    resolvedUrl,
    isBoard: isPinterestBoardUrl(resolvedUrl),
    expanded,
  };
}
