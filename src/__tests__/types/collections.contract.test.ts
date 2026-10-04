/**
 * Tripwire for the collections contract (workers/src/types/share-settings.ts,
 * collection-members.ts). Written out by hand on purpose, like the mobile and
 * desktop mirrors: editing a local literal without the worker contract (and
 * this file) must fail.
 */
import { describe, expect, it } from 'vitest';
import {
  COLLECTION_DISPLAY_MODES,
  COLLECTION_ID_PATTERN,
  COLLECTION_LIMITS,
  COLLECTION_MEMBER_LIMITS,
  COLLECTION_MEMBER_ROLES,
  COLLECTION_ROLES,
  COLLECTION_VISIBILITIES,
  COLLECTIONS_SHARED_CAPABILITY,
  POST_SHARE_DISPLAY_MODES,
  POST_SHARE_VISIBILITIES,
  canContribute,
  canEditDetails,
  canManage,
} from '../../types/collections';

describe('collections contract literals', () => {
  it('pins the share vocabularies', () => {
    expect([...POST_SHARE_VISIBILITIES]).toEqual(['public', 'unlisted']);
    expect([...POST_SHARE_DISPLAY_MODES]).toEqual(['card', 'reader']);
    expect([...COLLECTION_VISIBILITIES]).toEqual(['private', 'unlisted', 'public']);
    expect([...COLLECTION_DISPLAY_MODES]).toEqual(['timeline', 'list', 'media-only', 'mosaic', 'text-only', 'reader']);
  });

  it('pins roles and the role rules', () => {
    expect([...COLLECTION_ROLES]).toEqual(['owner', 'editor', 'viewer']);
    expect([...COLLECTION_MEMBER_ROLES]).toEqual(['editor', 'viewer']);
    expect(COLLECTION_ROLES.map(canContribute)).toEqual([true, true, false]);
    expect(COLLECTION_ROLES.map(canEditDetails)).toEqual([true, true, false]);
    expect(COLLECTION_ROLES.map(canManage)).toEqual([true, false, false]);
  });

  it('pins the limits the plugin enforces', () => {
    expect(COLLECTION_LIMITS).toEqual({
      maxCollectionsPerUser: 1000,
      maxItemsPerCollection: 5000,
      nameMaxLength: 60,
      descriptionMaxLength: 500,
      maxCollectionsPerUpsert: 100,
      maxPairsPerRequest: 500,
    });
    expect(COLLECTION_MEMBER_LIMITS).toEqual({
      maxMembersPerCollection: 50,
      maxActiveInvitesPerCollection: 20,
      inviteDefaultExpiryDays: 7,
      inviteMaxExpiryDays: 30,
      memberViewDefaultLimit: 30,
      memberViewMaxLimit: 50,
    });
  });

  it('pins the id pattern and the capability', () => {
    expect(COLLECTION_ID_PATTERN.source).toBe('^[A-Za-z0-9_-]{8,64}$');
    expect(COLLECTION_ID_PATTERN.test(crypto.randomUUID())).toBe(true);
    expect(COLLECTIONS_SHARED_CAPABILITY).toBe('collections-shared-v1');
  });
});
