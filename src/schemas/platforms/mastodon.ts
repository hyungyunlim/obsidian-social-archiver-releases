import { z } from 'zod';

export const MastodonURLSchema = z.url().refine((value) => {
  try {
    const parsed = new URL(value);
    return /^\/(?:@[^/]+\/\d+|users\/[^/]+\/statuses\/\d+)\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}, {
  error: 'URL must be a valid Mastodon post (https://instance/@username/123456 or https://instance/users/username/statuses/123456)',
});

export const MastodonPostIdSchema = z.string().regex(/^[0-9]+$/, {
  error: 'Mastodon post ID must be numeric',
});
