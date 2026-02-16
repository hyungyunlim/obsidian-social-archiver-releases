import { z } from 'zod';

/**
 * Google Maps Place ID validation
 * Place IDs are alphanumeric strings prefixed with "ChIJ" or similar patterns
 */
export const GoogleMapsPlaceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,}$/, {
    message: 'Invalid Google Maps place ID format',
  })
  .describe('Google Maps place ID');

/**
 * Google Maps domain validation
 * Supports various Google Maps URL formats including country-specific domains
 */
const googleMapsDomainRegex =
  /^(https?:\/\/)?(www\.)?(maps\.)?google\.[a-z.]+\/maps\//i;

const googleMapsShortlinkRegex = /^(https?:\/\/)?goo\.gl\/maps\/[A-Za-z0-9]+/i;

/**
 * Google Maps Place URL validation
 * Supports:
 * - /maps/place/PlaceName/@coordinates
 * - /maps/place/PlaceName/data=!...
 * - goo.gl/maps/shortcode
 * - maps.app.goo.gl/shortcode (new shortened format)
 */
export const GoogleMapsURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .refine(
    (url) => {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        const pathname = urlObj.pathname;

        // Check for goo.gl shortlinks
        if (hostname === 'goo.gl') {
          return pathname.startsWith('/maps/');
        }

        // Check for maps.app.goo.gl shortlinks (new format)
        if (hostname === 'maps.app.goo.gl') {
          // Any path with a shortcode is valid
          return pathname.length > 1;
        }

        // Check for Google Maps domains (google.com, google.fr, maps.google.com, etc.)
        const isGoogleDomain =
          hostname.match(/^(www\.)?(maps\.)?google\.[a-z.]+$/i) !== null;

        if (!isGoogleDomain) {
          return false;
        }

        // Must have /maps/ in pathname
        if (!pathname.includes('/maps/')) {
          return false;
        }

        // Valid patterns:
        // /maps/place/...
        // /maps/search/...
        // /maps/@coordinates...
        const validPathPatterns = [
          /\/maps\/place\//i,
          /\/maps\/search\//i,
          /\/maps\/@-?\d+\.\d+/i,
        ];

        return validPathPatterns.some((pattern) => pattern.test(pathname));
      } catch {
        return false;
      }
    },
    {
      message:
        'Invalid Google Maps URL format. Supported: google.com/maps/place/..., goo.gl/maps/..., maps.app.goo.gl/...',
    }
  )
  .describe('Google Maps place URL');

/**
 * Type inference helpers
 */
export type GoogleMapsURL = z.infer<typeof GoogleMapsURLSchema>;
export type GoogleMapsPlaceId = z.infer<typeof GoogleMapsPlaceIdSchema>;
