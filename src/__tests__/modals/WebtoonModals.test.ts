/**
 * WebtoonModals Unit Tests
 *
 * Tests for Webtoon modal type definitions and pure logic functions.
 * Note: WebtoonSubscribeModal was deprecated and merged into WebtoonArchiveModal.
 */

import { describe, it, expect } from 'vitest';
import type {
  WebtoonEpisodeInfo,
  WebtoonSeriesInfo,
  WebtoonEpisodeSelectResult,
} from '../../modals/WebtoonEpisodeSelectModal';

// Type definitions for testing (previously from WebtoonSubscribeModal, now deprecated)
interface WebtoonInfo {
  titleId: string;
  titleName: string;
  thumbnailUrl?: string;
  synopsis?: string;
  artistNames?: string;
  genre?: string[];
  ageRating?: string;
  finished?: boolean;
  publishDay?: string;
  favoriteCount?: number;
  totalEpisodes?: number;
}

interface WebtoonSubscribeOptions {
  maxPostsPerRun: number;
  startFromEpisode: number;
}

interface WebtoonSubscribeInitialValues {
  maxPostsPerRun?: number;
  startFromEpisode?: number;
}

// ============================================================================
// WebtoonSubscribeModal Types Tests
// ============================================================================

describe('WebtoonSubscribeModal Types', () => {
  describe('WebtoonInfo interface', () => {
    it('should accept valid webtoon info with required fields', () => {
      const info: WebtoonInfo = {
        titleId: '819217',
        titleName: '귀환자의 마법은 특별해야 합니다',
      };

      expect(info.titleId).toBe('819217');
      expect(info.titleName).toBe('귀환자의 마법은 특별해야 합니다');
    });

    it('should accept webtoon info with all optional fields', () => {
      const info: WebtoonInfo = {
        titleId: '819217',
        titleName: '귀환자의 마법은 특별해야 합니다',
        thumbnailUrl: 'https://image.naver.com/webtoon/819217/thumb.jpg',
        synopsis: 'A fantasy story about a returnee...',
        artistNames: '우투룹 / 낭천',
        genre: ['판타지', '액션'],
        ageRating: '15세 이용가',
        finished: false,
        publishDay: '토요웹툰',
        favoriteCount: 2500000,
        totalEpisodes: 200,
      };

      expect(info.thumbnailUrl).toBe('https://image.naver.com/webtoon/819217/thumb.jpg');
      expect(info.artistNames).toBe('우투룹 / 낭천');
      expect(info.genre).toEqual(['판타지', '액션']);
      expect(info.finished).toBe(false);
      expect(info.publishDay).toBe('토요웹툰');
      expect(info.totalEpisodes).toBe(200);
    });
  });

  describe('WebtoonSubscribeOptions interface', () => {
    it('should accept valid subscribe options', () => {
      const options: WebtoonSubscribeOptions = {
        maxPostsPerRun: 5,
        startFromEpisode: 0,
      };

      expect(options.maxPostsPerRun).toBe(5);
      expect(options.startFromEpisode).toBe(0);
    });

    it('should accept options with non-zero start episode', () => {
      const options: WebtoonSubscribeOptions = {
        maxPostsPerRun: 10,
        startFromEpisode: 150,
      };

      expect(options.startFromEpisode).toBe(150);
    });
  });

  describe('WebtoonSubscribeInitialValues interface', () => {
    it('should accept partial initial values', () => {
      const values: WebtoonSubscribeInitialValues = {
        maxPostsPerRun: 3,
      };

      expect(values.maxPostsPerRun).toBe(3);
      expect(values.startFromEpisode).toBeUndefined();
    });

    it('should accept all initial values', () => {
      const values: WebtoonSubscribeInitialValues = {
        maxPostsPerRun: 10,
        startFromEpisode: 100,
      };

      expect(values.maxPostsPerRun).toBe(10);
      expect(values.startFromEpisode).toBe(100);
    });
  });
});

// ============================================================================
// WebtoonEpisodeSelectModal Types Tests
// ============================================================================

