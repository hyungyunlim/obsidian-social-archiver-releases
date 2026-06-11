import { describe, it, expect } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { ClipPayloadCodec } from '@/services/clip/ClipPayloadCodec';
import { CLIP_CLIPBOARD_MARKER, ClipPayloadError } from '@/types/clip';
import type { ClipPayloadErrorReason } from '@/types/clip';

/** Minimal valid PostData as a clip sender (browser extension) would emit it over JSON. */
function basePostData(): Record<string, unknown> {
  return {
    platform: 'instagram',
    id: 'DEMO123',
    url: 'https://www.instagram.com/p/DEMO123/',
    author: {
      name: 'Demo User',
      url: 'https://www.instagram.com/demo/',
    },
    content: {
      text: 'Hello from a clipped post',
    },
    media: [
      {
        type: 'image',
        url: 'https://cdn.example.com/img.jpg',
      },
    ],
    metadata: {
      timestamp: '2026-06-01T12:00:00.000Z',
      likes: 10,
    },
  };
}

function makeCompressedEnvelope(
  postDataOverrides: Record<string, unknown> = {},
  envelopeOverrides: Record<string, unknown> = {}
): string {
  const envelope = {
    v: 1,
    source: 'chrome-extension',
    sourceVersion: '1.7.0',
    clippedAt: '2026-06-10T09:00:00.000Z',
    postData: { ...basePostData(), ...postDataOverrides },
    ...envelopeOverrides,
  };
  return compressToEncodedURIComponent(JSON.stringify(envelope));
}

function expectClipError(fn: () => unknown, reason?: ClipPayloadErrorReason): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ClipPayloadError);
    if (reason) {
      expect((error as ClipPayloadError).reason).toBe(reason);
    }
    return;
  }
  throw new Error('Expected ClipPayloadError to be thrown');
}

