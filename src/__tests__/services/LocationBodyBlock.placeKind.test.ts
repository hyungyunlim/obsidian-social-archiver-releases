import { describe, expect, it } from 'vitest';
import { LocationBodyBlock } from '../../services/markdown/LocationBodyBlock';

describe('LocationBodyBlock place kind round-trip', () => {
  it('preserves the canonical place kind in the hidden location block', () => {
    const location = {
      id: 'location-1',
      archiveId: 'archive-1',
      placeKey: 'googlemaps:place-1',
      name: 'Lunch',
      address: 'Seoul',
      latitude: 37.5,
      longitude: 127,
      source: 'googlemaps',
      externalId: 'place-1',
      url: 'https://maps.example/place-1',
      category: 'Food',
      placeKind: 'restaurant' as const,
      isPrimary: true,
      sortOrder: 0,
      placeArchiveId: null,
      promotionStatus: 'metadata_only' as const,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    };

    const document = LocationBodyBlock.upsert('# Lunch\n', [location]);
    expect(LocationBodyBlock.parse(document)).toEqual([location]);
  });

  it('accepts older blocks that do not contain a place kind', () => {
    const document = `%% sa:locations
{"v":1,"locations":[{"id":"location-1","archiveId":"archive-1","placeKey":"name:lunch","name":"Lunch","address":null,"latitude":null,"longitude":null,"source":null,"externalId":null,"url":null,"category":null,"isPrimary":true,"sortOrder":0,"placeArchiveId":null,"promotionStatus":"metadata_only","createdAt":"2026-07-24T00:00:00.000Z","updatedAt":"2026-07-24T00:00:00.000Z"}]}
%%`;

    expect(LocationBodyBlock.parse(document)?.[0]?.placeKind).toBeUndefined();
  });
});
