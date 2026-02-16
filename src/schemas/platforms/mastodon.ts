import { z } from 'zod';

export const MastodonURLSchema = z.string().url().refine((value) => {
  try {
    const parsed = new URL(value);
    return /\/\@[^/]+\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}, {
  message: 'URL must be a valid Mastodon post (https://instance/@username/123456)',
});

export const MastodonPostIdSchema = z.string().regex(/^[0-9]+$/, {
  message: 'Mastodon post ID must be numeric',
});
