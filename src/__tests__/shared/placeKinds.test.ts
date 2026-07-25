import { describe, expect, it } from 'vitest';
import {
  inferPlaceKindFromProvider,
  inferPlaceKindFromText,
} from '../../shared/platforms/place-kinds';

describe('place kind inference', () => {
  it('prefers the most specific Kakao category or place name over a broad group', () => {
    expect(inferPlaceKindFromProvider({
      provider: 'kakaomap',
      name: '피뽀 베이커리',
      categoryName: '음식점 > 카페 > 베이커리',
      categoryGroupCode: 'FD6',
    })).toMatchObject({
      placeKind: 'bakery',
      confidence: 'high',
      source: 'provider',
    });

    expect(inferPlaceKindFromProvider({
      provider: 'kakaomap',
      name: 'Tartine Bakery',
      categoryName: 'Food',
      categoryGroupCode: 'FD6',
    })?.placeKind).toBe('bakery');
  });

  it('uses exact Google primary types before text fallback', () => {
    expect(inferPlaceKindFromProvider({
      provider: 'googlemaps',
      name: 'Stay Beyond',
      primaryType: 'resort_hotel',
    })).toEqual({
      placeKind: 'hotel',
      confidence: 'high',
      source: 'provider',
    });
  });

  it('falls back conservatively to the archived post text', () => {
    expect(inferPlaceKindFromText('오늘 오픈한 신상 카페. 브런치 메뉴도 많다')?.placeKind)
      .toBe('cafe');
    expect(inferPlaceKindFromText('양양 독채 펜션 가성비 숙소')?.placeKind)
      .toBe('hotel');
    expect(inferPlaceKindFromText('서울 중구 청구로 94')).toBeNull();
  });
});
