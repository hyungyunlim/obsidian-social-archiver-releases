import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

const substackDomainPattern = /([A-Za-z0-9-]+\.)*substack\.com$/i;

const substackPathPattern = /(@[^/]+\/(?:post|note)\/[A-Za-z0-9-]+|\/p\/[A-Za-z0-9-]+|\/note\/[A-Za-z0-9-]+)/i;

export const SubstackURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine((url) => {
    try {
      const hostname = new URL(url).hostname;
      return substackDomainPattern.test(hostname);
    } catch {
      return false;
    }
  }, { message: 'URL must be from substack.com' })
  .refine((url) => {
    try {
      const pathname = new URL(url).pathname;
      return substackPathPattern.test(pathname);
    } catch {
      return false;
    }
  }, { message: 'URL must be a Substack post or note' });