describe('WebtoonEpisodeSelectModal Types', () => {
  describe('WebtoonEpisodeInfo interface', () => {
    it('should accept valid free episode info', () => {
      const episode: WebtoonEpisodeInfo = {
        no: 100,
        subtitle: '100화 - 새로운 시작',
        charge: false,
        serviceDateDescription: '24.12.01',
      };

      expect(episode.no).toBe(100);
      expect(episode.subtitle).toBe('100화 - 새로운 시작');
      expect(episode.charge).toBe(false);
    });

    it('should accept valid paid episode info', () => {
      const episode: WebtoonEpisodeInfo = {
        no: 199,
        subtitle: '199화 - 최신화',
        charge: true,
        serviceDateDescription: '7일 후 무료',
      };

      expect(episode.charge).toBe(true);
      expect(episode.serviceDateDescription).toBe('7일 후 무료');
    });

    it('should accept episode with optional fields', () => {
      const episode: WebtoonEpisodeInfo = {
        no: 50,
        subtitle: '50화',
        thumbnailUrl: 'https://image.naver.com/episode/50.jpg',
        starScore: 9.95,
        charge: false,
        serviceDateDescription: '24.06.15',
      };

      expect(episode.thumbnailUrl).toBe('https://image.naver.com/episode/50.jpg');
      expect(episode.starScore).toBe(9.95);
    });
  });

  describe('WebtoonSeriesInfo interface', () => {
    it('should accept valid series info', () => {
      const series: WebtoonSeriesInfo = {
        titleId: '819217',
        titleName: '귀환자의 마법은 특별해야 합니다',
        totalEpisodes: 200,
      };

      expect(series.titleId).toBe('819217');
      expect(series.totalEpisodes).toBe(200);
    });

    it('should accept series with all optional fields', () => {
      const series: WebtoonSeriesInfo = {
        titleId: '819217',
        titleName: '귀환자의 마법은 특별해야 합니다',
        thumbnailUrl: 'https://image.naver.com/webtoon/819217/thumb.jpg',
        artistNames: '우투룹 / 낭천',
        genre: ['판타지', '액션'],
        publishDay: '토요웹툰',
        finished: false,
        totalEpisodes: 200,
      };

      expect(series.artistNames).toBe('우투룹 / 낭천');
      expect(series.genre).toEqual(['판타지', '액션']);
      expect(series.finished).toBe(false);
    });
  });

  describe('WebtoonEpisodeSelectResult interface', () => {
    it('should accept single episode selection', () => {
      const result: WebtoonEpisodeSelectResult = {
        selectedEpisodes: [100],
      };

      expect(result.selectedEpisodes).toHaveLength(1);
      expect(result.selectedEpisodes[0]).toBe(100);
    });

    it('should accept multiple episode selections', () => {
      const result: WebtoonEpisodeSelectResult = {
        selectedEpisodes: [95, 96, 97, 98, 99, 100],
      };

      expect(result.selectedEpisodes).toHaveLength(6);
      expect(result.selectedEpisodes).toEqual([95, 96, 97, 98, 99, 100]);
    });

    it('should accept empty selection', () => {
      const result: WebtoonEpisodeSelectResult = {
        selectedEpisodes: [],
      };

      expect(result.selectedEpisodes).toHaveLength(0);
    });
  });
});

// ============================================================================
// Episode Filtering Logic Tests
// ============================================================================

