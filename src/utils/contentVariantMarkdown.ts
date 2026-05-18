const FOOTER_METADATA_KEYS = new Set([
  'platform',
  'original url',
  'author',
  'published',
]);

function stripMarkdownEmphasis(value: string): string {
  return value.replace(/\*\*/g, '').trim();
}

function startsWithFooterMetadata(line: string): boolean {
  const normalized = stripMarkdownEmphasis(line);
  const match = normalized.match(/^([^:]{1,32})\s*:/);
  return Boolean(match?.[1] && FOOTER_METADATA_KEYS.has(match[1].trim().toLowerCase()));
}

function looksLikeFooterPlatformLine(line: string): boolean {
  const normalized = stripMarkdownEmphasis(line);
  return /^Platform\s*:/i.test(normalized)
    && /\|\s*(Author|Published|Likes|Comments|Shares|Views|Reactions|Replies|Retweets|Upvotes|Saves)\s*:/i.test(normalized);
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
  if (/^Original URL\s*:/i.test(stripMarkdownEmphasis(line))) return true;
  if (looksLikeFooterPlatformLine(line)) return true;

  const nextLines = lines.slice(index, Math.min(lines.length, index + 8));
  return nextLines.some((nextLine) => /^Original URL\s*:/i.test(stripMarkdownEmphasis(nextLine)));
}

function isMarkdownMediaLine(line: string): boolean {
  return /^!\[[^\]]*]\([^)]+\)\s*$/.test(line)
    || /^!\[\[[^\]]+]]\s*$/.test(line)
    || /^Image\s+\d+\s*$/i.test(line);
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
