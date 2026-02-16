/**
 * SeriesGroupingService - Groups posts by series for timeline display
 *
 * Features:
 * - Groups posts by seriesId from frontmatter
 * - Separates series groups from standalone posts
 * - Manages current episode state (persisted in plugin settings)
 * - Provides type-safe series data structures
 */

import type { App, TFile } from 'obsidian';
import type { PostData } from '../types/post';
import type { YamlFrontmatter } from '../types/archive';
import type { SeriesGroup, SeriesEpisode, SeriesCurrentEpisodeState } from '../types/series';
import { extractExcerpt } from '../types/series';

/**
 * Result of separating posts into series and standalone
 */
export interface SeparatedPosts {
  /** Array of series groups with 2+ episodes */
  series: SeriesGroup[];
  /** Array of standalone posts (not part of series or single-episode series) */
  standalone: PostData[];
}

/**
 * A combined item that can be either a PostData or SeriesGroup
 */
export type TimelineItem = PostData | SeriesGroup;

/**
 * Type guard to check if item is a SeriesGroup
 */
export function isSeriesGroup(item: TimelineItem): item is SeriesGroup {
  return (
    'seriesId' in item &&
    'episodes' in item &&
    Array.isArray((item as SeriesGroup).episodes)
  );
}

/**
 * SeriesGroupingService - Manages series grouping for timeline display
 */
export class SeriesGroupingService {
  private app: App;
  private seriesCurrentEpisode: SeriesCurrentEpisodeState;
  private onStateChange: (state: SeriesCurrentEpisodeState) => void;

  constructor(
    app: App,
    initialState: SeriesCurrentEpisodeState,
    onStateChange: (state: SeriesCurrentEpisodeState) => void
  ) {
    this.app = app;
    this.seriesCurrentEpisode = initialState;
    this.onStateChange = onStateChange;
  }

  /**
   * Update the state from external source (e.g., after settings load)
   */
  updateState(state: SeriesCurrentEpisodeState): void {
    this.seriesCurrentEpisode = state;
  }

  /**
   * Get current episode for a series (1-based)
   */
  getCurrentEpisode(seriesId: string): number {
    return this.seriesCurrentEpisode[seriesId] ?? 1;
  }

  /**
   * Set current episode for a series and persist
   */
  setCurrentEpisode(seriesId: string, episode: number): void {
    this.seriesCurrentEpisode[seriesId] = episode;
    this.onStateChange(this.seriesCurrentEpisode);
  }

  /**
   * Get frontmatter for a file using MetadataCache
   */
  private getFrontmatter(file: TFile): YamlFrontmatter | null {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter as YamlFrontmatter | null;
  }

  /**
   * Get file content for excerpt extraction
   */
  private async getFileContent(file: TFile): Promise<string> {
    return await this.app.vault.cachedRead(file);
  }

