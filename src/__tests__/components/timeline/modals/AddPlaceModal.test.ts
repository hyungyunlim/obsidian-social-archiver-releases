import { describe, expect, it, vi } from 'vitest';
import { candidateUrl } from '@/components/timeline/modals/AddPlaceModal';
import { detectPlatform } from '@/shared/platforms/detection';
import type { ProviderSearchCandidate } from '@/types/place-search';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return { ...actual, setIcon: (): void => {} };
});

/**
 * Turning a search result into something archivable.
 *
 * The whole standalone-place flow rests on this: a canonical map URL already
 * resolves to its own platform, so archiving one produces the place card with no
 * new server work. If the URL is wrong or missing, the flow silently does
 * nothing useful.
 */

function kakao(overrides: Record<string, unknown> = {}): ProviderSearchCandidate {
  return {
    provider: 'kakaomap',
    externalId: '1234567',
    name: '포디',
    categoryName: '카페',
    categoryGroupCode: 'CE7',
    categoryGroupName: '카페',
    address: '서울 용산구',
    roadAddress: '서울 용산구 서빙고로 52-14',
    latitude: 37.52,
    longitude: 126.99,
    phone: '',
    placeUrl: 'https://place.map.kakao.com/1234567',
    selectionToken: 'token',
    ...overrides,
  } as unknown as ProviderSearchCandidate;
}

function google(overrides: Record<string, unknown> = {}): ProviderSearchCandidate {
  return {
    provider: 'googlemaps',
    externalId: 'ChIJLU7jZClu5kcR4PcOOO6p3I0',
    displayName: 'Eiffel Tower',
    formattedAddress: 'Av. Gustave Eiffel, 75007 Paris, France',
    latitude: 48.858,
    longitude: 2.294,
    selectionToken: 'token',
    ...overrides,
  } as unknown as ProviderSearchCandidate;
}

describe('candidateUrl', () => {
  it('builds an archivable URL for a Google result, which carries no url field', () => {
    // The bug this pins: a Google candidate has only an externalId and a
    // selection token, so reading a `url`/`placeUrl` off it found nothing and
    // every Google pick reported "no map link to archive".
    const url = candidateUrl(google());

    expect(url).toContain('ChIJLU7jZClu5kcR4PcOOO6p3I0');
    expect(detectPlatform(url ?? '')).toBe('googlemaps');
  });

  it('builds an archivable URL for a Kakao result', () => {
    const url = candidateUrl(kakao());

    expect(url).toBe('https://place.map.kakao.com/1234567');
    expect(detectPlatform(url ?? '')).toBe('kakaomap');
  });

  it('produces URLs the archive pipeline routes to a place platform', () => {
    // The flow's whole premise — no new server work, because the URL is already
    // a first-class archive target.
    for (const candidate of [kakao(), google()]) {
      expect(detectPlatform(candidateUrl(candidate) ?? '')).not.toBeNull();
    }
  });

  it('returns null for an id the provider pattern rejects', () => {
    // Better a refusal the caller can report than a URL that archives nothing.
    expect(candidateUrl(kakao({ externalId: 'not-an-id' }))).toBeNull();
  });
});