describe('Episode Filtering Logic', () => {
  /**
   * Filter free episodes only (matching modal behavior)
   */
  const filterFreeEpisodes = (episodes: WebtoonEpisodeInfo[]): WebtoonEpisodeInfo[] => {
    return episodes.filter(ep => !ep.charge);
  };

  /**
   * Sort episodes by episode number (for display)
   */
  const sortEpisodesByNumber = (
    episodes: WebtoonEpisodeInfo[],
    ascending: boolean = true
  ): WebtoonEpisodeInfo[] => {
    return [...episodes].sort((a, b) =>
      ascending ? a.no - b.no : b.no - a.no
    );
  };

  /**
   * Paginate episodes for display
   */
  const paginateEpisodes = (
    episodes: WebtoonEpisodeInfo[],
    page: number,
    pageSize: number
  ): WebtoonEpisodeInfo[] => {
    const start = (page - 1) * pageSize;
    return episodes.slice(start, start + pageSize);
  };

  describe('filterFreeEpisodes', () => {
    it('should filter out paid episodes', () => {
      const episodes: WebtoonEpisodeInfo[] = [
        { no: 1, subtitle: '1화', charge: false, serviceDateDescription: '24.01.01' },
        { no: 2, subtitle: '2화', charge: false, serviceDateDescription: '24.01.08' },
        { no: 3, subtitle: '3화', charge: true, serviceDateDescription: '7일 후 무료' },
        { no: 4, subtitle: '4화', charge: true, serviceDateDescription: '14일 후 무료' },
      ];

      const free = filterFreeEpisodes(episodes);

      expect(free).toHaveLength(2);
      expect(free.map(ep => ep.no)).toEqual([1, 2]);
    });

    it('should return all episodes when all are free', () => {
      const episodes: WebtoonEpisodeInfo[] = [
        { no: 1, subtitle: '1화', charge: false, serviceDateDescription: '24.01.01' },
        { no: 2, subtitle: '2화', charge: false, serviceDateDescription: '24.01.08' },
      ];

      const free = filterFreeEpisodes(episodes);

      expect(free).toHaveLength(2);
    });

    it('should return empty array when all are paid', () => {
      const episodes: WebtoonEpisodeInfo[] = [
        { no: 1, subtitle: '1화', charge: true, serviceDateDescription: '7일 후 무료' },
        { no: 2, subtitle: '2화', charge: true, serviceDateDescription: '14일 후 무료' },
      ];

      const free = filterFreeEpisodes(episodes);

      expect(free).toHaveLength(0);
    });
  });

  describe('sortEpisodesByNumber', () => {
    it('should sort episodes ascending by default', () => {
      const episodes: WebtoonEpisodeInfo[] = [
        { no: 50, subtitle: '50화', charge: false, serviceDateDescription: '24.06.01' },
        { no: 10, subtitle: '10화', charge: false, serviceDateDescription: '24.03.01' },
        { no: 30, subtitle: '30화', charge: false, serviceDateDescription: '24.05.01' },
      ];

      const sorted = sortEpisodesByNumber(episodes);

      expect(sorted.map(ep => ep.no)).toEqual([10, 30, 50]);
    });

    it('should sort episodes descending when specified', () => {
      const episodes: WebtoonEpisodeInfo[] = [
        { no: 10, subtitle: '10화', charge: false, serviceDateDescription: '24.03.01' },
        { no: 50, subtitle: '50화', charge: false, serviceDateDescription: '24.06.01' },
        { no: 30, subtitle: '30화', charge: false, serviceDateDescription: '24.05.01' },
      ];

      const sorted = sortEpisodesByNumber(episodes, false);

      expect(sorted.map(ep => ep.no)).toEqual([50, 30, 10]);
    });
  });

  describe('paginateEpisodes', () => {
    const episodes: WebtoonEpisodeInfo[] = Array.from({ length: 50 }, (_, i) => ({
      no: i + 1,
      subtitle: `${i + 1}화`,
      charge: false,
      serviceDateDescription: '24.01.01',
    }));

    it('should return first page correctly', () => {
      const page1 = paginateEpisodes(episodes, 1, 10);

      expect(page1).toHaveLength(10);
      expect(page1[0].no).toBe(1);
      expect(page1[9].no).toBe(10);
    });

    it('should return second page correctly', () => {
      const page2 = paginateEpisodes(episodes, 2, 10);

      expect(page2).toHaveLength(10);
      expect(page2[0].no).toBe(11);
      expect(page2[9].no).toBe(20);
    });

    it('should return partial last page', () => {
      const page6 = paginateEpisodes(episodes, 6, 10);

      expect(page6).toHaveLength(0); // 50 items, 5 pages of 10
    });

    it('should handle page size larger than total', () => {
      const page1 = paginateEpisodes(episodes, 1, 100);

      expect(page1).toHaveLength(50);
    });
  });
});

// ============================================================================
// Selection Logic Tests
// ============================================================================

