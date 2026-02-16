import type { TFile } from 'obsidian';

/**
 * Represents a single episode in a series (e.g., Brunch book chapter)
 */
export interface SeriesEpisode {
  /** Episode number (1-based) */
  episode: number;
  /** Reference to the file in the vault */
  file: TFile;
  /** Episode/chapter title */
  title: string;
  /** Short excerpt of the content */
  excerpt: string;
  /** Original published date (YYYY-MM-DD HH:mm) */
  published: string;
  /** Archived date (YYYY-MM-DD HH:mm) */
  archived: string;
  /** Whether this episode is marked as read (archive: true in frontmatter) */
  isRead: boolean;
  /** File path for navigation */
  filePath: string;
  /** Episode star rating (0-10), e.g., for Naver Webtoon */
  starScore?: number;
  /** Whether this episode is liked/favorited by user */
  isLiked?: boolean;
}

/**
 * Represents a grouped series with multiple episodes
 */
export interface SeriesGroup {
  /** Unique identifier for the series (seriesId from frontmatter) */
  seriesId: string;
  /** Display title of the series */
  seriesTitle: string;
  /** URL to the original series page */
  seriesUrl?: string;
  /** Platform identifier (e.g., 'brunch') */
  platform: string;
  /** Author name */
  author: string;
  /** Author profile URL */
  authorUrl?: string;
  /** All episodes sorted by episode number */
  episodes: SeriesEpisode[];
  /** Currently selected episode number (1-based) */
  currentEpisode: number;
  /** Most recent published date among episodes (for timeline positioning) */
  latestPublished: string;
  /** Most recent archived date among episodes (for timeline positioning when sorting by archived) */
  latestArchived: string;
  /** Publishing day of week (e.g., "월요일", "화요일") for webtoons */
  publishDay?: string;
}

/**
 * View state for a series card in the timeline
 */
export interface SeriesViewState {
  /** Currently displayed episode number */
  currentEpisode: number;
  /** Whether the episode list (TOC) is expanded */
  expandedTOC: boolean;
}

/**
 * Persisted series state in plugin settings
 * Maps seriesId to the last viewed episode number
 */
export type SeriesCurrentEpisodeState = Record<string, number>;

/**
 * Type guard to check if an item is a SeriesGroup
 */
export function isSeriesGroup(item: unknown): item is SeriesGroup {
  return (
    typeof item === 'object' &&
    item !== null &&
    'seriesId' in item &&
    'episodes' in item &&
    Array.isArray((item as SeriesGroup).episodes)
  );
}

/**
 * Extract a short excerpt from markdown content
 * Strips frontmatter, images, links, and truncates
 */
export function extractExcerpt(content: string, maxLength: number = 100): string {
  // Remove frontmatter
  let text = content.replace(/^---[\s\S]*?---\n*/m, '');

  // Remove images
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');

  // Remove inline images
  text = text.replace(/!\[\[.*?\]\]/g, '');

  // Convert links to just text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove wiki links
  text = text.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1');

  // Remove headers
  text = text.replace(/^#+\s*/gm, '');

  // Remove bold/italic
  text = text.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Truncate with ellipsis
  if (text.length > maxLength) {
    text = text.substring(0, maxLength - 3) + '...';
  }

  return text;
}