describe('ClipPayloadCodec', () => {
  const codec = new ClipPayloadCodec();

  describe('decode (inline payload)', () => {
    it('round-trips a valid envelope', () => {
      const payload = codec.decode(makeCompressedEnvelope());

      expect(payload.v).toBe(1);
      expect(payload.source).toBe('chrome-extension');
      expect(payload.sourceVersion).toBe('1.7.0');
      expect(payload.clippedAt).toBe('2026-06-10T09:00:00.000Z');
      expect(payload.postData.platform).toBe('instagram');
      expect(payload.postData.id).toBe('DEMO123');
      expect(payload.postData.url).toBe('https://www.instagram.com/p/DEMO123/');
      expect(payload.postData.author.name).toBe('Demo User');
      expect(payload.postData.media).toHaveLength(1);
      expect(payload.postData.metadata.likes).toBe(10);
    });

    it('accepts surrounding whitespace', () => {
      const payload = codec.decode(`  ${makeCompressedEnvelope()}  `);
      expect(payload.postData.id).toBe('DEMO123');
    });

    it('defaults mediaDelivery to remote and passes through local', () => {
      expect(codec.decode(makeCompressedEnvelope()).mediaDelivery).toBe('remote');
      expect(
        codec.decode(makeCompressedEnvelope({}, { mediaDelivery: 'local' })).mediaDelivery
      ).toBe('local');
      // Unknown future modes must not suppress downloads.
      expect(
        codec.decode(makeCompressedEnvelope({}, { mediaDelivery: 'carrier-pigeon' })).mediaDelivery
      ).toBe('remote');
    });

    it('strips unknown keys from postData (sanitization)', () => {
      const payload = codec.decode(
        makeCompressedEnvelope({ maliciousField: 'x', share: true })
      );
      expect('maliciousField' in (payload.postData as object)).toBe(false);
      expect('share' in (payload.postData as object)).toBe(false);
    });

    it('revives publishedDate/archivedDate ISO strings into Date objects', () => {
      const payload = codec.decode(
        makeCompressedEnvelope({
          publishedDate: '2026-05-01T00:00:00.000Z',
          archivedDate: '2026-06-01T00:00:00.000Z',
        })
      );
      expect(payload.postData.publishedDate).toBeInstanceOf(Date);
      expect(payload.postData.archivedDate).toBeInstanceOf(Date);
      expect(payload.postData.publishedDate?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    });

    it('drops unparseable date strings instead of failing', () => {
      const payload = codec.decode(
        makeCompressedEnvelope({ publishedDate: 'not-a-date' })
      );
      expect(payload.postData.publishedDate).toBeUndefined();
    });

    it('drops string author.lastMetadataUpdate (re-derived at archive time)', () => {
      const payload = codec.decode(
        makeCompressedEnvelope({
          author: {
            name: 'Demo User',
            url: 'https://www.instagram.com/demo/',
            lastMetadataUpdate: '2026-06-01T00:00:00.000Z',
          },
        })
      );
      expect(payload.postData.author.lastMetadataUpdate).toBeUndefined();
    });

    it('drops string lastMetadataUpdate on comment authors (incl. replies)', () => {
      const commentAuthor = {
        name: 'Commenter',
        url: 'https://www.instagram.com/c/',
        lastMetadataUpdate: '2026-06-01T00:00:00.000Z',
      };
      const payload = codec.decode(
        makeCompressedEnvelope({
          comments: [
            {
              id: 'c1',
              author: commentAuthor,
              content: 'Nice post',
              replies: [{ id: 'c2', author: commentAuthor, content: 'Agreed' }],
            },
          ],
        })
      );
      expect(payload.postData.comments?.[0]?.author.lastMetadataUpdate).toBeUndefined();
    });

    it('rejects empty payloads', () => {
      expectClipError(() => codec.decode(''), 'empty');
      expectClipError(() => codec.decode(undefined), 'empty');
      expectClipError(() => codec.decode(null), 'empty');
    });

    it('rejects garbage that is not lz-string output', () => {
      expectClipError(() => codec.decode('not!!compressed**data'));
    });

    it('rejects decompressed content that is not valid JSON', () => {
      const compressed = compressToEncodedURIComponent('{oops, not json');
      expectClipError(() => codec.decode(compressed), 'invalid_json');
    });

    it('rejects non-object envelopes', () => {
      const compressed = compressToEncodedURIComponent(JSON.stringify('just a string'));
      expectClipError(() => codec.decode(compressed), 'invalid_envelope');
    });

    it('rejects unsupported envelope versions', () => {
      expectClipError(
        () => codec.decode(makeCompressedEnvelope({}, { v: 2 })),
        'unsupported_version'
      );
    });

    it('rejects envelopes without a source', () => {
      expectClipError(
        () => codec.decode(makeCompressedEnvelope({}, { source: '' })),
        'invalid_envelope'
      );
    });

    it('rejects envelopes without postData', () => {
      expectClipError(
        () => codec.decode(makeCompressedEnvelope({}, { postData: undefined })),
        'invalid_envelope'
      );
    });

    it('rejects postData failing schema validation (missing platform)', () => {
      const invalid = basePostData();
      delete invalid.platform;
      const compressed = compressToEncodedURIComponent(
        JSON.stringify({ v: 1, source: 'chrome-extension', postData: invalid })
      );
      expectClipError(() => codec.decode(compressed), 'invalid_post_data');
    });

    it('rejects postData with empty id or url', () => {
      expectClipError(
        () => codec.decode(makeCompressedEnvelope({ id: '   ' })),
        'invalid_post_data'
      );
      expectClipError(
        () => codec.decode(makeCompressedEnvelope({ url: '' })),
        'invalid_post_data'
      );
    });

    it('rejects payloads exceeding the decompressed size cap', () => {
      const huge = 'a'.repeat(ClipPayloadCodec.MAX_DECOMPRESSED_BYTES + 1024);
      const compressed = makeCompressedEnvelope({ content: { text: huge } });
      expectClipError(() => codec.decode(compressed), 'too_large');
    });
  });

  describe('decodeClipboardText (clipboard handoff)', () => {
    it('round-trips marker-prefixed clipboard content', () => {
      const clipboard = `${CLIP_CLIPBOARD_MARKER}${makeCompressedEnvelope()}`;
      const payload = codec.decodeClipboardText(clipboard);
      expect(payload.postData.id).toBe('DEMO123');
    });

    it('rejects empty clipboard', () => {
      expectClipError(() => codec.decodeClipboardText(''), 'empty');
      expectClipError(() => codec.decodeClipboardText(undefined), 'empty');
    });

    it('rejects clipboard content without the marker', () => {
      expectClipError(
        () => codec.decodeClipboardText(makeCompressedEnvelope()),
        'invalid_envelope'
      );
      expectClipError(
        () => codec.decodeClipboardText('some unrelated clipboard text'),
        'invalid_envelope'
      );
    });
  });
});
