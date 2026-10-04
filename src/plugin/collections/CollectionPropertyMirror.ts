import type { App, TFile } from 'obsidian';
import type { CollectionStore } from '../../services/collections/CollectionStore';

/**
 * Optional `archiveCollections` property on archive notes
 * (prd-collections-obsidian-plugin O6): one-way, store → note, so Bases,
 * Dataview and search can use collections. Off by default — it writes to the
 * user's notes, and every write is a change their vault sync carries.
 *
 * Only notes whose list actually differs are written, after the store has
 * been quiet for a moment. Turning it off removes the property it wrote.
 */

export const COLLECTIONS_PROPERTY = 'archiveCollections';

export interface CollectionPropertyMirrorDeps {
  app: App;
  store: CollectionStore;
  enabled: () => boolean;
  /** Every archive id that has a note in this vault. */
  listArchiveIds: () => string[];
  fileFor: (archiveId: string) => TFile | null;
  /** Mark a write as ours, so open timelines neither refresh nor re-share for it. */
  markUiModify: (path: string) => void;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
}

/** A sync pass writes the store several times; reconcile once it settles. */
const RECONCILE_DEBOUNCE_MS = 1_000;

/** The names to write for an archive: its collections, sorted, no duplicates. */
export function desiredCollectionNames(store: Pick<CollectionStore, 'getCollectionIdsForArchive' | 'getCollection'>, archiveId: string): string[] {
  const names = new Set<string>();
  for (const id of store.getCollectionIdsForArchive(archiveId)) {
    const name = store.getCollection(id)?.name;
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Whether a note's current value already says exactly these names (order-insensitive). */
export function matchesNames(current: unknown, desired: readonly string[]): boolean {
  const have = Array.isArray(current)
    ? current.filter((value): value is string => typeof value === 'string')
    : typeof current === 'string' && current.trim() ? [current.trim()] : [];
  if (have.length !== desired.length) return false;
  const sorted = [...have].sort((a, b) => a.localeCompare(b));
  return sorted.every((name, index) => name === desired[index]);
}

export class CollectionPropertyMirror {
  private unsubscribe: (() => void) | null = null;
  private timer: number | null = null;
  private running: Promise<number> | null = null;
  private rerun = false;

  constructor(private readonly deps: CollectionPropertyMirrorDeps) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.store.onChange(() => this.schedule());
    this.schedule();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) this.deps.cancel(this.timer);
    this.timer = null;
  }

  /** Bring every archive note's property in line with the store. Returns how many notes were written. */
  reconcile(): Promise<number> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.reconcileOnce().finally(() => {
      this.running = null;
      if (this.rerun) {
        this.rerun = false;
        void this.reconcile();
      }
    });
    return this.running;
  }

  /** Remove the property from every note (the setting was turned off). */
  async clearAll(): Promise<number> {
    let written = 0;
    for (const archiveId of this.deps.listArchiveIds()) {
      const file = this.deps.fileFor(archiveId);
      if (!file) continue;
      const current: unknown = this.deps.app.metadataCache.getFileCache(file)?.frontmatter?.[COLLECTIONS_PROPERTY];
      if (current === undefined) continue;
      if (await this.write(file, [])) written++;
    }
    return written;
  }

  private schedule(): void {
    if (!this.deps.enabled()) return;
    if (this.timer !== null) this.deps.cancel(this.timer);
    this.timer = this.deps.schedule(() => {
      this.timer = null;
      void this.reconcile();
    }, RECONCILE_DEBOUNCE_MS);
  }

  private async reconcileOnce(): Promise<number> {
    if (!this.deps.enabled() || !this.deps.store.getUsername()) return 0;
    let written = 0;
    for (const archiveId of this.deps.listArchiveIds()) {
      const file = this.deps.fileFor(archiveId);
      if (!file) continue;
      const desired = desiredCollectionNames(this.deps.store, archiveId);
      const current: unknown = this.deps.app.metadataCache.getFileCache(file)?.frontmatter?.[COLLECTIONS_PROPERTY];
      if (current === undefined && desired.length === 0) continue;
      if (matchesNames(current, desired)) continue;
      if (await this.write(file, desired)) written++;
    }
    return written;
  }

  private async write(file: TFile, names: readonly string[]): Promise<boolean> {
    try {
      this.deps.markUiModify(file.path);
      await this.deps.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (names.length > 0) frontmatter[COLLECTIONS_PROPERTY] = [...names];
        else delete frontmatter[COLLECTIONS_PROPERTY];
      });
      return true;
    } catch (error) {
      console.warn('[Social Archiver] Writing archiveCollections failed:', file.path, error);
      return false;
    }
  }
}
