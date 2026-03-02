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
