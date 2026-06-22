import type { ArchiveAttempt, Platform, PostData } from '../types/post';
import { PLATFORMS } from '@shared/platforms/types';

const KNOWN_PLATFORMS = new Set<string>(PLATFORMS);

function getHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizeAttemptPlatform(platform: string | null | undefined): Platform {
  if (platform && KNOWN_PLATFORMS.has(platform)) {
    return platform as Platform;
  }
  return 'web';
}

export function isLimitedArchiveAttempt(attempt: Pick<ArchiveAttempt, 'errorCode' | 'errorMessage' | 'errorCategory'>): boolean {
  const code = (attempt.errorCode ?? '').toUpperCase();
  const message = (attempt.errorMessage ?? '').toLowerCase();
  return (
    code === 'LIMITED_ARCHIVE' ||
    (attempt.errorCategory === 'crawler' && (message.includes('access denied') || message.includes('403'))) ||
    message.includes('limited archive')
  );
}

export function isFailedArchiveAttemptPost(post: Pick<PostData, 'failedArchiveAttempt'>): boolean {
  return Boolean(post.failedArchiveAttempt);
}

export function archiveAttemptToPostData(attempt: ArchiveAttempt): PostData {
  const url = attempt.normalizedUrl ?? attempt.originalUrl;
  const hostname = getHostname(url);
  const siteLabel = attempt.siteName?.trim() || hostname || attempt.originalUrl;
  const title = attempt.title?.trim() || siteLabel;
  const body = attempt.description?.trim() || attempt.errorMessage?.trim() || attempt.originalUrl;
  const timestamp = new Date(attempt.createdAt);
  const media = attempt.imageUrl
    ? [{
      type: 'image' as const,
      url: attempt.imageUrl,
      thumbnail: attempt.imageUrl,
    }]
    : [];

  return {
    platform: normalizeAttemptPlatform(attempt.platform),
    id: `failed_attempt:${attempt.id}`,
    url,
    author: {
      name: siteLabel,
      url,
      avatar: attempt.faviconUrl ?? undefined,
    },
    content: {
      text: body,
    },
    media,
    metadata: {
      timestamp,
    },
    title,
    thumbnail: attempt.imageUrl ?? undefined,
    archive: false,
    like: false,
    publishedDate: undefined,
    archivedDate: timestamp,
    originalUrl: attempt.originalUrl,
    failedArchiveAttempt: {
      attemptId: attempt.id,
      status: attempt.status,
      errorCode: attempt.errorCode,
      errorCategory: attempt.errorCategory,
      errorMessage: attempt.errorMessage,
      failureStage: attempt.failureStage,
      isLimitedArchive: isLimitedArchiveAttempt(attempt),
    },
  };
}

export function mergeFailedAttemptPostData(
  posts: PostData[],
  failedAttempts: PostData[],
  sortOrder: 'newest' | 'oldest' = 'newest',
): PostData[] {
  if (failedAttempts.length === 0) return posts;
  const seen = new Set<string>();
  return [...posts, ...failedAttempts]
    .filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    })
    .sort((a, b) => {
      const aTime = new Date(a.publishedDate ?? a.archivedDate ?? a.metadata.timestamp).getTime();
      const bTime = new Date(b.publishedDate ?? b.archivedDate ?? b.metadata.timestamp).getTime();
      const delta = (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      if (delta !== 0) {
        return sortOrder === 'newest' ? delta : -delta;
      }
      const keyDelta = (a.shareId || a.id || a.filePath || a.url || '')
        .localeCompare(b.shareId || b.id || b.filePath || b.url || '');
      return sortOrder === 'newest' ? -keyDelta : keyDelta;
    });
}
