const FOOTER_METADATA_KEYS = new Set([
  'platform',
  'original url',
  'author',
  'published',
  'likes',
  'comments',
  'shares',
  'views',
  'reactions',
  'replies',
  'retweets',
  'reposts',
  'saves',
  '\uD50C\uB7AB\uD3FC',
  '\uC6D0\uBCF8 url',
  '\uC791\uC131\uC790',
  '\uC800\uC790',
  '\uAC8C\uC2DC\uC77C',
  '\uAC8C\uC2DC \uB0A0\uC9DC',
  '\uC88B\uC544\uC694',
  '\uB313\uAE00',
  '\uACF5\uC720',
  '\uC870\uD68C\uC218',
  '\uB9AC\uC561\uC158',
  '\uB2F5\uAE00',
  '\uB9AC\uD2B8\uC717',
  '\uB9AC\uD3EC\uC2A4\uD2B8',
  '\uC800\uC7A5',
  '\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0',
  '\u5143\u306E url',
  '\u539F\u6587 url',
  '\u4F5C\u8005',
  '\u8457\u8005',
  '\u516C\u958B\u65E5',
  '\u6295\u7A3F\u65E5',
  '\u3044\u3044\u306D',
  '\u30B3\u30E1\u30F3\u30C8',
  '\u5171\u6709',
  '\u8868\u793A',
  '\u30EA\u30A2\u30AF\u30B7\u30E7\u30F3',
  '\u8FD4\u4FE1',
  '\u30EA\u30C4\u30A4\u30FC\u30C8',
  '\u30EA\u30DD\u30B9\u30C8',
  '\u4FDD\u5B58',
]);
const FOOTER_PLATFORM_LABEL_PATTERN = [
  'Platform',
  '\\uD50C\\uB7AB\\uD3FC',
  '\\u30D7\\u30E9\\u30C3\\u30C8\\u30D5\\u30A9\\u30FC\\u30E0',
].join('|');
const FOOTER_DETAIL_LABEL_PATTERN = [
  'Author',
  'Published',
  'Likes',
  'Comments',
  'Shares',
  'Views',
  'Reactions',
  'Replies',
  'Retweets',
  'Reposts',
  'Upvotes',
  'Saves',
  'Bookmarks',
  '\\uC791\\uC131\\uC790',
  '\\uC800\\uC790',
  '\\uAC8C\\uC2DC\\uC77C',
  '\\uC88B\\uC544\\uC694',
  '\\uB313\\uAE00',
  '\\uACF5\\uC720',
  '\\uC870\\uD68C\\uC218',
  '\\uB9AC\\uC561\\uC158',
  '\\uB2F5\\uAE00',
  '\\uB9AC\\uD2B8\\uC717',
  '\\uB9AC\\uD3EC\\uC2A4\\uD2B8',
  '\\uC800\\uC7A5',
  '\\u4F5C\\u8005',
  '\\u8457\\u8005',
  '\\u516C\\u958B\\u65E5',
  '\\u6295\\u7A3F\\u65E5',
  '\\u3044\\u3044\\u306D',
  '\\u30B3\\u30E1\\u30F3\\u30C8',
  '\\u5171\\u6709',
  '\\u8868\\u793A',
  '\\u30EA\\u30A2\\u30AF\\u30B7\\u30E7\\u30F3',
  '\\u8FD4\\u4FE1',
  '\\u30EA\\u30C4\\u30A4\\u30FC\\u30C8',
  '\\u30EA\\u30DD\\u30B9\\u30C8',
  '\\u4FDD\\u5B58',
].join('|');
const FOOTER_ORIGINAL_URL_LINE_RE = /^(?:Original URL|\uC6D0\uBCF8 URL|\u5143\u306E URL|\u539F\u6587 URL)\s*[:：]/i;
const FOOTER_PLATFORM_LINE_RE = new RegExp(`^(?:${FOOTER_PLATFORM_LABEL_PATTERN})\\s*[:：]`, 'i');
const FOOTER_PLATFORM_DETAIL_RE = new RegExp(`\\|\\s*(?:${FOOTER_DETAIL_LABEL_PATTERN})\\s*[:：]`, 'i');
const MEDIA_LABEL_LINE_RE = /^(?:Image|Video|\uC774\uBBF8\uC9C0|\uC0AC\uC9C4|\uBE44\uB514\uC624|\uC601\uC0C1|\u753B\u50CF|\u5199\u771F|\u30D3\u30C7\u30AA|\u52D5\u753B)\s+\d+\s*$/i;

