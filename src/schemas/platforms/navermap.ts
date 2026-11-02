import { z } from 'zod';
import {
  canonicalizeKoreanMapPlaceUrl,
  extractKoreanMapPlaceId,
  isKoreanMapUrlCandidate,
  isNaverMapShortUrl,
} from '@/shared/platforms/map-places';

export const NaverMapPlaceIdSchema = z
  .string()
  .regex(/^\d{1,30}$/, { error: 'Invalid Naver Map place ID' });

export const NaverMapURLSchema = z
  .string()
  .trim()
  .min(1, { error: 'URL cannot be empty' })
  .check(z.url({ error: 'Invalid URL format' }))
  .refine((value) => isKoreanMapUrlCandidate('navermap', value), {
    error: 'Invalid Naver Map place URL',
  });

export function extractNaverMapPlaceId(value: string): string | null {
  return extractKoreanMapPlaceId('navermap', value);
}

export function canonicalizeNaverMapUrl(value: string): string | null {
  return canonicalizeKoreanMapPlaceUrl('navermap', value);
}

export { isNaverMapShortUrl };

export type NaverMapURL = z.infer<typeof NaverMapURLSchema>;
export type NaverMapPlaceId = z.infer<typeof NaverMapPlaceIdSchema>;
