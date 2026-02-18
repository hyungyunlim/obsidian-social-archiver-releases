/**
 * VaultContextCollector Service
 *
 * Collects vault context (notes, aliases, tags, links) for AI Comment
 * 'connections' type. Uses MetadataCache for efficient access.
 *
 * Single Responsibility: Extract vault metadata for AI context
 */

import { type App, TFile, type MetadataCache, type CachedMetadata, type EventRef } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

/**
 * Individual vault item context
 */
export interface VaultContextItem {
  /** File basename without extension */
  name: string;
  /** Full vault path */
  path: string;
  /** YAML frontmatter aliases */
  aliases: string[];
  /** All tags (from frontmatter and inline) */
  tags: string[];
  /** Outgoing wiki/markdown links */
  links: string[];
  /** First 200 chars of content for context */
  excerpt?: string;
}

/**
 * Aggregated vault context
 */
export interface VaultContext {
  /** All collected items */
  files: VaultContextItem[];
  /** Unique tags across all files */
  allTags: string[];
  /** Total note count in vault */
  totalNotes: number;
  /** Collection timestamp */
  collectedAt: Date;
}

/**
 * Options for context collection
 */
export interface VaultContextOptions {
  /** Paths to exclude from collection (glob patterns) */
  excludePaths?: string[];
  /** Maximum files to include */
  maxFiles?: number;
  /** Include content excerpts */
  includeExcerpts?: boolean;
  /** Filter by tags (include files with any of these tags) */
  filterByTags?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default max files to collect */
const DEFAULT_MAX_FILES = 500;

/** Default paths to exclude (excluding the vault config folder dynamically) */
const DEFAULT_STATIC_EXCLUDE_PATHS = [
  'templates',
  '.trash',
  'Social Archives', // Don't include archived posts in connections
];

/** Excerpt length */
const EXCERPT_LENGTH = 200;

/** Batch size for parallel processing */
const BATCH_SIZE = 100;

// ============================================================================
// VaultContextCollector Class
// ============================================================================

/**
 * Collects and aggregates vault metadata for AI context
 */
export class VaultContextCollector {
  private readonly app: App;
  private readonly metadataCache: MetadataCache;

  constructor(app: App) {
    this.app = app;
    this.metadataCache = app.metadataCache;
  }

