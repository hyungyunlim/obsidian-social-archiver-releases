import type { App, TFile } from 'obsidian';
import type { PlaceKind } from '@/shared/platforms/place-kinds';
import { LocationBodyBlock } from '@/services/markdown/LocationBodyBlock';

/**
 * Reclassify a place across the vault.
 *
 * A place is not a record anywhere in the plugin — it is an aggregate over the
 * `%% sa:locations %%` block of every note that references it. So a kind change
 * is a write to each of those notes, not one update, and `placeAggregation`
 * picks the new kind up on the next parse with nothing else to invalidate.
 *
 * The server is told too, through the same endpoint the mobile and desktop apps
 * use, so a kind set here shows up there. The vault write happens FIRST and
 * independently: the vault is what this plugin renders, and a signed-out user
 * still gets to classify their own places.
 *
 * Single Responsibility: apply one kind to one place. It owns no UI and decides
 * nothing about which kind to apply.
 */

export interface PlaceKindWriteResult {
  /** Notes actually rewritten — a note whose location already matched is not. */
  updated: number;
  /** Set when the vault write succeeded but the server did not hear about it. */
  syncError: Error | null;
}

export class PlaceKindWriter {
  constructor(
    private readonly app: App,
    private readonly sync: (placeKey: string, placeKind: PlaceKind | null) => Promise<void>,
  ) {}

  async apply(
    placeKey: string,
    placeKind: PlaceKind | null,
    filePaths: readonly string[],
  ): Promise<PlaceKindWriteResult> {
    let updated = 0;

    for (const path of filePaths) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      if (await this.writeOne(file, placeKey, placeKind)) updated += 1;
    }

    // Best effort, and reported rather than thrown: the vault already has the
    // change, so failing the whole action here would misrepresent what happened.
    let syncError: Error | null = null;
    if (updated > 0) {
      try {
        await this.sync(placeKey, placeKind);
      } catch (error) {
        syncError = error instanceof Error ? error : new Error(String(error));
      }
    }

    return { updated, syncError };
  }

  /** Returns whether the note was rewritten. */
  private async writeOne(
    file: TFile,
    placeKey: string,
    placeKind: PlaceKind | null,
  ): Promise<boolean> {
    let changed = false;

    await this.app.vault.process(file, (content) => {
      const locations = LocationBodyBlock.parse(content);
      if (!locations) return content;

      const next = locations.map((location) => {
        if (location.placeKey !== placeKey) return location;
        if (location.placeKind === placeKind) return location;
        changed = true;
        return { ...location, placeKind };
      });

      // `process` writes whatever it returns, so an unchanged note must return
      // the original string rather than a re-serialized equivalent — otherwise
      // every place in the vault gets a modified time for a no-op.
      return changed ? LocationBodyBlock.upsert(content, next) : content;
    });

    return changed;
  }
}