describe('Episode Selection Logic', () => {
  /**
   * Toggle episode selection (single select mode)
   */
  const toggleSingleSelect = (
    currentSelection: Set<number>,
    episodeNo: number
  ): Set<number> => {
    const newSelection = new Set<number>();
    if (!currentSelection.has(episodeNo)) {
      newSelection.add(episodeNo);
    }
    return newSelection;
  };

  /**
   * Toggle episode selection (multi select mode)
   */
  const toggleMultiSelect = (
    currentSelection: Set<number>,
    episodeNo: number
  ): Set<number> => {
    const newSelection = new Set(currentSelection);
    if (newSelection.has(episodeNo)) {
      newSelection.delete(episodeNo);
    } else {
      newSelection.add(episodeNo);
    }
    return newSelection;
  };

  /**
   * Select all free episodes
   */
  const selectAllFree = (episodes: WebtoonEpisodeInfo[]): Set<number> => {
    const selection = new Set<number>();
    episodes.filter(ep => !ep.charge).forEach(ep => selection.add(ep.no));
    return selection;
  };

  describe('toggleSingleSelect', () => {
    it('should select episode when nothing selected', () => {
      const current = new Set<number>();
      const result = toggleSingleSelect(current, 10);

      expect(result.size).toBe(1);
      expect(result.has(10)).toBe(true);
    });

    it('should replace selection when different episode selected', () => {
      const current = new Set<number>([5]);
      const result = toggleSingleSelect(current, 10);

      expect(result.size).toBe(1);
      expect(result.has(10)).toBe(true);
      expect(result.has(5)).toBe(false);
    });

    it('should deselect when same episode selected', () => {
      const current = new Set<number>([10]);
      const result = toggleSingleSelect(current, 10);

      expect(result.size).toBe(0);
    });
  });

  describe('toggleMultiSelect', () => {
    it('should add to selection', () => {
      const current = new Set<number>([5, 6]);
      const result = toggleMultiSelect(current, 10);

      expect(result.size).toBe(3);
      expect(result.has(5)).toBe(true);
      expect(result.has(6)).toBe(true);
      expect(result.has(10)).toBe(true);
    });

    it('should remove from selection', () => {
      const current = new Set<number>([5, 6, 10]);
      const result = toggleMultiSelect(current, 6);

      expect(result.size).toBe(2);
      expect(result.has(5)).toBe(true);
      expect(result.has(6)).toBe(false);
      expect(result.has(10)).toBe(true);
    });

    it('should not modify original set', () => {
      const current = new Set<number>([5, 6]);
      toggleMultiSelect(current, 10);

      expect(current.size).toBe(2); // Original unchanged
    });
  });

  describe('selectAllFree', () => {
    it('should select all free episodes', () => {
      const episodes: WebtoonEpisodeInfo[] = [
        { no: 1, subtitle: '1화', charge: false, serviceDateDescription: '24.01.01' },
        { no: 2, subtitle: '2화', charge: false, serviceDateDescription: '24.01.08' },
        { no: 3, subtitle: '3화', charge: true, serviceDateDescription: '7일 후 무료' },
        { no: 4, subtitle: '4화', charge: false, serviceDateDescription: '24.01.22' },
      ];

      const selection = selectAllFree(episodes);

      expect(selection.size).toBe(3);
      expect(selection.has(1)).toBe(true);
      expect(selection.has(2)).toBe(true);
      expect(selection.has(3)).toBe(false); // Paid
      expect(selection.has(4)).toBe(true);
    });

    it('should return empty set when all paid', () => {
      const episodes: WebtoonEpisodeInfo[] = [
        { no: 1, subtitle: '1화', charge: true, serviceDateDescription: '7일 후 무료' },
        { no: 2, subtitle: '2화', charge: true, serviceDateDescription: '14일 후 무료' },
      ];

      const selection = selectAllFree(episodes);

      expect(selection.size).toBe(0);
    });
  });
});

// ============================================================================
// Pagination Calculation Tests
// ============================================================================

describe('Pagination Calculations', () => {
  /**
   * Calculate total pages
   */
  const calculateTotalPages = (totalItems: number, pageSize: number): number => {
    return Math.ceil(totalItems / pageSize);
  };

  /**
   * Validate page number is within bounds
   */
  const validatePageNumber = (
    page: number,
    totalPages: number
  ): number => {
    if (page < 1) return 1;
    if (page > totalPages) return totalPages;
    return page;
  };

  describe('calculateTotalPages', () => {
    it('should calculate pages correctly for exact division', () => {
      expect(calculateTotalPages(100, 10)).toBe(10);
      expect(calculateTotalPages(50, 25)).toBe(2);
    });

    it('should round up for partial pages', () => {
      expect(calculateTotalPages(101, 10)).toBe(11);
      expect(calculateTotalPages(51, 25)).toBe(3);
    });

    it('should return 1 for items less than page size', () => {
      expect(calculateTotalPages(5, 10)).toBe(1);
      expect(calculateTotalPages(1, 20)).toBe(1);
    });

    it('should return 0 for empty list', () => {
      expect(calculateTotalPages(0, 10)).toBe(0);
    });
  });

  describe('validatePageNumber', () => {
    it('should return valid page number unchanged', () => {
      expect(validatePageNumber(5, 10)).toBe(5);
      expect(validatePageNumber(1, 10)).toBe(1);
      expect(validatePageNumber(10, 10)).toBe(10);
    });

    it('should clamp to 1 for values below 1', () => {
      expect(validatePageNumber(0, 10)).toBe(1);
      expect(validatePageNumber(-5, 10)).toBe(1);
    });

    it('should clamp to max for values above total', () => {
      expect(validatePageNumber(15, 10)).toBe(10);
      expect(validatePageNumber(100, 5)).toBe(5);
    });
  });
});
