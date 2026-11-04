/**
 * Give `<br><br>`-separated article text real `<p>` paragraphs before Defuddle
 * reads the page.
 *
 * Korean news CMSs (Naver News `#dic_area`, …) write the body as bare text
 * nodes split by `<br><br>`, with inline `<span>`s and `<h3>` subheads mixed in
 * and no `<p>` anywhere. Defuddle's "trailing thin section" pass walks the
 * content root backwards by `previousElementSibling`, which skips text nodes:
 * it never meets the prose, finds only `<br>`s, spans and subheads (each under
 * its 25-word cut-off), and deletes all of them as a CTA block. The paragraphs
 * fuse into one wall of text, the subheads vanish, and Naver's per-word
 * dictionary spans (`<span data-type="ore">VSED</span>`) take their words with
 * them. Seen on defuddle 0.19.5 and 0.19.6.
 *
 * With each run in its own `<p>` the walk stops at the first real paragraph,
 * and Defuddle's own `<br>` cleanup drops the spacers between the new blocks.
 *
 * Narrow on purpose: only a block container that directly holds both text and
 * a `<br>`, and only when that text is actually broken into pieces (a `<br>`
 * pair or a block child). `<div>Name<br>Value</div>` stays as it is; a single
 * `<br>` inside a run stays a line break.
 */

/** Minimal structural DOM — Workers has no DOM lib, LinkedOM has no types. */
interface WrapNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly textContent: string | null;
}

interface WrapElement extends WrapNode {
  readonly childNodes: ArrayLike<WrapNode>;
  readonly firstChild: WrapNode | null;
  insertBefore(node: WrapNode, child: WrapNode | null): unknown;
  appendChild(node: WrapNode): unknown;
  removeChild(node: WrapNode): unknown;
  querySelector(selectors: string): unknown;
}

interface WrapDocument {
  querySelectorAll(selectors: string): ArrayLike<WrapElement>;
  createElement(tagName: 'p'): WrapElement;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// ponytail: no <td>/<li> — a <p> inside a table cell breaks the markdown table.
const CONTAINER_SELECTOR = 'article, section, main, div, blockquote';

/** Children that end a run: block boxes, embeds, and anything never prose. */
const RUN_BREAKING_TAGS = [
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
  'iframe', 'video', 'audio', 'script', 'style', 'noscript', 'template',
];
const RUN_BREAKING_SET = new Set(RUN_BREAKING_TAGS.map(tag => tag.toUpperCase()));
const RUN_BREAKING_SELECTOR = RUN_BREAKING_TAGS.join(', ');

const isBr = (node: WrapNode | undefined): boolean => node?.nodeName.toUpperCase() === 'BR';

/** Whitespace-only text, or a comment. */
const isBlank = (node: WrapNode): boolean =>
  node.nodeType !== ELEMENT_NODE && !(node.textContent ?? '').trim();

const hasText = (node: WrapNode): boolean => Boolean((node.textContent ?? '').trim());

/** Inline children are run content; an inline wrapping a block (Naver's photo `<span>`) is not. */
function breaksRun(node: WrapNode): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false;
  if (RUN_BREAKING_SET.has(node.nodeName.toUpperCase())) return true;
  return (node as WrapElement).querySelector(RUN_BREAKING_SELECTOR) != null;
}

/** Nearest sibling in `step` direction that isn't blank. */
function neighbour(nodes: WrapNode[], index: number, step: 1 | -1): WrapNode | undefined {
  for (let i = index + step; i >= 0 && i < nodes.length; i += step) {
    if (!isBlank(nodes[i]!)) return nodes[i];
  }
  return undefined;
}

/** Split a container's children into inline runs; `null` when it needs no change. */
function textRuns(nodes: WrapNode[]): WrapNode[][] | null {
  const runs: WrapNode[][] = [];
  let run: WrapNode[] = [];
  let broken = false;
  const flush = () => {
    let start = 0;
    let end = run.length;
    while (start < end && (isBr(run[start]) || isBlank(run[start]!))) start++;
    while (end > start && (isBr(run[end - 1]) || isBlank(run[end - 1]!))) end--;
    const body = run.slice(start, end);
    if (body.some(hasText)) runs.push(body);
    run = [];
  };

  nodes.forEach((node, index) => {
    const paragraphBreak = isBr(node) && (isBr(neighbour(nodes, index, -1)) || isBr(neighbour(nodes, index, 1)));
    if (paragraphBreak || breaksRun(node)) {
      broken = true;
      flush();
    } else {
      run.push(node);
    }
  });
  flush();

  return broken && runs.length > 0 ? runs : null;
}

/**
 * Wrap every `<br>`-separated text run of `document` in a `<p>`, and return a
 * function that unwraps them again, leaving the tree exactly as it was.
 *
 * The extension runs Defuddle against the LIVE page (see
 * removeArticleClutterInPlace for why); wrapping before the synchronous
 * `parse()` and unwrapping right after changes nothing the user can see. The
 * server parses a throwaway document and can ignore the return value.
 */
export function wrapBrSeparatedTextInPlace(document: WrapDocument): () => void {
  const wrapped: Array<{ container: WrapElement; paragraph: WrapElement }> = [];

  for (const container of Array.from(document.querySelectorAll(CONTAINER_SELECTOR))) {
    const nodes = Array.from(container.childNodes);
    if (!nodes.some(isBr) || !nodes.some(node => node.nodeType === TEXT_NODE && hasText(node))) continue;

    for (const run of textRuns(nodes) ?? []) {
      const paragraph = document.createElement('p');
      container.insertBefore(paragraph, run[0]!);
      for (const node of run) paragraph.appendChild(node);
      wrapped.push({ container, paragraph });
    }
  }

  return () => {
    for (let i = wrapped.length - 1; i >= 0; i--) {
      const { container, paragraph } = wrapped[i]!;
      while (paragraph.firstChild) container.insertBefore(paragraph.firstChild, paragraph);
      container.removeChild(paragraph);
    }
  };
}
