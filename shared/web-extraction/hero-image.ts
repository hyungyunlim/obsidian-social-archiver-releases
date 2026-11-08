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
  // An article without its own og:image falls back to the site's share card,
  // `assets.joongang.co.kr/images/share/ja-opengraph-img.png` (a "The
  // JoongAng" wordmark, 2026-11-06). `assets.` is the site's asset host;
  // article photos come from `pds.joongang.co.kr`.
  'joongang.co.kr': /^https?:\/\/assets\.joongang\.co\.kr\//i,
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

/**
 * True when two image URLs name the same photo, possibly at another crop or
 * size: same host, same file name, query ignored.
 *
 * Image CDNs put crop and size in the path, so the og:image and the article's
 * own copy differ while the photo does not. The New Yorker (2026-11-05):
 * `/photos/<id>/16:9/w_1280,c_limit/<file>.jpg` as og:image,
 * `/photos/<id>/2:2/w_2560%2Cc_limit/<file>.jpg` in the body.
 *
 * ponytail: file-name match. Two different photos sharing a name on one host
 * (`image.jpg` in two upload folders) read as one; compare the path's photo id
 * if that shows up.
 */
export function isSamePhoto(a: string, b: string): boolean {
  const key = photoKey(a);
  return key !== null && key === photoKey(b);
}

function photoKey(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    const file = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    return file ? `${hostname.toLowerCase()}/${file}` : null;
  } catch {
    return null;
  }
}
