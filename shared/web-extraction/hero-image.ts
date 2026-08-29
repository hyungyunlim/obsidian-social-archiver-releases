/**
 * Hero images that are the site's furniture, not the post's picture.
 *
 * The hero comes from `og:image`, which on an article is the lead photo and on
 * most boards is the post's first attachment — checked on clien, ruliweb,
 * inven, nate pann and donga, all of which point at the real thing. Blind is
 * the exception: every post advertises the same promo card, so an archive of a
 * text-only Blind post opened in the reader shows a full-width Blind ad where
 * the picture should be.
 *
 * Host-keyed and deliberately narrow. Dropping a hero is not free — it is the
 * card thumbnail as well — so this only names images a site serves on every
 * post regardless of content. Anything not listed is kept.
 */

/** Page host → images from that page that are boilerplate, never content. */
const BOILERPLATE_HERO_IMAGES: Record<string, RegExp> = {
  // `static.teamblind.com` is the app's asset host: channel logos, branding,
  // and the two share cards (`img/web/share_topic.png` for the Korean site,
  // `img/www/team-blind-share.png` for the US one). A post's own attachments
  // are served from `opt-image.teamblind.com/uploads/`, so they are unaffected.
  'teamblind.com': /^https?:\/\/static\.teamblind\.com\//i,
};

/**
 * True when `imageUrl` is `pageUrl`'s site furniture rather than its content.
 *
 * Never throws on a malformed URL — an unparseable page URL simply matches
 * nothing and the image is kept.
 */
export function isBoilerplateHeroImage(imageUrl: string, pageUrl: string): boolean {
  if (!imageUrl) return false;

  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  for (const [site, pattern] of Object.entries(BOILERPLATE_HERO_IMAGES)) {
    if (host === site || host.endsWith(`.${site}`)) return pattern.test(imageUrl);
  }
  return false;
}
