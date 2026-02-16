/**
 * TextFormatter - Text linkification utilities
 * Single Responsibility: Convert text patterns to markdown links (mentions, timestamps)
 */
export class TextFormatter {
  /**
   * Convert @mentions to Instagram profile links
   */
  linkifyInstagramMentions(text: string, isReply: boolean = false): string {
    // For replies, remove the first @mention if it's at the start (it's redundant)
    let processedText = text;
    if (isReply) {
      processedText = text.replace(/^@[\w.]+\s*/, '');
    }

    // Match @username (Instagram usernames can contain letters, numbers, underscores, periods)
    // Don't match if already in a markdown link
    return processedText.replace(/@([\w.]+)(?!\])/g, (_match, username) => {
      return `[@${username}](https://instagram.com/${username})`;
    });
  }

  /**
   * Convert @mentions to X (Twitter) profile links
   */
  linkifyXMentions(text: string): string {
    // Match @username (X usernames: letters, numbers, underscores, max 15 chars)
    // Don't match if already in a markdown link (followed by ])
    return text.replace(/@(\w{1,15})(?!\])/g, (_match, username) => {
      return `[@${username}](https://x.com/${username})`;
    });
  }

  /**
   * Convert YouTube timestamps to clickable links
   * Example: "00:00 Introduction" -> "[00:00](https://www.youtube.com/watch?v=VIDEO_ID&t=0s) Introduction"
   * Also supports: "0:00-Intro", "2:00- Exterior"
   */
  linkifyYouTubeTimestamps(text: string, videoId: string): string {
    // Match timestamps at the beginning of lines: HH:MM:SS or MM:SS
    // Pattern: line start, optional whitespace, timestamp, optional separator (space, dash, etc), description text
    const result = text.replace(/^(\s*)(\d{1,2}:\d{2}(?::\d{2})?)[\s\-]*(.*)$/gm, (_match, whitespace, timestamp, description) => {
      // Skip if no description (just timestamp alone)
      if (!description.trim()) {
        return _match;
      }

      // Convert timestamp to seconds
      const parts = timestamp.split(':').map(Number);
      let seconds: number;

      if (parts.length === 3) {
        // HH:MM:SS format
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else {
        // MM:SS format
        seconds = parts[0] * 60 + parts[1];
      }

      // Create YouTube timestamp link (only timestamp is clickable, not description)
      const url = `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`;
      return `${whitespace}[${timestamp}](${url}) ${description}`;
    });

    return result;
  }

  /**
   * Extract hashtags from text
   */
  extractHashtags(text: string): string[] {
    // Hashtag pattern: # followed by word characters (letters, numbers, underscores)
    // Supports Unicode letters for international hashtags
    const hashtagPattern = /#([\p{L}\p{N}_]+)/gu;
    const hashtags: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = hashtagPattern.exec(text)) !== null) {
      const tag = match[1]?.trim();
      if (tag && !hashtags.includes(tag)) {
        hashtags.push(tag);
      }
    }

    return hashtags;
  }

  /**
   * Build Markdown links for hashtags by platform
   * @param tags - Original hashtags for URL encoding (may contain spaces)
   * @param platform - Platform name for URL generation
   * @param displayTags - Optional normalized hashtags for display (spaces replaced with hyphens)
   */
  buildHashtagLinks(tags: string[] | undefined, platform: string, displayTags?: string[]): string | undefined {
    if (!tags || tags.length === 0) return undefined;

    const buildUrl = (tag: string): string => {
      const encoded = encodeURIComponent(tag);
      switch (platform.toLowerCase()) {
        case 'instagram':
          return `https://www.instagram.com/explore/tags/${encoded}/`;
        case 'x':
        case 'twitter':
          return `https://twitter.com/hashtag/${encoded}`;
        case 'facebook':
          return `https://www.facebook.com/hashtag/${encoded}`;
        case 'linkedin':
          return `https://www.linkedin.com/feed/hashtag/${encoded}/`;
        case 'tiktok':
          return `https://www.tiktok.com/tag/${encoded}`;
        case 'threads':
          return `https://www.threads.net/tag/${encoded}`;
        case 'youtube':
          return `https://www.youtube.com/hashtag/${encoded}`;
        case 'reddit':
          return `https://www.reddit.com/search/?q=%23${encoded}`;
        case 'mastodon':
          return `https://mastodon.social/tags/${encoded}`;
        case 'bluesky':
          return `https://bsky.app/search?q=%23${encoded}`;
        case 'pinterest':
          return `https://www.pinterest.com/search/pins/?q=${encoded}`;
        case 'substack':
          return `https://substack.com/search/${encoded}`;
        case 'tumblr':
          return `https://www.tumblr.com/tagged/${encoded}`;
        default:
          return `https://www.google.com/search?q=%23${encoded}`;
      }
    };

    const parts = tags.map((tag, index) => {
      const clean = tag.startsWith('#') ? tag.slice(1) : tag;
      // Use displayTag if provided, otherwise use original tag
      const displayTag = displayTags && displayTags[index]
        ? (displayTags[index].startsWith('#') ? displayTags[index] : `#${displayTags[index]}`)
        : `#${clean}`;
      return `[${displayTag}](${buildUrl(clean)})`;
    });

    return parts.join(' ');
  }
}
