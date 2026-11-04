/**
 * Restore lazy-loaded images before Defuddle extraction.
 *
 * Two Defuddle passes conspire to delete inline article photos on sites that
 * lazy-load them, so the archive keeps the caption and loses the picture:
 *
 * 1. `removeHiddenElements` drops anything with an inline `display:none` —
 *    which is exactly how a lazy image waits for its script.
 * 2. `removeBySelector` drops any element whose class contains `loading`
 *    (a PARTIAL_SELECTORS entry). Naver News wraps every photo in
 *    `_LAZY_LOADING_WRAP` / `_LAZY_LOADING_ERROR_HIDE`, so the whole figure
 *    goes, not just the `<img>`.
 *
 * Measured on n.news.naver.com/article/025/0003542644: 4 body photos, 0 of
 * them in the archive — only the og:image survived, as the separate cover.
 *
 * Two shapes are restored:
 * - Not loaded yet (the server's fetched HTML): a lazy source attribute
 *   pointing at a real URL, promoted into `src`.
 * - Already loaded (the live page the extension reads): the loader swapped the
 *   real `src` in but left its lazy class on the `<img>` and its wrappers —
 *   Naver's `_LAZY_LOADING` — so the class pass still deletes the figure.
 *
 * Deliberately narrow: nothing else is touched, and the scrub walks up only
 * through ancestors that are themselves lazy-classed. Everything else keeps
 * Defuddle's default behaviour.
 */

/** Minimal structural DOM shape — Workers has no DOM lib, LinkedOM has no types. */
interface UnlazyElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  readonly parentElement: UnlazyElement | null;
}

interface UnlazyDocument {
  querySelectorAll(selector: string): ArrayLike<UnlazyElement>;
}

const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-echo'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];

/** Class tokens Defuddle's hidden/clutter passes react to. */
const LAZY_CLASS_TOKEN = /lazy|loading/i;

/** Inline hiding Defuddle's `removeHiddenElements` matches. */
const HIDDEN_STYLE_DECLARATION = /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)/i;

/** Only promote sources that are real URLs, never `data:` placeholders. */
const REAL_URL = /^(?:https?:)?\/\//i;

/** How far up the wrapper chain to scrub; stops early at the first sane ancestor. */
const MAX_WRAPPER_DEPTH = 4;

/** Every attribute write, with the value it replaced — `null` when it was absent. */
type Journal = Array<{ el: UnlazyElement; name: string; previous: string | null }>;

// ponytail: emptied rather than removed, so undo keeps the attribute's position.
function write(journal: Journal, el: UnlazyElement, name: string, value: string): void {
  journal.push({ el, name, previous: el.getAttribute(name) });
  el.setAttribute(name, value);
}

function firstAttr(el: UnlazyElement, names: string[]): string | null {
  for (const name of names) {
    const value = el.getAttribute(name)?.trim();
    if (value) return value;
  }
  return null;
}

const hasLazyClass = (el: UnlazyElement): boolean =>
  (el.getAttribute('class') ?? '').split(/\s+/).some(token => token && LAZY_CLASS_TOKEN.test(token));

/** Drop only the hiding declarations, keeping the rest of the inline style. */
function unhide(journal: Journal, el: UnlazyElement): void {
  const style = el.getAttribute('style');
  if (!style || !HIDDEN_STYLE_DECLARATION.test(style)) return;

  const kept = style
    .split(';')
    .filter(declaration => declaration.trim() && !HIDDEN_STYLE_DECLARATION.test(declaration))
    .join(';');

  write(journal, el, 'style', kept.trim() ? kept : '');
}

function stripLazyClasses(journal: Journal, el: UnlazyElement): void {
  if (!hasLazyClass(el)) return;
  const kept = (el.getAttribute('class') ?? '').split(/\s+/).filter(token => token && !LAZY_CLASS_TOKEN.test(token));
  write(journal, el, 'class', kept.join(' '));
}

/**
 * Promote lazy image sources and clear the markers that make Defuddle delete
 * them. Mutates the document in place and returns a function that puts every
 * attribute back — the extension parses the LIVE page (see
 * removeArticleClutterInPlace); the server's throwaway document ignores it.
 */
export function unlazyImagesInPlace(doc: UnlazyDocument): () => void {
  const journal: Journal = [];

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const lazySrc = firstAttr(img, LAZY_SRC_ATTRS);
    const src = img.getAttribute('src')?.trim() ?? '';
    const pendingSrc = lazySrc && REAL_URL.test(lazySrc) ? lazySrc : null;
    const loaded = !pendingSrc && REAL_URL.test(src) && hasLazyClass(img);
    if (!pendingSrc && !loaded) continue;

    if (pendingSrc) {
      if (!src || src.startsWith('data:')) write(journal, img, 'src', pendingSrc);
      const lazySrcset = firstAttr(img, LAZY_SRCSET_ATTRS);
      if (lazySrcset && !img.getAttribute('srcset')?.trim()) write(journal, img, 'srcset', lazySrcset);
    }

    unhide(journal, img);
    stripLazyClasses(journal, img);

    // The wrapper carries the class that triggers clutter removal, so the
    // <img> alone is not enough. Stop at the first ancestor that isn't a lazy
    // wrapper — beyond that we'd be second-guessing the page's own layout.
    let ancestor = img.parentElement;
    for (let depth = 0; ancestor && depth < MAX_WRAPPER_DEPTH; depth++) {
      if (!hasLazyClass(ancestor)) break;
      unhide(journal, ancestor);
      stripLazyClasses(journal, ancestor);
      ancestor = ancestor.parentElement;
    }
  }

  return () => {
    for (let i = journal.length - 1; i >= 0; i--) {
      const { el, name, previous } = journal[i]!;
      if (previous === null) el.removeAttribute(name);
      else el.setAttribute(name, previous);
    }
  };
}
