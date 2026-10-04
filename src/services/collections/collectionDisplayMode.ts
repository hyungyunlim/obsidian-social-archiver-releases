import type { TimelineViewMode } from '../../types/settings';
import type { CollectionDisplayMode, PostShareDisplayMode } from '../../types/collections';

/**
 * The timeline's view as the share page's first view (prd-collections-obsidian-plugin §4.3).
 * The plugin has three views; the share page has six. Gallery is the media grid.
 */
export function toCollectionDisplayMode(viewMode: TimelineViewMode, readerOpen = false): CollectionDisplayMode {
  if (readerOpen) return 'reader';
  if (viewMode === 'gallery') return 'media-only';
  if (viewMode === 'mosaic') return 'mosaic';
  return 'timeline';
}

/** A new post share opens as the card, or straight in the reader when links are copied in reader mode. */
export function toPostShareDisplayMode(copyShareLinkAsReaderMode: boolean): PostShareDisplayMode {
  return copyShareLinkAsReaderMode ? 'reader' : 'card';
}
