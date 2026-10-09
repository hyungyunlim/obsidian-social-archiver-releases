/**
 * Substack and Tumblr author URLs on the app hosts (substack.com/@handle,
 * www.tumblr.com/blog) carry no feed: each feed lives on the publication's or
 * blog's own subdomain. This rewrites such a URL to that subdomain, the form
 * the RSS feed, handle and base-URL helpers expect.
 *
 * A Substack handle cannot be mapped offline: some writers publish under
 * another subdomain, and {handle}.substack.com then answers with their profile
 * page instead of a feed. The server asks Substack; the handle is only the
 * fallback when that lookup fails.
 */
export async function resolveRssAuthorUrl(
  authorUrl: string,
  discoverFeedUrl: (sourceUrl: string) => Promise<string | null>,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(authorUrl);
  } catch {
    return authorUrl;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'tumblr.com') {
    const blog = parts[0] === 'blog' && parts[1] === 'view' ? parts[2] : parts[0];
    return blog ? `https://${blog.toLowerCase()}.tumblr.com` : authorUrl;
  }

  const handle = host === 'substack.com' && parts[0]?.startsWith('@') ? parts[0].slice(1) : null;
  if (handle) {
    const feedUrl = await discoverFeedUrl(authorUrl).catch(() => null);
    if (feedUrl) {
      try {
        return new URL(feedUrl).origin;
      } catch {
        // fall through to the handle guess
      }
    }
    return `https://${handle.toLowerCase()}.substack.com`;
  }

  return authorUrl;
}
