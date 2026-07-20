import { __setRequestUrlHandler } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';

const VALID_PREFERENCES = {
  autoArchiveInboxDays: 0,
  retainFailedArchiveAttempts: false,
  failedArchiveAttemptRetentionDays: 90,
  mapSearchProvider: 'googlemaps',
  mapSearchProviderAvailability: { kakaomap: true, googlemaps: false },
  autoArchiveLastRunAt: null,
  createdAt: null,
  updatedAt: null,
} as const;

afterEach(() => __setRequestUrlHandler(null));

function createClient(): WorkersAPIClient {
  const client = new WorkersAPIClient({
    endpoint: 'https://worker.example',
    authToken: 'user-token',
    clientId: 'obsidian-client',
  });
  client.initialize();
  return client;
}

function respondWithPreferences(preferences: unknown): void {
  __setRequestUrlHandler(async () => ({
    status: 200,
    headers: {},
    text: '',
    json: { success: true, preferences },
    arrayBuffer: new ArrayBuffer(0),
  }));
}

describe('WorkersAPIClient archive preference availability', () => {
  it('returns the exact provider availability pair from a valid success response', async () => {
    // Given: the Worker returns a complete preference and runtime availability contract.
    respondWithPreferences(VALID_PREFERENCES);

    // When: the Obsidian client loads account preferences.
    const preferences = await createClient().getArchivePreferences();

    // Then: preference and runtime availability remain separate and exact.
    expect(preferences.mapSearchProvider).toBe('googlemaps');
    expect(preferences.mapSearchProviderAvailability).toEqual({
      kakaomap: true,
      googlemaps: false,
    });
  });

  it.each([
    ['missing', undefined],
    ['partial', { kakaomap: true }],
    ['unknown key', { kakaomap: true, googlemaps: false, othermaps: true }],
    ['malformed boolean', { kakaomap: true, googlemaps: 'true' }],
  ] as const)('rejects %s provider availability on a successful GET', async (_case, availability) => {
    // Given: a nominal success response cannot prove both runtime flags.
    const { mapSearchProviderAvailability: _verifiedAvailability, ...preferencesWithoutAvailability } =
      VALID_PREFERENCES;
    const preferences = availability === undefined
      ? preferencesWithoutAvailability
      : { ...VALID_PREFERENCES, mapSearchProviderAvailability: availability };
    respondWithPreferences(preferences);

    // When/Then: the malformed success fails closed at the API boundary.
    await expect(createClient().getArchivePreferences())
      .rejects.toThrow('Invalid archive preferences response');
  });

  it('rejects a successful PATCH response that omits runtime availability', async () => {
    // Given: the update persisted a preference but returned no authoritative flags.
    const { mapSearchProviderAvailability: _availability, ...missingAvailability } = VALID_PREFERENCES;
    respondWithPreferences(missingAvailability);

    // When/Then: the controller cannot treat a persisted preference as provider availability.
    await expect(createClient().updateArchivePreferences({ mapSearchProvider: 'kakaomap' }))
      .rejects.toThrow('Invalid archive preferences response');
  });
});