function stripMarkdownEmphasis(value: string): string {
  return value.replace(/\*\*/g, '').trim();
}

function normalizeMetadataLine(value: string): string {
  return stripMarkdownEmphasis(value)
    .replace(/^\s*>+\s*/, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s*)/, '')
    .trim();
}

function startsWithFooterMetadata(line: string): boolean {
  const normalized = normalizeMetadataLine(line);
  const match = normalized.match(/^([^:：]{1,32})\s*[:：]/);
  return Boolean(match?.[1] && FOOTER_METADATA_KEYS.has(match[1].trim().toLowerCase()));
}

function looksLikeFooterPlatformLine(line: string): boolean {
  const normalized = normalizeMetadataLine(line);
  return FOOTER_PLATFORM_LINE_RE.test(normalized) && FOOTER_PLATFORM_DETAIL_RE.test(normalized);
}

function isYamlFrontmatterBlock(block: string): boolean {
  return /^[A-Za-z0-9_-]+\s*:/m.test(block);
}

function stripLeadingFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return markdown;
  const candidate = markdown.slice(4, end);
  if (!isYamlFrontmatterBlock(candidate)) return markdown;
  return markdown.slice(end + '\n---\n'.length).replace(/^\n+/, '');
}

function sectionStartsWithFooterMetadata(section: string): boolean {
  const firstLine = section
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return Boolean(firstLine && startsWithFooterMetadata(firstLine));
}

function hasFooterEvidence(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (FOOTER_ORIGINAL_URL_LINE_RE.test(normalizeMetadataLine(line))) return true;
  if (looksLikeFooterPlatformLine(line)) return true;

  const nextLines = lines.slice(index, Math.min(lines.length, index + 8));
  return nextLines.some((nextLine) => FOOTER_ORIGINAL_URL_LINE_RE.test(normalizeMetadataLine(nextLine)));
}

function isMarkdownMediaLine(line: string): boolean {
  return /^!\[[^\]]*]\([^)]+\)\s*$/.test(line)
    || /^!\[\[[^\]]+]]\s*$/.test(line)
    || MEDIA_LABEL_LINE_RE.test(line);
}

function isSectionDividerLine(line: string): boolean {
  return /^-{3,}$/.test(line) || /^\*{3,}$/.test(line) || /^_{3,}$/.test(line);
}

function stripTrailingMediaOnlyBlock(markdown: string): string {
  const lines = markdown.trimEnd().split('\n');
  let index = lines.length - 1;
  let sawMedia = false;

  while (index >= 0) {
    const line = lines[index]?.trim() ?? '';
    if (!line || isSectionDividerLine(line)) {
      index -= 1;
      continue;
    }
    if (isMarkdownMediaLine(line)) {
      sawMedia = true;
      index -= 1;
      continue;
    }
    break;
  }

  return sawMedia ? lines.slice(0, index + 1).join('\n').trim() : markdown.trim();
}

/**
 * AI translation variants should contain only the translated body, but models
 * can echo the archive footer ("Platform", "Original URL", media gallery).
 * Trim that archive-only metadata before storing or rendering the variant.
 */
export function stripContentVariantMetadataFooter(markdown: string): string {
  if (!markdown) return '';

  let cleaned = stripLeadingFrontmatter(markdown.replace(/\r\n?/g, '\n')).trim();
  if (!cleaned) return '';

  const sections = cleaned.split(/\n---+\n/);
  if (sections.length > 1) {
    const contentSections: string[] = [];
    for (const section of sections) {
      if (sectionStartsWithFooterMetadata(section)) break;
      contentSections.push(section);
    }
    if (contentSections.length < sections.length) {
      cleaned = contentSections.join('\n---\n').trim();
    }
  }

  const lines = cleaned.split('\n');
  const footerIndex = lines.findIndex((line, index) =>
    startsWithFooterMetadata(line) && hasFooterEvidence(lines, index),
  );
  if (footerIndex >= 0) {
    return stripTrailingMediaOnlyBlock(lines.slice(0, footerIndex).join('\n'));
  }

  return stripTrailingMediaOnlyBlock(cleaned);
}
