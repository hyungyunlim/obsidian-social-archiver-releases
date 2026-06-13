import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeviceScopedIdStorage, type DeviceLocalStorage } from '@/services/DeviceScopedIdStorage';

const SYNC_CLIENT_ID_KEY = 'social-archiver-sync-client-id';
const DEVICE_ID_KEY = 'social-archiver-device-id';

describe('DeviceScopedIdStorage', () => {
  let backing: Map<string, unknown>;
  let mockStorage: DeviceLocalStorage;
  let storage: DeviceScopedIdStorage;

  beforeEach(() => {
    backing = new Map();
    mockStorage = {
      loadLocalStorage: vi.fn((key: string) => backing.get(key) ?? null),
      saveLocalStorage: vi.fn((key: string, data: unknown | null) => {
        if (data === null) {
          backing.delete(key);
        } else {
          backing.set(key, data);
        }
      }),
    };
    storage = new DeviceScopedIdStorage(mockStorage);
  });

  describe('syncClientId', () => {
    it('returns empty string when nothing is stored', () => {
      expect(storage.getSyncClientId()).toBe('');
    });

    it('round-trips a stored id', () => {
      storage.setSyncClientId('client-abc');
      expect(storage.getSyncClientId()).toBe('client-abc');
      expect(backing.get(SYNC_CLIENT_ID_KEY)).toBe('client-abc');
    });

    it('clears the stored value when set to empty (sign-out/unregister)', () => {
      storage.setSyncClientId('client-abc');
      storage.setSyncClientId('');
      expect(storage.getSyncClientId()).toBe('');
      expect(backing.has(SYNC_CLIENT_ID_KEY)).toBe(false);
    });

    it('skips redundant writes when the value is unchanged', () => {
      storage.setSyncClientId('client-abc');
      storage.setSyncClientId('client-abc');
      expect(mockStorage.saveLocalStorage).toHaveBeenCalledTimes(1);
    });

    it('ignores non-string stored values', () => {
      backing.set(SYNC_CLIENT_ID_KEY, { bogus: true });
      expect(storage.getSyncClientId()).toBe('');
    });
  });

  describe('deviceId', () => {
    it('round-trips a stored id', () => {
      storage.setDeviceId('device-123');
      expect(storage.getDeviceId()).toBe('device-123');
    });

    it('ignores empty writes (deviceId is never deliberately cleared)', () => {
      storage.setDeviceId('device-123');
      storage.setDeviceId('');
      storage.setDeviceId('   ');
      expect(storage.getDeviceId()).toBe('device-123');
    });
  });

  describe('resolveOnLoad', () => {
    it('adopts data.json values into localStorage on first load (legacy migration)', () => {
      const resolved = storage.resolveOnLoad('legacy-client', 'legacy-device');

      expect(resolved).toEqual({ syncClientId: 'legacy-client', deviceId: 'legacy-device' });
      expect(storage.getSyncClientId()).toBe('legacy-client');
      expect(storage.getDeviceId()).toBe('legacy-device');
    });

    it('prefers localStorage values over data.json values (device flip protection)', () => {
      // This device registered as desktop; data.json later synced in from mobile.
      storage.setSyncClientId('this-device-client');
      storage.setDeviceId('this-device-id');

      const resolved = storage.resolveOnLoad('other-device-client', 'other-device-id');

      expect(resolved).toEqual({ syncClientId: 'this-device-client', deviceId: 'this-device-id' });
      // Foreign ids must not leak into per-device storage.
      expect(storage.getSyncClientId()).toBe('this-device-client');
      expect(storage.getDeviceId()).toBe('this-device-id');
    });

    it('adopts a freshly generated deviceId when neither store has one', () => {
      const resolved = storage.resolveOnLoad('', 'generated-device');

      expect(resolved).toEqual({ syncClientId: '', deviceId: 'generated-device' });
      expect(storage.getDeviceId()).toBe('generated-device');
      // No registration yet — syncClientId stays empty and unstored.
      expect(backing.has(SYNC_CLIENT_ID_KEY)).toBe(false);
    });

    it('keeps a cleared (signed-out) syncClientId empty unless data.json has a legacy value', () => {
      storage.setDeviceId('this-device-id');

      const resolved = storage.resolveOnLoad('', 'ignored-candidate');

      expect(resolved.syncClientId).toBe('');
      expect(resolved.deviceId).toBe('this-device-id');
    });

    it('is idempotent across repeated loads', () => {
      storage.resolveOnLoad('legacy-client', 'legacy-device');
      // Second load: data.json was stripped by the write-back.
      const resolved = storage.resolveOnLoad('', 'regenerated-device');

      expect(resolved).toEqual({ syncClientId: 'legacy-client', deviceId: 'legacy-device' });
    });
  });

  describe('storage failures', () => {
    it('falls back to empty/in-memory when localStorage throws', () => {
      const throwing: DeviceLocalStorage = {
        loadLocalStorage: vi.fn(() => {
          throw new Error('quota');
        }),
        saveLocalStorage: vi.fn(() => {
          throw new Error('quota');
        }),
      };
      const broken = new DeviceScopedIdStorage(throwing);

      expect(broken.getSyncClientId()).toBe('');
      expect(() => broken.setSyncClientId('client-abc')).not.toThrow();
      expect(() => broken.setDeviceId('device-123')).not.toThrow();

      const resolved = broken.resolveOnLoad('legacy-client', 'legacy-device');
      expect(resolved).toEqual({ syncClientId: 'legacy-client', deviceId: 'legacy-device' });
    });
  });
});
