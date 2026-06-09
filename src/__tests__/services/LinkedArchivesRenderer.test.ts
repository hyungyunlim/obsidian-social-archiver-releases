/**
 * LinkedArchivesRenderer — Unit Tests
 *
 * Tests the pure markdown rendering of `RelationWithSummary[]` into the managed
 * `## Linked archives` block. No Obsidian API, no network.
 */

import { describe, it, expect } from 'vitest';
import {
  LinkedArchivesRenderer,
  type LinkRelationResolvers,
  LINKED_ARCHIVES_START_MARKER,
  LINKED_ARCHIVES_END_MARKER,
} from '../../services/LinkedArchivesRenderer';
import type {
  RelationWithSummary,
  ArchiveLinkRelation,
  EmbeddedArchiveSummary,
  LinkRelationType,
} from '../../types/link-relations';

// ─── Fixtures ────────────────────────────────────────────

const SELF = 'self-archive-id';

function makeRelation(overrides: Partial<ArchiveLinkRelation> = {}): ArchiveLinkRelation {
  return {
    id: 'rel-1',
    sourceArchiveId: SELF,
    targetArchiveId: 'other-archive-id',
    targetAuthorKey: null,
    targetUrl: 'https://example.com/post/1',
    normalizedTargetUrl: 'https://example.com/post/1',
    relationType: 'inline_markdown',
    anchorText: null,
    contextSnippet: null,
    status: 'connected',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<EmbeddedArchiveSummary> = {}): EmbeddedArchiveSummary {
  return {
    id: 'other-archive-id',
    platform: 'x',
    originalUrl: 'https://example.com/post/1',
    title: 'Other post title',
    authorName: 'Author',
    authorHandle: '@author',
    contentText: 'content',
    ...overrides,
  };
}

function entry(
  relation: Partial<ArchiveLinkRelation>,
  summary: EmbeddedArchiveSummary | null = makeSummary(),
): RelationWithSummary {
  return { relation: makeRelation(relation), otherArchive: summary };
}

/** Resolver that resolves a fixed set of archive ids to wikilinks. */
function resolverFor(resolvable: Record<string, string>): LinkRelationResolvers {
  return {
    resolveArchiveLink(archiveId, alias) {
      const base = resolvable[archiveId];
      if (!base) return null;
      return `[[${base}|${alias}]]`;
    },
  };
}

const NO_RESOLVE: LinkRelationResolvers = {
  resolveArchiveLink: () => null,
};

// ─── Tests ───────────────────────────────────────────────

describe('LinkedArchivesRenderer', () => {
  describe('empty / nothing to render', () => {
    it('returns empty string when there are no relations', () => {
      const r = new LinkedArchivesRenderer(NO_RESOLVE);
      expect(r.render({ relations: [], selfArchiveId: SELF })).toBe('');
    });

    it('returns empty string when only pending/failed relations exist', () => {
      const r = new LinkedArchivesRenderer(NO_RESOLVE);
      const out = r.render({
        relations: [
          entry({ id: 'a', status: 'pending' }),
          entry({ id: 'b', status: 'failed' }),
        ],
        selfArchiveId: SELF,
      });
      expect(out).toBe('');
    });

    it('returns empty string when the only outgoing relation is a note mention (excluded)', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'other-archive-id': 'Note' }));
      const out = r.render({
        relations: [entry({ relationType: 'note_mention' })],
        selfArchiveId: SELF,
      });
      expect(out).toBe('');
    });
  });

  describe('markers + structure', () => {
    it('wraps the block in the linked-archives markers with the H2 title', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'other-archive-id': '2026 Other' }));
      const out = r.render({ relations: [entry({})], selfArchiveId: SELF });
      expect(out.startsWith(LINKED_ARCHIVES_START_MARKER)).toBe(true);
      expect(out.endsWith(LINKED_ARCHIVES_END_MARKER)).toBe(true);
      expect(out).toContain('---');
      expect(out).toContain('## Linked archives');
      expect(out).toContain('**Links to**');
    });
  });

  describe('outgoing ("Links to") group', () => {
    it('renders a resolved outgoing relation as a wikilink with the summary title', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'other-archive-id': '2026 Other' }));
      const out = r.render({ relations: [entry({})], selfArchiveId: SELF });
      expect(out).toContain('- [[2026 Other|Other post title]]');
    });

    it('excludes note_mention AND note_author_mention from outgoing', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'other-archive-id': 'X' }));
      const types: LinkRelationType[] = ['note_mention', 'note_author_mention'];
      for (const relationType of types) {
        const out = r.render({
          relations: [entry({ relationType })],
          selfArchiveId: SELF,
        });
        expect(out).toBe('');
      }
    });

    it('falls back to external markdown link when the target note is unresolved', () => {
      const r = new LinkedArchivesRenderer(NO_RESOLVE);
      const out = r.render({
        relations: [entry({}, makeSummary({ originalUrl: 'https://ex.com/p/1', title: 'A title' }))],
        selfArchiveId: SELF,
      });
      expect(out).toContain('- [A title](https://ex.com/p/1)');
      expect(out).not.toContain('[[');
    });

    it('uses content preview for titleless social targets before falling back to URL', () => {
      const r = new LinkedArchivesRenderer(NO_RESOLVE);
      const out = r.render({
        relations: [
          entry(
            { anchorText: null },
            makeSummary({
              platform: 'facebook',
              originalUrl: 'https://facebook.com/example/posts/1',
              title: null,
              contentText: 'A titleless social post with useful body text.',
            }),
          ),
        ],
        selfArchiveId: SELF,
      });
      expect(out).toContain('- [A titleless social post with useful body text.](https://facebook.com/example/posts/1)');
      expect(out).not.toContain('[https://example.com/post/1]');
    });

    it('falls back to plain text when unresolved and otherArchive is null with no URL', () => {
      const r = new LinkedArchivesRenderer(NO_RESOLVE);
      const out = r.render({
        relations: [
          entry(
            { anchorText: 'just text', targetUrl: '', normalizedTargetUrl: 'norm', relationType: 'plain_url' },
            null,
          ),
        ],
        selfArchiveId: SELF,
      });
      expect(out).toContain('- just text');
    });
  });

  describe('incoming ("Linked from") group', () => {
    it('renders incoming relations where self is the target', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'source-x': 'Source Note' }));
      const out = r.render({
        relations: [
          entry(
            { id: 'in-1', sourceArchiveId: 'source-x', targetArchiveId: SELF },
            makeSummary({ id: 'source-x', title: 'Source title' }),
          ),
        ],
        selfArchiveId: SELF,
      });
      expect(out).toContain('**Linked from**');
      expect(out).toContain('- [[Source Note|Source title]]');
    });

    it('INCLUDES note_mention in the incoming group', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'source-x': 'Source Note' }));
      const out = r.render({
        relations: [
          entry(
            { id: 'in-1', sourceArchiveId: 'source-x', targetArchiveId: SELF, relationType: 'note_mention' },
            makeSummary({ id: 'source-x', title: 'Source title' }),
          ),
        ],
        selfArchiveId: SELF,
      });
      expect(out).toContain('**Linked from**');
      expect(out).toContain('- [[Source Note|Source title]]');
    });
  });

  describe('dedup + ordering', () => {
    it('dedups rows by target archive id', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'dup-target': 'Dup' }));
      const out = r.render({
        relations: [
          entry({ id: 'a', targetArchiveId: 'dup-target', updatedAt: '2026-06-02T00:00:00.000Z' }, makeSummary({ id: 'dup-target', title: 'Dup title' })),
          entry({ id: 'b', targetArchiveId: 'dup-target', updatedAt: '2026-06-03T00:00:00.000Z' }, makeSummary({ id: 'dup-target', title: 'Dup title' })),
        ],
        selfArchiveId: SELF,
      });
      const occurrences = out.split('- [[Dup|Dup title]]').length - 1;
      expect(occurrences).toBe(1);
    });

    it('orders rows by updatedAt DESC then id ASC (deterministic)', () => {
      const r = new LinkedArchivesRenderer(
        resolverFor({ t1: 'Note1', t2: 'Note2', t3: 'Note3' }),
      );
      const out = r.render({
        relations: [
          entry({ id: 'c', targetArchiveId: 't1', updatedAt: '2026-06-01T00:00:00.000Z' }, makeSummary({ id: 't1', title: 'T1' })),
          entry({ id: 'a', targetArchiveId: 't2', updatedAt: '2026-06-05T00:00:00.000Z' }, makeSummary({ id: 't2', title: 'T2' })),
          entry({ id: 'b', targetArchiveId: 't3', updatedAt: '2026-06-05T00:00:00.000Z' }, makeSummary({ id: 't3', title: 'T3' })),
        ],
        selfArchiveId: SELF,
      });
      const idxT2 = out.indexOf('[[Note2|T2]]');
      const idxT3 = out.indexOf('[[Note3|T3]]');
      const idxT1 = out.indexOf('[[Note1|T1]]');
      // newest (t2/t3 share updatedAt → id asc: a < b → t2 before t3); t1 oldest last
      expect(idxT2).toBeGreaterThan(-1);
      expect(idxT2).toBeLessThan(idxT3);
      expect(idxT3).toBeLessThan(idxT1);
    });

    it('is byte-identical across re-renders for the same input (idempotent)', () => {
      const r = new LinkedArchivesRenderer(resolverFor({ 'other-archive-id': 'Other' }));
      const relations = [entry({})];
      const out1 = r.render({ relations, selfArchiveId: SELF }, 'note.md');
      const out2 = r.render({ relations, selfArchiveId: SELF }, 'note.md');
      expect(out1).toBe(out2);
    });
  });

  describe('title fallback chain', () => {
    it('uses anchorText when summary title is absent', () => {
      const r = new LinkedArchivesRenderer(NO_RESOLVE);
      const out = r.render({
        relations: [
          entry(
            { anchorText: 'Anchor label', relationType: 'plain_url' },
            makeSummary({ title: null, originalUrl: 'https://ex.com/x' }),
          ),
        ],
        selfArchiveId: SELF,
      });
      expect(out).toContain('[Anchor label](https://ex.com/x)');
    });

    it('falls back to normalizedTargetUrl when neither title nor anchor exists', () => {
      const r = new LinkedArchivesRenderer(NO_RESOLVE);
      const out = r.render({
        relations: [
          entry(
            { anchorText: null, normalizedTargetUrl: 'https://ex.com/norm', relationType: 'plain_url' },
            makeSummary({ title: null, contentText: null, originalUrl: 'https://ex.com/orig' }),
          ),
        ],
        selfArchiveId: SELF,
      });
      expect(out).toContain('[https://ex.com/norm](https://ex.com/orig)');
    });
  });

  describe('alias sanitization', () => {
    it('strips wikilink-breaking chars from the alias passed to the resolver', () => {
      const captured: string[] = [];
      const resolvers: LinkRelationResolvers = {
        resolveArchiveLink(_id, alias) {
          captured.push(alias);
          return `[[note|${alias}]]`;
        },
      };
      const r = new LinkedArchivesRenderer(resolvers);
      r.render({
        relations: [entry({}, makeSummary({ title: 'a|b[[c]]#d^e' }))],
        selfArchiveId: SELF,
      });
      expect(captured[0]).toBe('a-bcde');
    });
  });
});