  /**
   * Collect vault context for AI analysis
   *
   * @param options - Collection options
   * @returns Aggregated vault context
   */
  async collectContext(options?: VaultContextOptions): Promise<VaultContext> {
    const configDir = this.app.vault.configDir;
    const defaultExcludePaths = [...DEFAULT_STATIC_EXCLUDE_PATHS, configDir];
    const excludePaths = options?.excludePaths ?? defaultExcludePaths;
    const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
    const includeExcerpts = options?.includeExcerpts ?? false;
    const filterByTags = options?.filterByTags;

    // Get all markdown files
    const allFiles = this.app.vault.getMarkdownFiles();

    // Filter files
    const filteredFiles = allFiles.filter(file => {
      // Check exclude paths
      for (const excludePath of excludePaths) {
        if (file.path.toLowerCase().startsWith(excludePath.toLowerCase())) {
          return false;
        }
        // Also check if any parent folder matches
        if (file.parent?.path.toLowerCase().includes(excludePath.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    // Sort by modification time (most recent first)
    const sortedFiles = filteredFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

    // Collect context items
    const items: VaultContextItem[] = [];
    const allTags = new Set<string>();

    // Process in batches
    for (let i = 0; i < sortedFiles.length && items.length < maxFiles; i += BATCH_SIZE) {
      const batch = sortedFiles.slice(i, Math.min(i + BATCH_SIZE, sortedFiles.length));

      const batchResults = await Promise.all(
        batch.map(async (file) => {
          try {
            return await this.extractFileContext(file, includeExcerpts);
          } catch {
            return null;
          }
        })
      );

      for (const result of batchResults) {
        if (!result) continue;

        // Apply tag filter if specified
        if (filterByTags && filterByTags.length > 0) {
          const hasMatchingTag = result.tags.some(tag =>
            filterByTags.some(filterTag =>
              tag.toLowerCase().includes(filterTag.toLowerCase())
            )
          );
          if (!hasMatchingTag) continue;
        }

        items.push(result);
        result.tags.forEach(tag => allTags.add(tag));

        if (items.length >= maxFiles) break;
      }
    }

    return {
      files: items,
      allTags: Array.from(allTags).sort(),
      totalNotes: allFiles.length,
      collectedAt: new Date(),
    };
  }

  /**
   * Extract context from a single file
   */
  private async extractFileContext(
    file: TFile,
    includeExcerpt: boolean
  ): Promise<VaultContextItem | null> {
    const cache = this.metadataCache.getFileCache(file);
    if (!cache) return null;

    // Extract aliases
    const aliases = this.extractAliases(cache);

    // Extract tags
    const tags = this.extractTags(cache);

    // Extract links
    const links = this.extractLinks(cache);

    // Extract excerpt if requested
    let excerpt: string | undefined;
    if (includeExcerpt) {
      excerpt = await this.extractExcerpt(file);
    }

    return {
      name: file.basename,
      path: file.path,
      aliases,
      tags,
      links,
      excerpt,
    };
  }

  /**
   * Extract aliases from frontmatter
   */
  private extractAliases(cache: CachedMetadata): string[] {
    const frontmatter = cache.frontmatter;
    if (!frontmatter?.aliases) return [];

    const aliases = frontmatter.aliases as unknown;

    if (Array.isArray(aliases)) {
      return aliases.filter((a): a is string => typeof a === 'string');
    }

    if (typeof aliases === 'string') {
      return [aliases];
    }

    return [];
  }

  /**
   * Extract tags from frontmatter and content
   */
  private extractTags(cache: CachedMetadata): string[] {
    const tags = new Set<string>();

    // Frontmatter tags
    const frontmatterTags = cache.frontmatter?.tags as unknown;
    if (Array.isArray(frontmatterTags)) {
      frontmatterTags.forEach(tag => {
        if (typeof tag === 'string') {
          // Remove # prefix if present
          tags.add(tag.startsWith('#') ? tag.slice(1) : tag);
        }
      });
    } else if (typeof frontmatterTags === 'string') {
      tags.add(frontmatterTags.startsWith('#') ? frontmatterTags.slice(1) : frontmatterTags);
    }

    // Inline tags from content
    if (cache.tags) {
      cache.tags.forEach(tagCache => {
        // tagCache.tag includes # prefix
        tags.add(tagCache.tag.slice(1));
      });
    }

    return Array.from(tags);
  }

  /**
   * Extract outgoing links
   */
  private extractLinks(cache: CachedMetadata): string[] {
    const links: string[] = [];

    // Wiki links
    if (cache.links) {
      cache.links.forEach(link => {
        links.push(link.link);
      });
    }

    // Embed links
    if (cache.embeds) {
      cache.embeds.forEach(embed => {
        links.push(embed.link);
      });
    }

    return [...new Set(links)]; // Deduplicate
  }

  /**
   * Extract first N characters as excerpt
   */
  private async extractExcerpt(file: TFile): Promise<string | undefined> {
    try {
      const content = await this.app.vault.cachedRead(file);

      // Remove frontmatter
      let text = content;
      if (text.startsWith('---')) {
        const endIndex = text.indexOf('---', 3);
        if (endIndex > 0) {
          text = text.slice(endIndex + 3).trim();
        }
      }

      // Remove markdown formatting for cleaner excerpt
      text = text
        .replace(/^#+\s+/gm, '') // Headers
        .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
        .replace(/\*([^*]+)\*/g, '$1') // Italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // Images
        .replace(/`[^`]+`/g, '') // Inline code
        .replace(/```[\s\S]*?```/g, '') // Code blocks
        .trim();

      if (text.length <= EXCERPT_LENGTH) {
        return text || undefined;
      }

      // Truncate at word boundary
      const truncated = text.slice(0, EXCERPT_LENGTH);
      const lastSpace = truncated.lastIndexOf(' ');
      return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '...';
    } catch {
      return undefined;
    }
  }

  /**
   * Format vault context for AI prompt
   *
   * @param context - Vault context to format
   * @param maxLength - Maximum output length
   * @returns Formatted string for AI prompt
   */
  formatForPrompt(context: VaultContext, maxLength: number = 5000): string {
    const lines: string[] = [];

    lines.push(`## My Notes (${context.totalNotes} total)\n`);

    // Add tag overview
    if (context.allTags.length > 0) {
      const topTags = context.allTags.slice(0, 20);
      lines.push(`**Common Tags:** ${topTags.join(', ')}\n`);
    }

    lines.push(`### Recent Notes\n`);

    let currentLength = lines.join('\n').length;

    for (const item of context.files) {
      const itemLines: string[] = [];
      itemLines.push(`- **${item.name}**`);

      if (item.aliases.length > 0) {
        itemLines.push(`  - Aliases: ${item.aliases.join(', ')}`);
      }

      if (item.tags.length > 0) {
        itemLines.push(`  - Tags: ${item.tags.map(t => `#${t}`).join(', ')}`);
      }

      if (item.links.length > 0) {
        itemLines.push(`  - Links to: ${item.links.slice(0, 5).join(', ')}${item.links.length > 5 ? '...' : ''}`);
      }

      if (item.excerpt) {
        itemLines.push(`  - Excerpt: "${item.excerpt}"`);
      }

      const itemText = itemLines.join('\n') + '\n';

      if (currentLength + itemText.length > maxLength) {
        lines.push(`\n... and ${context.files.length - lines.length + 3} more notes`);
        break;
      }

      lines.push(itemText);
      currentLength += itemText.length;
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Smart Filtering
// ============================================================================

/**
 * Common English stop words to ignore in keyword extraction
 */
const STOP_WORDS = new Set([
  'the', 'and', 'is', 'in', 'to', 'of', 'a', 'for', 'on', 'with', 'as', 'at',
  'by', 'from', 'or', 'an', 'be', 'this', 'that', 'which', 'it', 'are', 'was',
  'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall', 'not',
  'but', 'if', 'then', 'than', 'so', 'just', 'now', 'here', 'there', 'when',
  'where', 'how', 'what', 'who', 'whom', 'why', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'only', 'own',
  'same', 'too', 'very', 'also', 'about', 'after', 'before', 'between',
  'into', 'through', 'during', 'above', 'below', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'further', 'once', 'any', 'your', 'yours', 'you',
  'they', 'them', 'their', 'we', 'our', 'ours', 'his', 'her', 'hers', 'its',
  'http', 'https', 'www', 'com', 'org', 'net',
]);

/**
 * Extract meaningful keywords from text content
 *
 * @param text - Content to extract keywords from
 * @param maxKeywords - Maximum keywords to return
 * @returns Array of keywords sorted by frequency
 */
export function extractKeywords(text: string, maxKeywords: number = 50): string[] {
  // Normalize text
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ') // Remove special chars except hyphens
    .replace(/\s+/g, ' ')
    .trim();

  // Split into words
  const words = normalized.split(' ');

  // Count word frequency
  const frequency = new Map<string, number>();

  for (const word of words) {
    // Skip short words, numbers, and stop words
    if (
      word.length <= 3 ||
      /^\d+$/.test(word) ||
      STOP_WORDS.has(word)
    ) {
      continue;
    }

    frequency.set(word, (frequency.get(word) || 0) + 1);
  }

  // Sort by frequency and return top keywords
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

/**
 * Scored vault context item
 */
export interface ScoredVaultContextItem extends VaultContextItem {
  /** Relevance score (higher = more relevant) */
  score: number;
}

/**
 * Calculate relevance score for a vault item against keywords
 *
 * @param item - Vault context item
 * @param keywords - Keywords to match against
 * @returns Relevance score
 */
export function calculateRelevanceScore(
  item: VaultContextItem,
  keywords: string[]
): number {
  // Create searchable text from item metadata
  const searchableText = [
    item.name,
    ...item.aliases,
    ...item.tags,
    ...item.links,
    item.excerpt || '',
  ].join(' ').toLowerCase();

  let score = 0;

  for (const keyword of keywords) {
    // Exact match in name gets highest score
    if (item.name.toLowerCase().includes(keyword)) {
      score += 5;
    }

    // Match in aliases
    if (item.aliases.some(a => a.toLowerCase().includes(keyword))) {
      score += 4;
    }

    // Match in tags
    if (item.tags.some(t => t.toLowerCase().includes(keyword))) {
      score += 3;
    }

    // Match in links
    if (item.links.some(l => l.toLowerCase().includes(keyword))) {
      score += 2;
    }

    // General match in searchable text
    if (searchableText.includes(keyword)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Estimate token count for a vault item
 * Rough estimate: ~4 characters per token
 *
 * @param item - Vault context item
 * @returns Estimated token count
 */
export function estimateTokens(item: VaultContextItem): number {
  const text = [
    item.name,
    ...item.aliases,
    ...item.tags,
    ...item.links,
    item.excerpt || '',
  ].join(' ');

  return Math.ceil(text.length / 4);
}

/**
 * Options for relevance-based context selection
 */
export interface RelevantContextOptions extends VaultContextOptions {
  /** Maximum tokens to include in context */
  maxTokens?: number;
  /** Minimum relevance score to include */
  minScore?: number;
}

/**
 * Get vault context filtered by relevance to content
 *
 * @param app - Obsidian App instance
 * @param content - Content to find relevant notes for
 * @param options - Selection options
 * @returns Vault context with most relevant notes
 */
export async function getRelevantVaultContext(
  app: App,
  content: string,
  options?: RelevantContextOptions
): Promise<VaultContext> {
  const maxTokens = options?.maxTokens ?? 4000;
  const minScore = options?.minScore ?? 1;

  // Get full vault context
  const fullContext = await VaultContextCache.getContext(app, false, options);

  // Extract keywords from content
  const keywords = extractKeywords(content);

  if (keywords.length === 0) {
    // No meaningful keywords - return limited context
    return {
      files: fullContext.files.slice(0, 50),
      allTags: fullContext.allTags,
      totalNotes: fullContext.totalNotes,
      collectedAt: fullContext.collectedAt,
    };
  }

  // Score all files by relevance
  const scoredFiles: ScoredVaultContextItem[] = fullContext.files
    .map(file => ({
      ...file,
      score: calculateRelevanceScore(file, keywords),
    }))
    .filter(file => file.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // Select files within token budget
  const selectedFiles: VaultContextItem[] = [];
  let estimatedTokens = 0;

  for (const file of scoredFiles) {
    const fileTokens = estimateTokens(file);

    if (estimatedTokens + fileTokens > maxTokens) {
      // If we haven't selected any files yet, include at least one
      if (selectedFiles.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring to strip the internal scoring property before returning
        const { score: _score, ...fileWithoutScore } = file;
        selectedFiles.push(fileWithoutScore);
      }
      break;
    }

    // Remove score property before adding to result
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring to strip the internal scoring property before returning
    const { score: _score, ...fileWithoutScore } = file;
    selectedFiles.push(fileWithoutScore);
    estimatedTokens += fileTokens;
  }

  return {
    files: selectedFiles,
    allTags: fullContext.allTags,
    totalNotes: fullContext.totalNotes,
    collectedAt: fullContext.collectedAt,
  };
}

// ============================================================================
// VaultContextCache Singleton
// ============================================================================

/**
 * Cache for vault context with TTL and invalidation
 */
class VaultContextCacheClass {
  private cache: VaultContext | null = null;
  private lastUpdate: number = 0;
  private readonly CACHE_TTL = 60 * 1000; // 1 minute
  private eventRefs: EventRef[] = [];
  private isInitialized = false;

  /**
   * Get cached vault context or collect fresh data
   *
   * @param app - Obsidian App instance
   * @param forceRefresh - Force cache refresh
   * @param options - Collection options
   * @returns Vault context
   */
  async getContext(
    app: App,
    forceRefresh?: boolean,
    options?: VaultContextOptions
  ): Promise<VaultContext> {
    // Initialize event listeners on first call
    if (!this.isInitialized) {
      this.initializeEventListeners(app);
      this.isInitialized = true;
    }

    const now = Date.now();

    // Return cached if valid
    if (
      !forceRefresh &&
      this.cache &&
      (now - this.lastUpdate) < this.CACHE_TTL
    ) {
      return this.cache;
    }

    // Collect fresh context
    const collector = new VaultContextCollector(app);
    this.cache = await collector.collectContext(options);
    this.lastUpdate = now;

    return this.cache;
  }

  /**
   * Invalidate cache
   */
  invalidate(): void {
    this.cache = null;
    this.lastUpdate = 0;
  }

  /**
   * Initialize vault event listeners for cache invalidation
   */
  private initializeEventListeners(app: App): void {
    // Invalidate on file changes
    this.eventRefs.push(
      app.vault.on('modify', () => {
        this.invalidate();
      })
    );

    this.eventRefs.push(
      app.vault.on('create', () => {
        this.invalidate();
      })
    );

    this.eventRefs.push(
      app.vault.on('delete', () => {
        this.invalidate();
      })
    );

    this.eventRefs.push(
      app.vault.on('rename', () => {
        this.invalidate();
      })
    );
  }

  /**
   * Cleanup event listeners
   */
  cleanup(app: App): void {
    this.eventRefs.forEach(ref => {
      app.vault.offref(ref);
    });
    this.eventRefs = [];
    this.isInitialized = false;
    this.invalidate();
  }
}

/** Singleton instance */
export const VaultContextCache = new VaultContextCacheClass();
