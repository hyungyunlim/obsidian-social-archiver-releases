/**
 * Unit tests for PostShareService's archive-media resolve helper.
 *
 * We exercise the private `resolveArchiveMedia(...)` method directly (cast
 * through an interface) because the full `postAndShareCurrentNote()` flow
 * pulls in PostService + Vault I/O, which is covered elsewhere.
 *
 * Covers PRD §9.3 preconditions + §5.2 fail-open policy:
 *   - sourceArchiveId missing  → no resolve attempt
 *   - mediaSourceUrls missing  → no resolve attempt
 *   - happy path all resolved  → full map returned
 *   - partial resolve          → only non-null entries in the map
 *   - worker returns null      → null (fallback to legacy)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostShareService } from '@/plugin/session/PostShareService';
import type { ShareAPIClient } from '@/services/ShareAPIClient';
import type { Media } from '@/types/post';
import type {
  ResolveShareMediaHint,
  ResolveShareMediaResponse,
  ResolvedShareMediaItem,
} from '@/types/share';

// Expose the private helper for unit testing without loosening production types.
type ResolveArchiveMedia = (
  shareClient: ShareAPIClient,
  sourceArchiveId: string | undefined,
  frontmatter: Record<string, unknown>,
  media: Media[]
) => Promise<Map<number, ResolvedShareMediaItem> | null>;

function getHelper(service: PostShareService): ResolveArchiveMedia {
  // `resolveArchiveMedia` is a private method; cast strictly for testing.
  return (service as unknown as { resolveArchiveMedia: ResolveArchiveMedia }).resolveArchiveMedia.bind(service);
}

function makeService(): PostShareService {
  return new PostShareService({
    app: {} as never,
    settings: () => ({} as never),
    manifest: { version: '0.0.0-test' },
    refreshTimelineView: () => undefined,
  });
}

function makeMedia(n: number): Media[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'image' as const,
    url: `attachments/social-archives/x/img-${i}.jpg`,
  }));
}

function makeResolved(index: number): ResolvedShareMediaItem {
  return {
    sourceIndex: index,
    variant: 'primary',
    url: `https://r2.example.com/archives/u/arc_1/media/${index}.jpg`,
    r2Key: `archives/u/arc_1/media/${index}.jpg`,
    contentType: 'image/jpeg',
  };
}

// Minimal ShareAPIClient stub with spy-able resolveShareMedia.
function makeStubClient(
  impl: (archiveId: string, hints: ResolveShareMediaHint[]) => Promise<ResolveShareMediaResponse | null>
): { client: ShareAPIClient; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(impl);
  const client = { resolveShareMedia: spy } as unknown as ShareAPIClient;
  return { client, spy };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('PostShareService.resolveArchiveMedia', () => {
  let service: PostShareService;

  beforeEach(() => {
    service = makeService();
  });

  it('skips resolve entirely when sourceArchiveId is missing', async () => {
    const { client, spy } = makeStubClient(async () => null);
    const resolve = getHelper(service);

    const result = await resolve(
      client,
      undefined,
      { mediaSourceUrls: ['https://cdn.example.com/a.jpg'] },
      makeMedia(1)
    );

    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips resolve when top-level media is empty', async () => {
    const { client, spy } = makeStubClient(async () => null);
    const resolve = getHelper(service);

    const result = await resolve(
      client,
      'arc_1',
      { mediaSourceUrls: ['https://cdn.example.com/a.jpg'] },
      []
    );

    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips resolve when mediaSourceUrls is missing or empty', async () => {
    const { client, spy } = makeStubClient(async () => null);
    const resolve = getHelper(service);

    expect(await resolve(client, 'arc_1', {}, makeMedia(1))).toBeNull();
    expect(await resolve(client, 'arc_1', { mediaSourceUrls: [] }, makeMedia(1))).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('builds hints from mediaSourceUrls and returns map of resolved items', async () => {
    const { client, spy } = makeStubClient(async (_archive, hints) => ({
      archiveId: 'arc_1',
      preservationStatus: 'completed',
      resolvedCount: hints.length,
      totalCount: hints.length,
      resolved: hints.map((_, i) => makeResolved(i)),
    }));
    const resolve = getHelper(service);

    const media = makeMedia(2);
    const result = await resolve(
      client,
      'arc_1',
      {
        mediaSourceUrls: [
          'https://cdn.example.com/a.jpg',
          'https://cdn.example.com/b.jpg',
        ],
      },
      media
    );

    expect(result).not.toBeNull();
    expect(result?.size).toBe(2);
    expect(result?.get(0)?.r2Key).toBe('archives/u/arc_1/media/0.jpg');

    expect(spy).toHaveBeenCalledTimes(1);
    const [archiveArg, hintsArg] = spy.mock.calls[0] as [string, ResolveShareMediaHint[]];
    expect(archiveArg).toBe('arc_1');
    expect(hintsArg).toHaveLength(2);
    expect(hintsArg[0]).toMatchObject({
      sourceIndex: 0,
      variant: 'primary',
      originalUrl: 'https://cdn.example.com/a.jpg',
      mediaType: 'image',
    });
    expect(hintsArg[1]?.originalUrl).toBe('https://cdn.example.com/b.jpg');
  });

  it('returns a partial map when only some entries resolve', async () => {
    const { client } = makeStubClient(async () => ({
      archiveId: 'arc_1',
      preservationStatus: 'partial',
      resolvedCount: 1,
      totalCount: 2,
      resolved: [makeResolved(0), null],
    }));
    const resolve = getHelper(service);

    const result = await resolve(
      client,
      'arc_1',
      {
        mediaSourceUrls: [
          'https://cdn.example.com/a.jpg',
          'https://cdn.example.com/b.jpg',
        ],
      },
      makeMedia(2)
    );

    expect(result).not.toBeNull();
    expect(result?.size).toBe(1);
    expect(result?.has(0)).toBe(true);
    expect(result?.has(1)).toBe(false);
  });

  it('returns null when worker signals no matches or returns null', async () => {
    const { client: c1 } = makeStubClient(async () => null);
    const { client: c2 } = makeStubClient(async () => ({
      archiveId: 'arc_1',
      preservationStatus: 'not_found',
      resolvedCount: 0,
      totalCount: 1,
      resolved: [null],
    }));
    const resolve1 = getHelper(service);
    const resolve2 = getHelper(service);

    const fm = { mediaSourceUrls: ['https://cdn.example.com/a.jpg'] };
    expect(await resolve1(c1, 'arc_1', fm, makeMedia(1))).toBeNull();
    expect(await resolve2(c2, 'arc_1', fm, makeMedia(1))).toBeNull();
  });

  it('swallows thrown errors from the client and returns null (fail-open)', async () => {
    const { client, spy } = makeStubClient(async () => {
      throw new Error('boom');
    });
    const resolve = getHelper(service);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await resolve(
      client,
      'arc_1',
      { mediaSourceUrls: ['https://cdn.example.com/a.jpg'] },
      makeMedia(1)
    );

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});
