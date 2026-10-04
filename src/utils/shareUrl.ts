export function toReaderModeShareUrl(shareUrl: string): string {
  if (!shareUrl) return shareUrl;

  try {
    const url = new URL(shareUrl);
    url.hash = 'reader';
    return url.toString();
  } catch {
    const base = shareUrl.split('#')[0];
    return `${base}#reader`;
  }
}

export function getShareUrlForClipboard(shareUrl: string, copyReaderModeLink: boolean): string {
  return copyReaderModeLink ? toReaderModeShareUrl(shareUrl) : shareUrl;
}

/** `https://social-archive.org/{user}/{shareId}` (optionally with `#reader`) → shareId. */
export function shareIdFromUrl(shareUrl: string): string | null {
  try {
    const segments = new URL(shareUrl).pathname.split('/').filter(Boolean);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}
