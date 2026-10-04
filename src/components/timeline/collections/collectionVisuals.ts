import { t, type TranslationKey } from '../../../i18n';
import type { CollectionDisplayMode, CollectionRole, CollectionVisibility, PostShareDisplayMode } from '../../../types/collections';

/** Same icons as the apps' sidebar rows (lucide). */
export const VISIBILITY_ICON: Record<CollectionVisibility, string> = {
  private: 'lock',
  unlisted: 'link',
  public: 'globe',
};

const VISIBILITY_LABEL: Record<CollectionVisibility, TranslationKey> = {
  private: 'col.visibility.private',
  unlisted: 'col.visibility.unlisted',
  public: 'col.visibility.public',
};

const VISIBILITY_HINT: Record<CollectionVisibility, TranslationKey> = {
  private: 'col.visibility.privateHint',
  unlisted: 'col.visibility.unlistedHint',
  public: 'col.visibility.publicHint',
};

const ROLE_LABEL: Record<CollectionRole, TranslationKey> = {
  owner: 'col.role.owner',
  editor: 'col.role.editor',
  viewer: 'col.role.viewer',
};

const DISPLAY_MODE_LABEL: Record<CollectionDisplayMode | PostShareDisplayMode, TranslationKey> = {
  timeline: 'col.share.mode.timeline',
  list: 'col.share.mode.list',
  'media-only': 'col.share.mode.mediaOnly',
  mosaic: 'col.share.mode.mosaic',
  'text-only': 'col.share.mode.textOnly',
  reader: 'col.share.mode.reader',
  card: 'col.share.mode.card',
};

export const visibilityLabel = (visibility: CollectionVisibility): string => t(VISIBILITY_LABEL[visibility]);
export const visibilityHint = (visibility: CollectionVisibility): string => t(VISIBILITY_HINT[visibility]);
export const roleLabel = (role: CollectionRole): string => t(ROLE_LABEL[role]);
export const displayModeLabel = (mode: CollectionDisplayMode | PostShareDisplayMode): string => t(DISPLAY_MODE_LABEL[mode]);
