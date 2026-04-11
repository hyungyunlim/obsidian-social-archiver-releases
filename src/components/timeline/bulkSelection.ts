import type { PostData } from '../../types/post';

export type BulkSelectablePost = Pick<PostData, 'archive' | 'filePath'>;

export interface BulkSelectionSummary {
  selectableCount: number;
  selectedCount: number;
  allSelected: boolean;
}

export function getBulkSelectionSelectableFilePaths(posts: BulkSelectablePost[]): string[] {
  return posts.flatMap((post) => {
    if (!post.filePath) {
      return [];
    }
    return [post.filePath];
  });
}

export function getBulkSelectionArchivableFilePaths(posts: BulkSelectablePost[]): string[] {
  return posts.flatMap((post) => {
    if (!post.filePath || post.archive) {
      return [];
    }
    return [post.filePath];
  });
}

export function normalizeBulkSelection(
  posts: BulkSelectablePost[],
  selectedPaths: Iterable<string>,
): Set<string> {
  const eligiblePaths = new Set(getBulkSelectionSelectableFilePaths(posts));

  return new Set(
    Array.from(selectedPaths).filter((filePath) => eligiblePaths.has(filePath)),
  );
}

export function getBulkSelectionSummary(
  posts: BulkSelectablePost[],
  selectedPaths: Iterable<string>,
): BulkSelectionSummary {
  const selectablePaths = getBulkSelectionSelectableFilePaths(posts);
  const normalizedSelection = normalizeBulkSelection(posts, selectedPaths);

  return {
    selectableCount: selectablePaths.length,
    selectedCount: normalizedSelection.size,
    allSelected:
      selectablePaths.length > 0 && normalizedSelection.size === selectablePaths.length,
  };
}
