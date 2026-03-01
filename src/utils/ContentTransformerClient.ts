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

    // Remove unordered list markers
    text = text.replace(/^[\s]*[-*+]\s+/gm, '');

    // Remove ordered list markers
    text = text.replace(/^[\s]*\d+\.\s+/gm, '');

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
