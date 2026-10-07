import { describe, expect, it, vi } from 'vitest';
import { MemberCollectionFeed } from '../../../../components/timeline/collections/MemberCollectionFeed';
import type { MemberCollectionPostItem, MemberCollectionViewPage } from '../../../../types/collections';

const page: MemberCollectionViewPage = {
  collection: {
    id: 'col-shared1', name: 'Shared', description: null, ownerUsername: 'bob', visibility: 'private',
    displayMode: 'timeline', role: 'editor', memberCount: 2, shareUrl: null, updatedAt: '2026-10-05T00:00:00.000Z',
  },
  items: [{
    kind: 'post',
    archiveId: 'a1',
    addedAt: '2026-10-05T10:00:00.000Z',
    addedBy: 'carol',
    post: {
      platform: 'x',
      author: { name: 'Alice' },
      postedAt: '2026-09-01T10:00:00.000Z',
      archivedAt: '2026-09-20T10:00:00.000Z',
    },
  }],
  nextCursor: null,
} as MemberCollectionViewPage;

describe('MemberCollectionFeed', () => {
  it('shows when a post was added to the collection, not when it was archived', async () => {
    const feed = new MemberCollectionFeed({
      loadPage: vi.fn().mockResolvedValue({ ok: true, value: page }),
      resolveFilePath: () => null,
      openFile: vi.fn(),
      openUrl: vi.fn(),
      canRemove: false,
      remove: vi.fn(),
    });
    const parent = document.createElement('div');
    feed.mount(parent);

    await vi.waitFor(() => expect(parent.querySelector('.sa-member-card-meta')).not.toBeNull());
    const date = (iso: string) => new Date(iso).toLocaleDateString();
    expect(parent.querySelector('.sa-member-card-meta')?.textContent)
      .toBe(`x · ${date('2026-09-01T10:00:00.000Z')} · added ${date('2026-10-05T10:00:00.000Z')}`);
  });

  it("shows members' shared notes read-only, not their highlights", async () => {
    const shared: MemberCollectionViewPage = {
      ...page,
      items: [{
        ...(page.items[0] as MemberCollectionPostItem),
        sharedAnnotations: [
          { kind: 'note', id: 'n1', authorUsername: 'carol', content: 'Worth a visit', createdAt: '2026-10-05T11:00:00.000Z', updatedAt: '2026-10-05T11:00:00.000Z' },
          { kind: 'highlight', id: 'h1', authorUsername: 'bob', createdAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z' },
        ],
      }],
    };
    const feed = new MemberCollectionFeed({
      loadPage: vi.fn().mockResolvedValue({ ok: true, value: shared }),
      resolveFilePath: () => null,
      openFile: vi.fn(),
      openUrl: vi.fn(),
      canRemove: false,
      remove: vi.fn(),
    });
    const parent = document.createElement('div');
    feed.mount(parent);

    await vi.waitFor(() => expect(parent.querySelector('.sa-member-card-notes')).not.toBeNull());
    const notes = [...parent.querySelectorAll('.sa-member-card-note')];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toContain('@carol');
    expect(notes[0]?.textContent).toContain('Worth a visit');
  });
});
