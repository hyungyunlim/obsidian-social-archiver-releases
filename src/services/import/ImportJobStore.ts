/**
 * Durable storage for import jobs + per-item state.
 *
 * Storage choice: a dedicated JSON file under the plugin folder rather than
 * the single-JSON `data.json` used by `loadData()` / `saveData()`. An import
 * run for 500 posts produces ~500 ImportItem entries — putting that in the
 * main settings blob would rewrite it on every item transition and bloat
 * the plugin's settings surface.
 *
 * Path: `{pluginDir}/import-jobs.json`
 *
 * Schema (top-level):
 * ```
 * {
 *   "version": 1,
 *   "jobs":       { [jobId]: ImportJobState },
 *   "items":      { [jobId]: ImportItem[] },
 *   "activeJobId": string | null
 * }
 * ```
 *
 * Writes are debounced (250ms) so a tight worker loop does not hammer the
 * filesystem. `flush()` forces a synchronous write before shutdown.
 *
 * Retention: completed jobs expire at {@link COMPLETED_JOB_RETENTION_DAYS};
 * failed jobs expire at {@link FAILED_JOB_RETENTION_DAYS}. Expired rows are
 * purged on `load()`.
 */

import type { Vault } from 'obsidian';
import {
  COMPLETED_JOB_RETENTION_DAYS,
  FAILED_JOB_RETENTION_DAYS,
  type GallerySelection,
  type ImportItem,
  type ImportJobState,
} from '@/types/import';

const STORE_FILE = 'import-jobs.json';
/**
 * Snapshot schema version.
 *
 * v1 → v2 (2026-04, gallery PRD §9.7): added optional `gallerySelection`
 * field to {@link ImportJobState}. The migration is a no-op structurally —
 * the field is optional, so v1 rows stay valid — but we still bump the
 * version so the file is rewritten and can be detected on re-load.
 *
 * `gallerySelection.ids` is a Set, which does NOT survive `JSON.stringify`
 * untouched. The store serializes it as `{ mode, ids: string[] }` on disk
 * and rehydrates it on load — see {@link serializeJob} / {@link deserializeJob}.
 */
const STORE_VERSION = 2;
const SAVE_DEBOUNCE_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

type ImportJobStoreSnapshot = {
  version: number;
  jobs: Record<string, ImportJobState>;
  items: Record<string, ImportItem[]>;
  activeJobId: string | null;
};

/**
 * On-disk representation of {@link GallerySelection}. JSON has no native
 * Set type, so we encode `ids` as an array. Round-trip happens in
 * {@link serializeGallerySelection} / {@link deserializeGallerySelection}.
 */
type SerializedGallerySelection = {
  mode: 'all-except' | 'only';
  ids: string[];
};

/**
 * On-disk representation of {@link ImportJobState}. Only `gallerySelection`
 * needs custom encoding; every other field is JSON-native.
 */
type SerializedImportJobState = Omit<ImportJobState, 'gallerySelection'> & {
  gallerySelection?: SerializedGallerySelection;
};

type SerializedSnapshot = {
  version: number;
  jobs: Record<string, SerializedImportJobState>;
  items: Record<string, ImportItem[]>;
  activeJobId: string | null;
};

function emptySnapshot(): ImportJobStoreSnapshot {
  return { version: STORE_VERSION, jobs: {}, items: {}, activeJobId: null };
}

function serializeGallerySelection(
  s: GallerySelection | undefined,
): SerializedGallerySelection | undefined {
  if (!s) return undefined;
  return { mode: s.mode, ids: Array.from(s.ids) };
}

function deserializeGallerySelection(
  s: SerializedGallerySelection | undefined,
): GallerySelection | undefined {
  if (!s) return undefined;
  if (s.mode !== 'all-except' && s.mode !== 'only') return undefined;
  return { mode: s.mode, ids: new Set(Array.isArray(s.ids) ? s.ids : []) };
}

