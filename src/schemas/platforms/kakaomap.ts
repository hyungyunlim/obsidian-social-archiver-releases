import { z } from 'zod';
import {
  canonicalizeKoreanMapPlaceUrl,
  extractKoreanMapPlaceId,
  isKakaoMapShortUrl,
  isKoreanMapUrlCandidate,
} from '@/shared/platforms/map-places';

export const KakaoMapPlaceIdSchema = z
  .string()
  .regex(/^\d{1,30}$/, { message: 'Invalid Kakao Map place ID' });

export const KakaoMapURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .refine((value) => isKoreanMapUrlCandidate('kakaomap', value), {
    message: 'Invalid Kakao Map place URL',
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
