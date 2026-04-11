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
    for (const profile of profiles) {
      this.beforeApply?.(profile.authorKey);
      await this.authorNoteService.upsertFromSyncedProfile(profile);
    }
  }
}
