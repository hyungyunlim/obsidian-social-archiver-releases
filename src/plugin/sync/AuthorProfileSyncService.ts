import type { AuthorNoteService } from '@/services/AuthorNoteService';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { UserAuthorProfile } from '@/types/author-profile';

export class AuthorProfileSyncService {
  constructor(
    private readonly apiClient: WorkersAPIClient,
    private readonly authorNoteService: AuthorNoteService,
    private readonly beforeApply?: (authorKey: string) => void,
  ) {}

  async syncAllFromServer(): Promise<void> {
    const result = await this.apiClient.getUserAuthorProfiles();
    await this.applyProfiles(result.profiles);
  }

  async applyInboundProfile(profile: UserAuthorProfile): Promise<void> {
    this.beforeApply?.(profile.authorKey);
    await this.authorNoteService.upsertFromSyncedProfile(profile);
  }

  async applyProfiles(profiles: UserAuthorProfile[]): Promise<void> {
    const failures: Array<{ authorKey: string; error: string }> = [];

    for (const profile of profiles) {
      try {
        this.beforeApply?.(profile.authorKey);
        await this.authorNoteService.upsertFromSyncedProfile(profile);
      } catch (error) {
        failures.push({
          authorKey: profile.authorKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // One summary line instead of one error per profile — a systemic cause
    // (rate limit, folder problem) otherwise floods the console every sync.
    if (failures.length > 0) {
      console.warn(
        `[AuthorProfileSync] ${failures.length}/${profiles.length} profile(s) failed to apply — skipped`,
        failures.slice(0, 5),
      );
    }
  }
}
