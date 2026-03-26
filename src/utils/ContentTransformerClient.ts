/**
 * Content Transformer Client (Client-side mirror)
 *
 * Client-side mirror of the worker's ContentTransformer.
 * Static methods are copied verbatim to produce identical output for preview accuracy.
 *
 * NOTE: escapeHtml is intentionally excluded — it is server-side only (XSS prevention).
 *
 * Single Responsibility: Client-side markdown → plain text transformation for preview
 */

export class ContentTransformerClient {
  /**
   * Strip markdown syntax to produce plain text.
   * Removes: frontmatter, wiki links, image syntax, bold/italic,
   * code blocks, blockquotes, headers, HR, HTML tags, entities.
   */
  static stripMarkdown(markdown: string): string {
    let text = markdown;

    // Remove YAML frontmatter
    text = text.replace(/^---[\s\S]*?---\n?/m, '');

    // Remove code blocks (fenced)
    text = text.replace(/```[\s\S]*?```/g, '');

    // Remove inline code
    text = text.replace(/`([^`]+)`/g, '$1');

    // Remove image syntax ![alt](url) and ![[wikilink]]
    text = text.replace(/!\[\[([^\]]*)\]\]/g, '');
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');

    // Convert wiki links [[link|display]] → display, [[link]] → link
    text = text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
    text = text.replace(/\[\[([^\]]*)\]\]/g, '$1');

    // Convert markdown links [text](url) → text
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

    // Remove headers (# ## ### etc.)
    text = text.replace(/^#{1,6}\s+/gm, '');

    // Remove blockquotes
    text = text.replace(/^>\s?/gm, '');

    // Remove horizontal rules
    text = text.replace(/^[-*_]{3,}\s*$/gm, '');

    // Remove bold/italic/strikethrough
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    text = text.replace(/\*(.+?)\*/g, '$1');
    text = text.replace(/__(.+?)__/g, '$1');
    text = text.replace(/_(.+?)_/g, '$1');
    text = text.replace(/~~(.+?)~~/g, '$1');

    // Convert unordered list markers to bullet character
    text = text.replace(/^([\s]*)[-*+]\s+/gm, '$1• ');

    // Preserve ordered list markers (1. 2. 3.) — only strip leading whitespace
    text = text.replace(/^[\s]+(\d+\.\s)/gm, '$1');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');

    // Collapse multiple newlines into double newline (paragraph break)
    text = text.replace(/\n{3,}/g, '\n\n');

    // Trim leading/trailing whitespace
    text = text.trim();

    return text;
  }

  /**
   * Truncate text at the last sentence boundary within maxChars.
   * Falls back to word boundary if no sentence boundary found.
   */
  static truncateAtSentence(
    text: string,
    maxChars: number,
    suffix = '...'
  ): string {
    if (text.length <= maxChars) {
      return text;
    }

    const effectiveMax = maxChars - suffix.length;
    if (effectiveMax <= 0) {
      return suffix.substring(0, maxChars);
    }

    const truncated = text.substring(0, effectiveMax);

    // Try to find last sentence boundary
    const sentenceEnd = truncated.search(/[.!?]\s[^.!?]*$/);
    if (sentenceEnd !== -1 && sentenceEnd > effectiveMax * 0.3) {
      return truncated.substring(0, sentenceEnd + 1) + suffix;
    }

    // Fall back to word boundary
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > effectiveMax * 0.3) {
      return truncated.substring(0, lastSpace) + suffix;
    }

    // Hard truncate as last resort
    return truncated + suffix;
  }

  /**
   * Count characters for Threads (simple character count).
   * Threads uses a 500-character limit with no special weighting.
   */
  static countCharacters(text: string): number {
    return text.length;
  }

  /**
   * Extract and validate URLs from text.
   */
  static extractLinks(text: string): { urls: string[]; count: number } {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const matches = text.match(urlRegex);
    if (!matches) return { urls: [], count: 0 };

    const validUrls = matches.filter((url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });

    return { urls: validUrls, count: validUrls.length };
  }

  /**
   * Extract hashtags from text.
   * Returns array of hashtag strings without # prefix.
   */
  static extractHashtags(text: string): string[] {
    const matches = text.match(
      /(?:^|\s)#([a-zA-Z0-9_\u00C0-\u024F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]+)/g
    );
    if (!matches) return [];

    return matches.map((m) => m.trim().substring(1));
  }

  // ─── Thread delimiter detection ──────────────────────────────────────────

  /** Matches a line containing only dashes (2+), underscores (3+), or asterisks (3+). */
  private static readonly THREAD_DELIMITER_RE = /^(-{2,}|_{3,}|\*{3,})\s*$/;

  /**
   * Split raw markdown by user-defined thread delimiter lines (-- / --- / ___ / ***).
   * Returns null if no delimiters are found or fewer than 2 non-empty segments result.
   */
  static splitByUserDelimiters(rawMarkdown: string): string[] | null {
    // No 'm' flag — only match frontmatter at document start
    const text = rawMarkdown.replace(/^---[\s\S]*?---\n?/, '');

    const lines = text.split('\n');
    let hasDelimiter = false;
    const segments: string[] = [];
    let currentLines: string[] = [];

    for (const line of lines) {
      if (this.THREAD_DELIMITER_RE.test(line)) {
        hasDelimiter = true;
        const segText = currentLines.join('\n').trim();
        if (segText) segments.push(segText);
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    const lastSeg = currentLines.join('\n').trim();
    if (lastSeg) segments.push(lastSeg);

    if (!hasDelimiter || segments.length < 2) {
      return null;
    }

    return segments;
  }

  /**
   * Split text for thread posting, honoring user-defined delimiters.
   *
   * Delimiter lines (-- / ---) are treated as explicit thread break points.
   * Each segment is stripped of markdown and, if still over maxChars,
   * sub-split using paragraph/sentence boundaries.
   *
   * Falls back to paragraph-based splitting when no delimiters are found.
   */
  static splitForThread(
    rawMarkdown: string,
    maxChars: number,
    maxChunks: number
  ): string[] {
    const delimiterSegments = this.splitByUserDelimiters(rawMarkdown);

    if (delimiterSegments) {
      const allChunks: string[] = [];

      for (const rawSegment of delimiterSegments) {
        if (allChunks.length >= maxChunks) break;

        const stripped = this.stripMarkdown(rawSegment);
        if (!stripped) continue;

        if (stripped.length <= maxChars) {
          allChunks.push(stripped);
        } else {
          // Sub-split oversized segment at sentence/word boundaries
          const remaining = maxChunks - allChunks.length;
          const subChunks = this.splitIntoChunks(stripped, maxChars, remaining);
          allChunks.push(...subChunks);
        }
      }

      return allChunks.length > 0 ? allChunks : [this.stripMarkdown(rawMarkdown)];
    }

    const stripped = this.stripMarkdown(rawMarkdown);
    if (stripped.length <= maxChars) {
      return [stripped];
    }

    return this.splitIntoChunks(stripped, maxChars, maxChunks);
  }

  /**
   * Split text into chunks that fit within maxChars, preserving paragraph
   * and line-break structure. Returns at most maxChunks pieces.
   */
  static splitIntoChunks(
    text: string,
    maxChars: number,
    maxChunks: number
  ): string[] {
    if (text.length <= maxChars) {
      return [text];
    }

    const paragraphs = text.split(/\n\n/).map((p) => p.trim()).filter((p) => p.length > 0);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if (chunks.length >= maxChunks) break;

      const combined = currentChunk
        ? currentChunk + '\n\n' + paragraph
        : paragraph;

      if (combined.length <= maxChars) {
        currentChunk = combined;
        continue;
      }

      if (currentChunk) {
        chunks.push(currentChunk);
        if (chunks.length >= maxChunks) break;
        currentChunk = '';
      }

      if (paragraph.length <= maxChars) {
        currentChunk = paragraph;
        continue;
      }

      // Paragraph exceeds limit — split at sentence/word boundaries
      let remaining = paragraph;
      while (remaining.length > 0 && chunks.length < maxChunks) {
        if (remaining.length <= maxChars) {
          currentChunk = remaining;
          remaining = '';
          break;
        }
        const slice = remaining.substring(0, maxChars);
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > maxChars * 0.3) {
          chunks.push(slice.substring(0, lastSpace).trimEnd());
          remaining = remaining.substring(lastSpace).trimStart();
        } else {
          chunks.push(slice.trimEnd());
          remaining = remaining.substring(maxChars).trimStart();
        }
      }
    }

    if (currentChunk && chunks.length < maxChunks) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Separate the first URL as a link attachment for Threads.
   * Removes it from the text body to avoid duplication.
   */
  static separateLinkAttachment(text: string): {
    text: string;
    linkAttachment?: string;
  } {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/;
    const match = text.match(urlRegex);

    if (!match || !match[0]) {
      return { text };
    }

    try {
      new URL(match[0]);
    } catch {
      return { text };
    }

    const cleanedText = text
      .replace(match[0], '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return {
      text: cleanedText,
      linkAttachment: match[0],
    };
  }
}