function serializeJob(job: ImportJobState): SerializedImportJobState {
  // Spread first, then overwrite the one Set-bearing field.
  const { gallerySelection, ...rest } = job;
  return {
    ...rest,
    gallerySelection: serializeGallerySelection(gallerySelection),
  };
}

function deserializeJob(raw: SerializedImportJobState): ImportJobState {
  const { gallerySelection, ...rest } = raw;
  const out: ImportJobState = { ...(rest as ImportJobState) };
  const rehydrated = deserializeGallerySelection(gallerySelection);
  if (rehydrated) {
    out.gallerySelection = rehydrated;
  }
  return out;
}

export class ImportJobStore {
  private snapshot: ImportJobStoreSnapshot = emptySnapshot();
  private loaded = false;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly filePath: string;

  constructor(
    private readonly vault: Vault,
    private readonly pluginDir: string,
  ) {
    this.filePath = `${this.pluginDir}/${STORE_FILE}`;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Load + prune the on-disk store. Safe to call multiple times. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.vault.adapter.read(this.filePath);
      const parsed = JSON.parse(raw) as unknown;
      if (this.isValidSerializedSnapshot(parsed)) {
        const migrated = this.migrate(parsed);
        this.snapshot = this.deserializeSnapshot(migrated);
        // If we bumped the version we also want the new shape on disk —
        // schedule a save so the migration is persisted.
        if (parsed.version !== STORE_VERSION) {
          this.scheduleSave();
        }
      } else {
        this.snapshot = emptySnapshot();
      }
    } catch {
      // File does not exist yet — start fresh.
      this.snapshot = emptySnapshot();
    }
    this.pruneExpired();
    this.loaded = true;
  }

  /**
   * Apply forward-only schema migrations to an in-memory parsed snapshot.
   * Idempotent: re-running on an already-current snapshot is a no-op.
   *
   * v1 → v2: gain optional `gallerySelection` on each job row. v1 rows have
   * no field, which is structurally valid for v2 — so the migration only
   * bumps the version number. New writes will encode `gallerySelection`
   * via {@link serializeGallerySelection} when present.
   */
  private migrate(snapshot: SerializedSnapshot): SerializedSnapshot {
    let current = snapshot;
    if (current.version === 1) {
      current = { ...current, version: 2 };
    }
    return current;
  }

  /** Flush any pending debounced write, then stop timers. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      await this.saveNow();
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getJob(jobId: string): ImportJobState | null {
    this.requireLoaded();
    return this.snapshot.jobs[jobId] ?? null;
  }

  listJobs(): ImportJobState[] {
    this.requireLoaded();
    return Object.values(this.snapshot.jobs);
  }

  listActiveJobs(): ImportJobState[] {
    this.requireLoaded();
    return Object.values(this.snapshot.jobs).filter((j) =>
      j.status === 'queued' || j.status === 'running' || j.status === 'paused',
    );
  }

  getItems(jobId: string): ImportItem[] {
    this.requireLoaded();
    return this.snapshot.items[jobId] ?? [];
  }

  getActiveJobId(): string | null {
    this.requireLoaded();
    return this.snapshot.activeJobId;
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /** Create a new job with its initial item list. Does not set it active. */
  createJob(job: ImportJobState, items: ImportItem[]): void {
    this.requireLoaded();
    if (this.snapshot.jobs[job.jobId]) {
      throw new Error(`Job ${job.jobId} already exists`);
    }
    this.snapshot.jobs[job.jobId] = job;
    this.snapshot.items[job.jobId] = items;
    this.scheduleSave();
  }

  /**
   * Replace the stored ImportJobState with a new snapshot.
   *
   * Callers pass the full state (not a diff) so there is only ever one source
   * of truth per job. Throws if the job does not exist.
   */
  updateJob(job: ImportJobState): void {
    this.requireLoaded();
    if (!this.snapshot.jobs[job.jobId]) {
      throw new Error(`Job ${job.jobId} not found`);
    }
    this.snapshot.jobs[job.jobId] = job;
    this.scheduleSave();
  }

  /**
   * Replace the full item list for a job.
   *
   * This is a wholesale overwrite, not an incremental merge. The worker
   * holds the authoritative in-memory list and writes it back.
   */
  updateItems(jobId: string, items: ImportItem[]): void {
    this.requireLoaded();
    if (!this.snapshot.jobs[jobId]) {
      throw new Error(`Job ${jobId} not found`);
    }
    this.snapshot.items[jobId] = items;
    this.scheduleSave();
  }

  setActiveJobId(jobId: string | null): void {
    this.requireLoaded();
    this.snapshot.activeJobId = jobId;
    this.scheduleSave();
  }

  /** Delete a job and its items (manual clear from UI). */
  deleteJob(jobId: string): void {
    this.requireLoaded();
    delete this.snapshot.jobs[jobId];
    delete this.snapshot.items[jobId];
    if (this.snapshot.activeJobId === jobId) {
      this.snapshot.activeJobId = null;
    }
    this.scheduleSave();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveNow(): Promise<void> {
    this.dirty = false;
    try {
      await this.vault.adapter.write(
        this.filePath,
        JSON.stringify(this.serializeSnapshot(this.snapshot)),
      );
    } catch (err) {
      // Re-dirty so a later flush retries.
      this.dirty = true;
      console.error('[ImportJobStore] failed to persist', err);
    }
  }

  /**
   * Convert the in-memory snapshot (which holds Set instances on
   * `gallerySelection.ids`) into a JSON-safe shape. Always stamps the
   * current {@link STORE_VERSION}.
   */
  private serializeSnapshot(snap: ImportJobStoreSnapshot): SerializedSnapshot {
    const jobs: Record<string, SerializedImportJobState> = {};
    for (const [id, job] of Object.entries(snap.jobs)) {
      jobs[id] = serializeJob(job);
    }
    return {
      version: STORE_VERSION,
      jobs,
      items: snap.items,
      activeJobId: snap.activeJobId,
    };
  }

  /**
   * Reverse of {@link serializeSnapshot}: rehydrate Set instances inside
   * any persisted gallery selection.
   */
  private deserializeSnapshot(snap: SerializedSnapshot): ImportJobStoreSnapshot {
    const jobs: Record<string, ImportJobState> = {};
    for (const [id, raw] of Object.entries(snap.jobs)) {
      jobs[id] = deserializeJob(raw);
    }
    return {
      version: STORE_VERSION,
      jobs,
      items: snap.items,
      activeJobId: snap.activeJobId,
    };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [jobId, job] of Object.entries(this.snapshot.jobs)) {
      if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') continue;
      const endAt = job.completedAt ?? job.createdAt;
      const ttlDays =
        job.status === 'completed' ? COMPLETED_JOB_RETENTION_DAYS : FAILED_JOB_RETENTION_DAYS;
      if (now - endAt > ttlDays * DAY_MS) {
        delete this.snapshot.jobs[jobId];
        delete this.snapshot.items[jobId];
      }
    }
  }

  /**
   * Shape check for a freshly-parsed snapshot. We accept any version here
   * — the {@link migrate} step is responsible for upgrading to the current
   * one. Unknown future versions also pass this gate; they will be treated
   * as if at the current version (Set rehydrate is forgiving) and a follow-
   * up save bumps them. This is the safer default than nuking the file.
   */
  private isValidSerializedSnapshot(v: unknown): v is SerializedSnapshot {
    if (typeof v !== 'object' || v === null) return false;
    const s = v as Partial<SerializedSnapshot>;
    return (
      typeof s.version === 'number' &&
      typeof s.jobs === 'object' &&
      s.jobs !== null &&
      typeof s.items === 'object' &&
      s.items !== null &&
      (s.activeJobId === null || typeof s.activeJobId === 'string')
    );
  }

  private requireLoaded(): void {
    if (!this.loaded) {
      throw new Error('ImportJobStore: call load() before using the store');
    }
  }
}
