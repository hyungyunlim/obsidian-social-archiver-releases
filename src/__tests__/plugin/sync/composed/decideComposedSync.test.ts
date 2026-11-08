import { describe, expect, it } from 'vitest';
import { decideComposedSync } from '@/plugin/sync/composed/decideComposedSync';

describe('decideComposedSync (PRD §3 table)', () => {
  it.each([
    [false, 3, 3, 'none'],
    [true, 3, 3, 'push'],
    [false, 4, 3, 'pull'],
    [true, 4, 3, 'conflict'],
  ] as const)('noteChanged=%s server=%i synced=%i → %s', (noteChanged, serverRevision, syncedRevision, action) => {
    expect(decideComposedSync({ noteChanged, serverRevision, syncedRevision })).toBe(action);
  });

  it('a server behind the baseline is not a server change', () => {
    expect(decideComposedSync({ noteChanged: false, serverRevision: 2, syncedRevision: 3 })).toBe('none');
  });
});
