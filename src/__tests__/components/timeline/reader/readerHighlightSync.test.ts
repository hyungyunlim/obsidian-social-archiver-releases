import { describe, expect, it, vi } from 'vitest';
import type { TextHighlight } from '@/types/annotations';
import type { GetUserArchiveResponse } from '@/services/WorkersAPIClient';
import {
  applyReaderHighlightChange,
  syncReaderHighlightChange,
} from '@/components/timeline/reader/readerHighlightSync';

function hl(overrides: Partial<TextHighlight>): TextHighlight {
  return {
    id: 'hl',
    text: 'text',
    startOffset: 0,
    endOffset: 4,
    color: 'yellow',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

/** What reader mode rebuilds from a `==mark==`: new id, yellow, no note. */
function fromVaultMark(text: string, contextBefore = ''): TextHighlight {
  return hl({ id: `hl_vault_${text}`, text, contextBefore });
}

const serverNoted = hl({
  id: 'srv-1',
  text: 'least privilege',
  color: 'green',
  note: 'my note\n\nsecond paragraph',
  contextBefore: 'The principle of ',
});
const serverAI = hl({
  id: 'srv-2',
  text: ' defense in depth ',
  color: 'blue',
  note: '✦ AI 요약 · Apple Intelligence — layered controls',
  contextBefore: 'and also ',
});

function fakeClient(userHighlights: TextHighlight[] | undefined) {
  return {
    getUserArchive: vi.fn(async () => ({ archive: { userHighlights } }) as unknown as GetUserArchiveResponse),
    updateArchiveActions: vi.fn(async () => ({ success: true })),
  };
}

describe('applyReaderHighlightChange', () => {
  it('adds a new highlight and keeps every server highlight untouched', () => {
    const added = hl({ id: 'new', text: 'fresh' });
    const next = applyReaderHighlightChange([serverNoted, serverAI], { type: 'add', highlight: added });
    expect(next).toEqual([serverNoted, serverAI, added]);
  });

  it('does not duplicate a highlight the server already has', () => {
    const server = [serverNoted];
    expect(applyReaderHighlightChange(server, { type: 'add', highlight: serverNoted })).toBe(server);
  });

  it('removes by id when the reader highlight came from this session', () => {
    const next = applyReaderHighlightChange([serverNoted, serverAI], { type: 'remove', highlight: serverAI });
    expect(next).toEqual([serverNoted]);
  });

  it('maps a vault-mark highlight to the server one by trimmed text', () => {
    const next = applyReaderHighlightChange([serverNoted, serverAI], {
      type: 'remove',
      highlight: fromVaultMark('defense in depth'),
    });
    expect(next).toEqual([serverNoted]);
  });

  it('uses contextBefore to choose between repeated text', () => {
    const first = hl({ id: 'a', text: 'repeat', contextBefore: 'alpha ' });
    const second = hl({ id: 'b', text: 'repeat', contextBefore: 'bravo ' });
    const next = applyReaderHighlightChange([first, second], {
      type: 'remove',
      highlight: fromVaultMark('repeat', '...text before bravo '),
    });
    expect(next).toEqual([first]);
  });

  it('leaves the server array alone when nothing matches', () => {
    const server = [serverNoted];
    expect(applyReaderHighlightChange(server, { type: 'remove', highlight: fromVaultMark('unknown') })).toBe(server);
  });
});

describe('syncReaderHighlightChange', () => {
  // Regression: reader mode used to PATCH its ==mark==-rebuilt list, which
  // replaced the server array and wiped ids, colors and notes.
  it('PATCHes the server array plus the new highlight, preserving notes and colors', async () => {
    const client = fakeClient([serverNoted, serverAI]);
    const added = hl({ id: 'new', text: 'fresh', color: 'pink' });

    await syncReaderHighlightChange(client, 'archive-1', { type: 'add', highlight: added });

    expect(client.getUserArchive).toHaveBeenCalledWith('archive-1');
    expect(client.updateArchiveActions).toHaveBeenCalledWith('archive-1', {
      userHighlights: [serverNoted, serverAI, added],
    });
  });

  it('removing a vault-mark highlight keeps the other highlight notes', async () => {
    const client = fakeClient([serverNoted, serverAI]);

    await syncReaderHighlightChange(client, 'archive-1', {
      type: 'remove',
      highlight: fromVaultMark('least privilege', 'The principle of '),
    });

    expect(client.updateArchiveActions).toHaveBeenCalledWith('archive-1', { userHighlights: [serverAI] });
  });

  it('skips the PATCH when the change is a no-op', async () => {
    const client = fakeClient(undefined);

    await syncReaderHighlightChange(client, 'archive-1', { type: 'remove', highlight: fromVaultMark('x') });

    expect(client.updateArchiveActions).not.toHaveBeenCalled();
  });

  it('never PATCHes when the server read fails', async () => {
    const client = fakeClient([serverNoted]);
    client.getUserArchive.mockRejectedValueOnce(new Error('offline'));

    await expect(
      syncReaderHighlightChange(client, 'archive-1', { type: 'add', highlight: hl({ id: 'new' }) })
    ).rejects.toThrow('offline');
    expect(client.updateArchiveActions).not.toHaveBeenCalled();
  });
});
