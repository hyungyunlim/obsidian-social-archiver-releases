import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposedConflictCopyWriter, CONFLICT_COPY_STRIPPED_FIELDS, conflictCopyPath } from '@/plugin/sync/composed/ComposedConflictCopyWriter';
import { resetRequestUrl, twoWayHarness } from './twoWayHarness';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  stringifyYaml: (value: unknown): string => `${JSON.stringify(value)}\n`,
  parseYaml: (block: string): unknown => (block.trim().startsWith('{') ? JSON.parse(block) : {}),
}));

describe('conflictCopyPath', () => {
  it('names the copy after the note, in local time, in the same folder', () => {
    const now = new Date(2026, 10, 8, 9, 5);
    expect(conflictCopyPath('Social Archives/Post', 'My post', now)).toBe('Social Archives/Post/My post (conflict 2026-11-08 09-05).md');
    expect(conflictCopyPath('/', 'Root note', now)).toBe('Root note (conflict 2026-11-08 09-05).md');
  });
});

describe('ComposedConflictCopyWriter', () => {
  afterEach(() => resetRequestUrl());

  it('copies the note without its identity, points back with conflictOf, and adds a suffix on collision', async () => {
    const h = twoWayHarness();
    const identity = Object.fromEntries(CONFLICT_COPY_STRIPPED_FIELDS.map((field) => [field, `v-${field}`]));
    const note = await h.vault.create('Posts/My post.md', `---\n${JSON.stringify({ ...identity, title: 'Kept', tags: ['a'] })}\n---\nVault text\n`);
    const writer = new ComposedConflictCopyWriter(h.app);
    const now = new Date(2026, 10, 8, 9, 5);

    const first = await writer.write(note, now);
    const second = await writer.write(note, now);

    expect(first.path).toBe('Posts/My post (conflict 2026-11-08 09-05).md');
    expect(second.path).toBe('Posts/My post (conflict 2026-11-08 09-05) 2.md');
    expect(h.read(first.path)).toContain('Vault text');
    expect(h.frontmatter.get(first.path)).toEqual({ title: 'Kept', tags: ['a'], conflictOf: '[[My post]]' });
    // The original is untouched.
    expect(h.frontmatter.get(note.path)).toMatchObject({ sourceArchiveId: 'v-sourceArchiveId' });
    // Created bare, so no moment exists where the copy carries the original's identity.
    expect(vi.mocked(h.vault.create).mock.calls[1]?.[1]).toBe('Vault text\n');
  });
});
