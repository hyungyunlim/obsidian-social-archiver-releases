import { z } from 'zod';
import {
  canonicalizeKoreanMapPlaceUrl,
  extractKoreanMapPlaceId,
  isKakaoMapShortUrl,
  isKoreanMapUrlCandidate,
} from '@/shared/platforms/map-places';

export const KakaoMapPlaceIdSchema = z
  .string()
  .regex(/^\d{1,30}$/, { error: 'Invalid Kakao Map place ID' });

export const KakaoMapURLSchema = z
  .string()
  .trim()
  .min(1, { error: 'URL cannot be empty' })
  .check(z.url({ error: 'Invalid URL format' }))
  .refine((value) => isKoreanMapUrlCandidate('kakaomap', value), {
    error: 'Invalid Kakao Map place URL',
  });

export function extractKakaoMapPlaceId(value: string): string | null {
  return extractKoreanMapPlaceId('kakaomap', value);
}

export function canonicalizeKakaoMapUrl(value: string): string | null {
  return canonicalizeKoreanMapPlaceUrl('kakaomap', value);
}

export { isKakaoMapShortUrl };

export type KakaoMapURL = z.infer<typeof KakaoMapURLSchema>;
export type KakaoMapPlaceId = z.infer<typeof KakaoMapPlaceIdSchema>;
