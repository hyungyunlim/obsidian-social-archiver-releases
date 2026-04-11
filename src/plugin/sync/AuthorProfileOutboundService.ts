import type { App, EventRef, TFile } from 'obsidian';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { AuthorNoteService } from '../../services/AuthorNoteService';
import type { SocialArchiverSettings } from '../../types/settings';

const DEBOUNCE_MS = 1500;
const SUPPRESSION_TTL_MS = 10_000;
const LOG_PREFIX = '[Social Archiver] [AuthorProfileOutbound]';

interface EditableSnapshot {
  displayNameOverride?: string | null;
  bioOverride?: string | null;
  aliases: string[];
}

function normalizeSnapshot(snapshot: EditableSnapshot): EditableSnapshot {
  return {
    displayNameOverride: snapshot.displayNameOverride?.trim() || null,
    bioOverride: snapshot.bioOverride?.trim() || null,
    aliases: Array.from(new Set((snapshot.aliases ?? []).map((value) => value.trim()).filter(Boolean))),
  };
}

function snapshotsEqual(a: EditableSnapshot, b: EditableSnapshot): boolean {
  if ((a.displayNameOverride || null) !== (b.displayNameOverride || null)) return false;
  if ((a.bioOverride || null) !== (b.bioOverride || null)) return false;
  if (a.aliases.length !== b.aliases.length) return false;
  return a.aliases.every((value, index) => value === b.aliases[index]);
}

export class AuthorProfileOutboundService {
  private metadataCacheRef: EventRef | null = null;
  private readonly lastKnownSnapshots = new Map<string, EditableSnapshot>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly suppressionMap = new Map<string, number>();

  constructor(
    private readonly app: App,
    private readonly apiClient: WorkersAPIClient,
    private readonly authorNoteService: AuthorNoteService,
    private readonly getSettings: () => SocialArchiverSettings,
  ) {}

  start(): void {
    if (this.metadataCacheRef) return;

    for (const file of this.authorNoteService.listNotes()) {
      const payload = this.authorNoteService.buildEditableProfilePayload(file);
      if (!payload) continue;
      this.lastKnownSnapshots.set(file.path, normalizeSnapshot({
        displayNameOverride: payload.displayNameOverride,
        bioOverride: payload.bioOverride,
        aliases: payload.aliases ?? [],
      }));
    }

    this.metadataCacheRef = this.app.metadataCache.on('changed', (file: TFile) => {
      this.onMetadataChanged(file);
    });
  }

  stop(): void {
    if (this.metadataCacheRef) {
      this.app.metadataCache.offref(this.metadataCacheRef);
      this.metadataCacheRef = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  addSuppression(authorKey: string): void {
    this.suppressionMap.set(authorKey, Date.now());
  }

  isSuppressed(authorKey: string): boolean {
    const timestamp = this.suppressionMap.get(authorKey);
    if (timestamp === undefined) return false;
    if (Date.now() - timestamp > SUPPRESSION_TTL_MS) {
      this.suppressionMap.delete(authorKey);
      return false;
    }
    return true;
  }

  private onMetadataChanged(file: TFile): void {
    const payload = this.authorNoteService.buildEditableProfilePayload(file);
    if (!payload) return;

    const currentSnapshot = normalizeSnapshot({
      displayNameOverride: payload.displayNameOverride,
      bioOverride: payload.bioOverride,
      aliases: payload.aliases ?? [],
    });

    const previousSnapshot = this.lastKnownSnapshots.get(file.path);
    if (!previousSnapshot) {
      this.lastKnownSnapshots.set(file.path, currentSnapshot);
      const hasUserFields = !!(
        currentSnapshot.displayNameOverride ||
        currentSnapshot.bioOverride ||
        currentSnapshot.aliases.length > 0
      );
      if (!hasUserFields) return;
    }

    if (previousSnapshot && snapshotsEqual(currentSnapshot, previousSnapshot)) return;
    if (this.isSuppressed(payload.authorKey)) return;

    const existingTimer = this.debounceTimers.get(file.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(file.path);
      void this.syncFile(file).catch((error) => {
        console.error(`${LOG_PREFIX} Sync failed for ${file.path}:`, error instanceof Error ? error.message : String(error));
      });
    }, DEBOUNCE_MS);

    this.debounceTimers.set(file.path, timer);
  }

  private async syncFile(file: TFile): Promise<void> {
    const settings = this.getSettings();
    if (!settings.authToken || !settings.syncClientId) return;

    const payload = this.authorNoteService.buildEditableProfilePayload(file);
    if (!payload) return;

    const snapshot = normalizeSnapshot({
      displayNameOverride: payload.displayNameOverride,
      bioOverride: payload.bioOverride,
      aliases: payload.aliases ?? [],
    });
    const previous = this.lastKnownSnapshots.get(file.path);
    if (previous && snapshotsEqual(snapshot, previous)) return;

    await this.apiClient.upsertUserAuthorProfiles([payload], settings.syncClientId);
    this.lastKnownSnapshots.set(file.path, snapshot);
    this.addSuppression(payload.authorKey);
  }
}
