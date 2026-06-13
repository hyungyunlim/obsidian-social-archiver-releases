/**
 * DeviceScopedIdStorage - Per-device persistence for sync identity ids
 *
 * Single Responsibility: read/write `syncClientId` and `deviceId` in
 * Obsidian's per-device localStorage (`app.loadLocalStorage` /
 * `app.saveLocalStorage`, scoped per vault per device, survives plugin
 * updates).
 *
 * Why not data.json: plugin settings travel with the vault when it is synced
 * via Syncthing/iCloud, so per-device identity stored there gets overwritten
 * by whichever device wrote data.json last. Every device flip then triggers a
 * runtime mismatch in `ensureRuntimeScopedSyncClient` (desktop holding
 * mobile's syncClientId and vice versa) and a re-registration round-trip.
 * Keeping the ids in localStorage pins them to the device.
 *
 * data.json values are migrated into localStorage once (see
 * `resolveOnLoad`) and stripped from the persisted settings thereafter.
 */

/** Minimal surface of Obsidian's `App` needed — keeps the helper unit-testable. */
export interface DeviceLocalStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

/** Resolved per-device ids to apply onto the in-memory settings object. */
export interface DeviceScopedIds {
  syncClientId: string;
  deviceId: string;
}

const SYNC_CLIENT_ID_KEY = 'social-archiver-sync-client-id';
const DEVICE_ID_KEY = 'social-archiver-device-id';

export class DeviceScopedIdStorage {
  constructor(private readonly storage: DeviceLocalStorage) {}

  getSyncClientId(): string {
    return this.read(SYNC_CLIENT_ID_KEY);
  }

  /** An empty id clears the stored value (sign-out / unregister). */
  setSyncClientId(id: string): void {
    this.write(SYNC_CLIENT_ID_KEY, id);
  }

  getDeviceId(): string {
    return this.read(DEVICE_ID_KEY);
  }

  /** deviceId is never deliberately cleared — empty writes are ignored. */
  setDeviceId(id: string): void {
    if (!id.trim()) return;
    this.write(DEVICE_ID_KEY, id);
  }

  /**
   * Resolve the per-device ids at plugin load.
   *
   * - A localStorage value always wins: it was written by THIS device.
   * - Otherwise adopt the data.json value once (legacy migration). The value
   *   may have been written by another device sharing the vault; if so,
   *   `ensureRuntimeScopedSyncClient` repairs it on first use, after which
   *   the corrected id is pinned here and the churn stops.
   * - With neither present, the freshly generated deviceId is adopted and the
   *   syncClientId stays empty until registration.
   *
   * @param persistedSyncClientId - syncClientId loaded from data.json
   * @param candidateDeviceId - deviceId after settings migration (the
   *   data.json value, or a freshly generated one when data.json had none)
   */
  resolveOnLoad(persistedSyncClientId: string, candidateDeviceId: string): DeviceScopedIds {
    const localDeviceId = this.getDeviceId();
    const deviceId = localDeviceId || candidateDeviceId;
    if (!localDeviceId) {
      this.setDeviceId(deviceId);
    }

    const localSyncClientId = this.getSyncClientId();
    const syncClientId = localSyncClientId || persistedSyncClientId;
    if (!localSyncClientId && syncClientId) {
      this.setSyncClientId(syncClientId);
    }

    return { syncClientId, deviceId };
  }

  private read(key: string): string {
    try {
      const value = this.storage.loadLocalStorage(key);
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }

  private write(key: string, value: string): void {
    try {
      const normalized = value.trim();
      if (this.read(key) === normalized) return;
      this.storage.saveLocalStorage(key, normalized || null);
    } catch {
      // localStorage unavailable — ids fall back to in-memory only for this
      // session and re-resolve on next load.
    }
  }
}
