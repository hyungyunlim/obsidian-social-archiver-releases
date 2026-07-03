import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthorProfileSyncService } from '@/plugin/sync/AuthorProfileSyncService';
import type { AuthorNoteService } from '@/services/AuthorNoteService';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { UserAuthorProfile } from '@/types/author-profile';

function makeProfile(overrides: Partial<UserAuthorProfile> = {}): UserAuthorProfile {
  return {
    authorKey: 'x:url:https://x.com/xguru',
    platform: 'x',
    authorName: 'xguru',
    authorUrl: 'https://x.com/xguru',
    authorHandle: 'xguru',
    aliases: [],
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AuthorProfileSyncService.applyProfiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies every profile and never throws when some fail, logging ONE summary warning', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('File already exists.'))
      .mockRejectedValueOnce(new Error('File already exists.'))
      .mockResolvedValueOnce(null);
    const authorNoteService = {
      upsertFromSyncedProfile: upsert,
    } as unknown as AuthorNoteService;
    const service = new AuthorProfileSyncService(
      {} as unknown as WorkersAPIClient,
      authorNoteService,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const profiles = [
      makeProfile({ authorKey: 'x:url:https://x.com/a' }),
      makeProfile({ authorKey: 'x:url:https://x.com/b' }),
      makeProfile({ authorKey: 'x:url:https://x.com/c' }),
      makeProfile({ authorKey: 'x:url:https://x.com/d' }),
    ];

    await expect(service.applyProfiles(profiles)).resolves.toBeUndefined();

    // Every profile is attempted despite mid-list failures.
    expect(upsert).toHaveBeenCalledTimes(4);
    // Failures collapse into one summary warning — no per-profile error spam.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('2/4');
  });

  it('logs nothing when every profile applies cleanly', async () => {
    const authorNoteService = {
      upsertFromSyncedProfile: vi.fn().mockResolvedValue(null),
    } as unknown as AuthorNoteService;
    const service = new AuthorProfileSyncService(
      {} as unknown as WorkersAPIClient,
      authorNoteService,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await service.applyProfiles([makeProfile()]);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('invokes beforeApply for each profile before upserting', async () => {
    const order: string[] = [];
    const authorNoteService = {
      upsertFromSyncedProfile: vi.fn(async (profile: UserAuthorProfile) => {
        order.push(`upsert:${profile.authorKey}`);
        return null;
      }),
    } as unknown as AuthorNoteService;
    const beforeApply = vi.fn((authorKey: string) => {
      order.push(`before:${authorKey}`);
    });
    const service = new AuthorProfileSyncService(
      {} as unknown as WorkersAPIClient,
      authorNoteService,
      beforeApply,
    );

    await service.applyProfiles([makeProfile({ authorKey: 'k1' }), makeProfile({ authorKey: 'k2' })]);

    expect(order).toEqual(['before:k1', 'upsert:k1', 'before:k2', 'upsert:k2']);
  });
});
