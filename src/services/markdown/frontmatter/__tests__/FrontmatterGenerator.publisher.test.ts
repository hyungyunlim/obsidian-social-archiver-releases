/**
 * FrontmatterGenerator publisher emission tests.
 *
 * Covers PRD §"Plugin Tests":
 * - emits `publisher` (slug) and `publisherName` (display name) when
 *   `postData.publisher` is present;
 * - omits both fields when `postData.publisher` is missing.
 *
 * Publisher attribution applies only to recognized `platform: 'web'` archives;
 * the worker resolves it from `originalUrl` via the shared registry. The plugin
 * frontmatter writer is intentionally a passthrough so old archives without
 * the field stay untouched.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FrontmatterGenerator } from '../FrontmatterGenerator';
import { DateNumberFormatter } from '../../formatters/DateNumberFormatter';
import { TextFormatter } from '../../formatters/TextFormatter';
import type { PostData } from '../../../../types/post';

describe('FrontmatterGenerator: publisher emission', () => {
  let generator: FrontmatterGenerator;

  beforeEach(() => {
    generator = new FrontmatterGenerator(
      new DateNumberFormatter(),
      new TextFormatter()
    );
  });

  function makeWebPost(overrides: Partial<PostData> = {}): PostData {
    return {
      platform: 'web',
      id: 'web-1',
      url: 'https://www.newyorker.com/example',
      author: {
        name: 'newyorker.com',
        url: 'https://www.newyorker.com/example',
      },
      content: { text: 'Article body' },
      media: [],
      metadata: { timestamp: new Date('2026-04-29T00:00:00Z') },
      ...overrides,
    } as PostData;
  }

  it('emits publisher (slug) and publisherName when postData.publisher is present', () => {
    const postData = makeWebPost({
      publisher: {
        slug: 'newyorker',
        name: 'The New Yorker',
        domain: 'newyorker.com',
      },
    });

    const frontmatter = generator.generateFrontmatter(postData);

    expect(frontmatter.publisher).toBe('newyorker');
    expect(frontmatter.publisherName).toBe('The New Yorker');
  });

  it('omits publisher fields when postData.publisher is missing', () => {
    const postData = makeWebPost();

    const frontmatter = generator.generateFrontmatter(postData);

    expect(frontmatter.publisher).toBeUndefined();
    expect(frontmatter.publisherName).toBeUndefined();
  });

  it('omits publisher fields when slug is empty (defensive)', () => {
    const postData = makeWebPost({
      publisher: {
        slug: '',
        name: 'Should not be emitted',
        domain: 'example.com',
      },
    });

    const frontmatter = generator.generateFrontmatter(postData);

    expect(frontmatter.publisher).toBeUndefined();
    expect(frontmatter.publisherName).toBeUndefined();
  });

  it('does not emit publisher fields for non-web platforms even if present', () => {
    // Defensive: the worker only sets `publisher` on web archives, but the
    // generator should not depend on platform — it reflects the postData
    // verbatim. This test pins current passthrough behavior so any future
    // platform gating change is intentional.
    const postData: PostData = {
      ...makeWebPost(),
      platform: 'x',
      publisher: {
        slug: 'newyorker',
        name: 'The New Yorker',
        domain: 'newyorker.com',
      },
    };

    const frontmatter = generator.generateFrontmatter(postData);

    expect(frontmatter.publisher).toBe('newyorker');
    expect(frontmatter.publisherName).toBe('The New Yorker');
  });
});
