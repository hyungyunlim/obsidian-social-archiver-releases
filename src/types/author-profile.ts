import type { Platform } from './post';

export interface UserAuthorProfile {
  authorKey: string;
  platform: Platform;
  authorName: string;
  authorUrl?: string | null;
  authorHandle?: string | null;
  displayNameOverride?: string | null;
  bioOverride?: string | null;
  fetchedBio?: string | null;
  fetchedBioUpdatedAt?: string | null;
  fetchedBioSource?: string | null;
  fetchedAvatarUrl?: string | null;
  fetchedAvatarR2Key?: string | null;
  fetchedAvatarUpdatedAt?: string | null;
  avatarPreservationStatus?: string | null;
  aliases: string[];
  updatedAt: string;
}

export interface AuthorProfileUpsertInput {
  authorKey: string;
  platform: Platform;
  authorName: string;
  authorUrl?: string | null;
  authorHandle?: string | null;
  displayNameOverride?: string | null;
  bioOverride?: string | null;
  aliases?: string[];
}

export interface AuthorProfileSystemUpsertInput {
  authorKey: string;
  platform: Platform;
  authorName: string;
  authorUrl?: string | null;
  authorHandle?: string | null;
  fetchedBio?: string | null;
  fetchedBioSource?: string | null;
  fetchedBioUpdatedAt?: string | null;
  fetchedAvatarUrl?: string | null;
  fetchedAvatarUpdatedAt?: string | null;
}