  /**
   * Separate posts into series and standalone
   *
   * @param posts - Array of PostData from timeline
   * @returns Object with series groups and standalone posts
   */
  async separateSeriesAndPosts(posts: PostData[]): Promise<SeparatedPosts> {
    // Group posts by seriesId
    const seriesMap = new Map<string, {
      seriesTitle: string;
      seriesUrl?: string;
      platform: string;
      author: string;
      authorUrl?: string;
      publishDay?: string;
      episodes: Array<{
        episode: number;
        post: PostData;
        file: TFile;
        title: string;
        published: string;
        archived: string;
        isRead: boolean;
        starScore?: number;
        isLiked?: boolean;
      }>;
    }>();

    const standalonePosts: PostData[] = [];

    for (const post of posts) {
      // Get file reference
      const file = post.filePath ? this.app.vault.getFileByPath(post.filePath) : null;
      if (!file) {
        standalonePosts.push(post);
        continue;
      }

      // Get frontmatter for series info
      const frontmatter = this.getFrontmatter(file);
      if (!frontmatter) {
        standalonePosts.push(post);
        continue;
      }

      // Check for series fields (support both naming conventions)
      // - Instagram/others: series, episode
      // - Brunch: seriesTitle, seriesEpisode
      // Note: seriesId may be a number in YAML (e.g., 812354), so convert to string
      const rawSeriesId = (frontmatter as any).seriesId;
      const seriesId = rawSeriesId != null ? String(rawSeriesId) : undefined;
      const seriesTitle = ((frontmatter as any).series || (frontmatter as any).seriesTitle) as string | undefined;
      let seriesUrl = (frontmatter as any).seriesUrl as string | undefined;
      const episode = ((frontmatter as any).episode ?? (frontmatter as any).seriesEpisode) as number | undefined;

      // Fallback: extract seriesUrl from author_url or episode url for WEBTOON Global
      // This handles files created before seriesUrl was added to frontmatter
      if (!seriesUrl && post.platform === 'webtoons') {
        const authorUrl = (frontmatter as any).author_url as string | undefined;
        const episodeUrl = (frontmatter as any).url as string | undefined;

        // author_url is typically the series URL for webtoons
        if (authorUrl && authorUrl.includes('webtoons.com')) {
          seriesUrl = authorUrl;
        }
        // Or extract from episode URL: https://www.webtoons.com/en/canvas/slug/episode-1/viewer?title_no=X
        else if (episodeUrl && episodeUrl.includes('webtoons.com')) {
          const match = episodeUrl.match(/(https:\/\/www\.webtoons\.com\/[^/]+\/[^/]+\/[^/]+)\/[^/]+\/viewer/);
          if (match) {
            seriesUrl = `${match[1]}/list?title_no=${seriesId}`;
          }
        }
      }

      // If no seriesId, it's a standalone post
      if (!seriesId || episode === undefined) {
        standalonePosts.push(post);
        continue;
      }

      // Extract additional metadata from frontmatter
      const starScore = (frontmatter as any).starScore as number | undefined;
      const isLiked = (frontmatter as any).like === true;
      const isRead = (frontmatter as any).read === true;
      const publishDay = (frontmatter as any).publishDay as string | undefined;

      // Add to series map
      if (!seriesMap.has(seriesId)) {
        seriesMap.set(seriesId, {
          seriesTitle: seriesTitle || 'Unknown Series',
          seriesUrl,
          platform: post.platform,
          author: post.author.name,
          authorUrl: post.author.url,
          publishDay,
          episodes: []
        });
      }

      const series = seriesMap.get(seriesId)!;

      series.episodes.push({
        episode,
        post,
        file,
        title: post.title || `Episode ${episode}`,
        published: frontmatter.published || '',
        archived: frontmatter.archived || '',
        isRead: isRead,
        starScore: starScore,
        isLiked: isLiked
      });
    }

    // Convert series map to SeriesGroup array
    const seriesGroups: SeriesGroup[] = [];

    for (const [seriesId, data] of seriesMap) {
      // Webtoons always get series view (even with 1 episode)
      // Other platforms need 2+ episodes to form a series group
      const isWebtoon = data.platform === 'naver-webtoon' || data.platform === 'webtoons';
      const minEpisodesForSeries = isWebtoon ? 1 : 2;

      if (data.episodes.length < minEpisodesForSeries) {
        // Single episode series treated as standalone (non-webtoon only)
        for (const ep of data.episodes) {
          standalonePosts.push(ep.post);
        }
        continue;
      }

      // Deduplicate episodes by episode number (keep the one with most recent archived date)
      // This prevents duplicates when streaming creates a file and background download updates it
      const episodeMap = new Map<number, typeof data.episodes[0]>();
      for (const ep of data.episodes) {
        const existing = episodeMap.get(ep.episode);
        if (!existing) {
          episodeMap.set(ep.episode, ep);
        } else {
          // Keep the one with more recent archived date, or the one with more media
          const existingArchived = new Date(existing.archived || 0).getTime();
          const currentArchived = new Date(ep.archived || 0).getTime();
          if (currentArchived > existingArchived) {
            episodeMap.set(ep.episode, ep);
          }
        }
      }
      data.episodes = Array.from(episodeMap.values());

      // Sort episodes by episode number
      data.episodes.sort((a, b) => a.episode - b.episode);

      // Get excerpts for all episodes
      const episodes: SeriesEpisode[] = await Promise.all(
        data.episodes.map(async (ep) => {
          const content = await this.getFileContent(ep.file);
          const excerpt = extractExcerpt(content);

          return {
            episode: ep.episode,
            file: ep.file,
            title: ep.title,
            excerpt,
            published: ep.published,
            archived: ep.archived,
            isRead: ep.isRead,
            filePath: ep.file.path,
            starScore: ep.starScore,
            isLiked: ep.isLiked
          };
        })
      );

      // Find latest published date for timeline positioning
      const latestPublished = data.episodes.reduce((latest, ep) => {
        if (!latest) return ep.published;
        return ep.published > latest ? ep.published : latest;
      }, '');

      // Find latest archived date for timeline positioning (when sorting by archived)
      const latestArchived = data.episodes.reduce((latest, ep) => {
        if (!latest) return ep.archived;
        return ep.archived > latest ? ep.archived : latest;
      }, '');

      // Get current episode from state
      const storedEpisode = this.getCurrentEpisode(seriesId);

      // Check if the stored episode number exists in the episodes list
      // (episode might have been deleted)
      const episodeExists = episodes.some(ep => ep.episode === storedEpisode);
      const validCurrentEpisode = episodeExists
        ? storedEpisode
        : episodes[0]?.episode ?? 1;

      // Update stored state if episode was invalid
      if (!episodeExists && validCurrentEpisode !== storedEpisode) {
        this.setCurrentEpisode(seriesId, validCurrentEpisode);
      }

      seriesGroups.push({
        seriesId,
        seriesTitle: data.seriesTitle,
        seriesUrl: data.seriesUrl,
        platform: data.platform,
        author: data.author,
        authorUrl: data.authorUrl,
        publishDay: data.publishDay,
        episodes,
        currentEpisode: validCurrentEpisode,
        latestPublished,
        latestArchived
      });
    }

    return { series: seriesGroups, standalone: standalonePosts };
  }

  /**
   * Get PostData for a specific episode in a series
   * Useful for rendering the current episode content
   */
  getEpisodePostData(series: SeriesGroup, episodeNumber: number): PostData | null {
    const episode = series.episodes.find(ep => ep.episode === episodeNumber);
    if (!episode) return null;

    // Find the original PostData from the file
    const file = this.app.vault.getFileByPath(episode.filePath);
    if (!file) return null;

    // The PostData is not stored in SeriesGroup, caller should cache it
    return null;
  }

  /**
   * Get the reference date for a series (for timeline positioning)
   * Uses the latest episode's published date
   */
  getSeriesDate(series: SeriesGroup): Date {
    return new Date(series.latestPublished || Date.now());
  }
}
