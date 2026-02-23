import { z } from 'zod';

/**
 * Web URL Schema - validates generic HTTP(S) URLs
 *
 * This is a catch-all schema for URLs that don't match any specific platform.
 * It only validates that the input is a valid HTTP or HTTPS URL.
 */
export const WebURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL is required' })
  .url({ message: 'Must be a valid URL' })
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be an HTTP or HTTPS URL' }
  );

export type WebURL = z.infer<typeof WebURLSchema>;
