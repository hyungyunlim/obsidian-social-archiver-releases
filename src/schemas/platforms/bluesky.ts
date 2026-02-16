import { z } from 'zod';

export const BlueskyURLSchema = z.string().url().refine((value) => {
  try {
    const parsed = new URL(value);
    if (parsed.hostname !== 'bsky.app') {
      return false;
    }
    return /\/profile\/[A-Za-z0-9._-]+\/post\/[A-Za-z0-9]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}, {
  message: 'URL must be a valid Bluesky post (https://bsky.app/profile/handle/post/id)',
});

export const BlueskyPostIdSchema = z.string().regex(/^[A-Za-z0-9]+$/, {
  message: 'Bluesky post ID must be alphanumeric',
});
