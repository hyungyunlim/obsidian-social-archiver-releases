import { describe, expect, it } from 'vitest';
import { LocationBodyBlock } from './LocationBodyBlock';
import type { ArchiveLocation } from '../../types/archive-location';

function loc(overrides: Partial<ArchiveLocation> = {}): ArchiveLocation {
  return {
    id: 'a9a82e77-c3e1-4cec-838c-2e21237bf864',
    archiveId: 'EpCJKin6yj',
    placeKey: 'kakaomap:18857457',
    name: '모녀가리비',
    address: '강원특별자치도 속초시 대포항희망길 53',
    latitude: 38.1733071627822,
    longitude: 128.605777284753,
    source: 'kakaomap',
    externalId: '18857457',
    url: 'https://place.map.kakao.com/18857457',
    category: '음식점 > 한식 > 해물,생선 > 조개',
    isPrimary: true,
    sortOrder: 0,
    placeArchiveId: null,
    promotionStatus: 'metadata_only',
    createdAt: '2026-07-20T04:13:31.296Z',
    updatedAt: '2026-07-20T04:13:31.296Z',
    ...overrides,
  };
}

describe('LocationBodyBlock', () => {
  it('round-trips a locations list through serialize/parse', () => {
    const locations = [loc(), loc({ id: 'b', placeKey: 'kakaomap:909684968', name: '남경막국수', isPrimary: false, sortOrder: 1 })];
    const body = `Post body.\n\n${LocationBodyBlock.serialize(locations)}\n`;
    const parsed = LocationBodyBlock.parse(body);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]?.name).toBe('모녀가리비');
    expect(parsed?.[1]?.placeKey).toBe('kakaomap:909684968');
  });

  it('is wrapped in an Obsidian %% comment so it stays hidden', () => {
    const block = LocationBodyBlock.serialize([loc()]);
    expect(block.startsWith('%% sa:locations')).toBe(true);
    expect(block.trimEnd().endsWith('%%')).toBe(true);
  });

  it('strip removes the block and its padding from the body', () => {
    const body = `Real body text.\n\n${LocationBodyBlock.serialize([loc()])}\n`;
    const stripped = LocationBodyBlock.strip(body);
    expect(stripped).not.toContain('sa:locations');
    expect(stripped).not.toContain('모녀가리비');
    expect(stripped).toContain('Real body text.');
  });

  it('parse returns null for a body without a block', () => {
    expect(LocationBodyBlock.parse('just some text')).toBeNull();
  });

  it('parse drops malformed JSON without throwing', () => {
    const body = '%% sa:locations\n{not valid json\n%%';
    expect(LocationBodyBlock.parse(body)).toBeNull();
  });

  it('parse drops entries that fail schema validation', () => {
    const body = '%% sa:locations\n{"v":1,"locations":[{"name":"missing required fields"}]}\n%%';
    expect(LocationBodyBlock.parse(body)).toBeNull();
  });

  it('upsert replaces an existing block instead of appending a second', () => {
    const first = LocationBodyBlock.upsert('Body.', [loc({ name: 'Old' })]);
    const second = LocationBodyBlock.upsert(first, [loc({ name: 'New' })]);
    expect((second.match(/sa:locations/g) ?? []).length).toBe(1);
    expect(LocationBodyBlock.parse(second)?.[0]?.name).toBe('New');
  });

  it('upsert with an empty list removes the block', () => {
    const withBlock = LocationBodyBlock.upsert('Body.', [loc()]);
    const cleared = LocationBodyBlock.upsert(withBlock, []);
    expect(LocationBodyBlock.has(cleared)).toBe(false);
    expect(cleared).toContain('Body.');
  });
});
