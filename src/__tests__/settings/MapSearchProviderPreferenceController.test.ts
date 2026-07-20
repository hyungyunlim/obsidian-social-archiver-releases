import { describe, expect, it, vi } from 'vitest';
import { MapSearchProviderPreferenceController } from '@/settings/MapSearchProviderPreferenceController';

describe('MapSearchProviderPreferenceController', () => {
  it('loads the account preference and resolves auto from the Obsidian host locale', async () => {
    // Given: a Korean host and an account preference set to auto.
    const api = {
      getArchivePreferences: vi.fn(async () => ({
        mapSearchProvider: 'auto' as const,
        mapSearchProviderAvailability: { kakaomap: true, googlemaps: true },
      })),
      updateArchivePreferences: vi.fn(),
    };
    const controller = new MapSearchProviderPreferenceController(api, () => 'ko-KR');

    // When: the account setting loads.
    const state = await controller.load();

    // Then: the stored account value and resolved picker provider are distinct.
    expect(state).toEqual({ preference: 'auto', provider: 'kakaomap', availability: 'available' });
  });

  it('rolls back the visible account preference when saving fails', async () => {
    // Given: Google is loaded and the account PATCH rejects Kakao.
    const api = {
      getArchivePreferences: vi.fn(async () => ({
        mapSearchProvider: 'googlemaps' as const,
        mapSearchProviderAvailability: { kakaomap: true, googlemaps: true },
      })),
      updateArchivePreferences: vi.fn(async () => { throw new Error('offline'); }),
    };
    const controller = new MapSearchProviderPreferenceController(api, () => 'en-US');
    await controller.load();

    // When/Then: the failed save reports the previous server value for rollback.
    await expect(controller.save('kakaomap')).rejects.toMatchObject({
      previousPreference: 'googlemaps',
    });
    expect(controller.current).toBe('googlemaps');
  });

  it('keeps an explicit unavailable preference selected without rewriting it', async () => {
    // Given: Google is the persisted preference while only Kakao is currently available.
    const updateArchivePreferences = vi.fn();
    const controller = new MapSearchProviderPreferenceController({
      getArchivePreferences: vi.fn(async () => ({
        mapSearchProvider: 'googlemaps' as const,
        mapSearchProviderAvailability: { kakaomap: true, googlemaps: false },
      })),
      updateArchivePreferences,
    }, () => 'ko-KR');

    // When: account state loads.
    const state = await controller.load();

    // Then: availability does not silently rewrite the synchronized preference.
    expect(state).toEqual({
      preference: 'googlemaps', provider: 'googlemaps', availability: 'unavailable',
    });
    expect(controller.current).toBe('googlemaps');
    expect(updateArchivePreferences).not.toHaveBeenCalled();
  });

  it.each([
    ['ko', 'auto', 'kakaomap', true, 'available'],
    ['ko-KR', 'auto', 'kakaomap', false, 'unavailable'],
    ['en-US', 'auto', 'googlemaps', true, 'available'],
    ['ja-JP', 'auto', 'googlemaps', false, 'unavailable'],
    ['ko-KR', 'googlemaps', 'googlemaps', false, 'unavailable'],
    ['en-US', 'kakaomap', 'kakaomap', true, 'available'],
  ] as const)(
    'resolves host %s with preference %s to %s when its flag is %s',
    async (locale, preference, provider, providerAvailable, availability) => {
    // Given: one account preference, host locale, and actual provider flag state.
    const controller = new MapSearchProviderPreferenceController({
      getArchivePreferences: vi.fn(async () => ({
        mapSearchProvider: preference,
        mapSearchProviderAvailability: {
          kakaomap: provider === 'kakaomap' ? providerAvailable : true,
          googlemaps: provider === 'googlemaps' ? providerAvailable : true,
        },
      })),
      updateArchivePreferences: vi.fn(),
    }, () => locale);

    // When/Then: preference resolution stays stable and reports disabled providers explicitly.
    await expect(controller.load()).resolves.toMatchObject({ provider, availability });
  });
});
