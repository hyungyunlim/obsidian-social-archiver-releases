import { describe, it, expect } from 'vitest';
import { joinPostAuthorNames } from '@/components/timeline/renderers/postAuthorsLabel';

describe('joinPostAuthorNames (share-web parity)', () => {
  it('shows up to two names, then +n', () => {
    expect(joinPostAuthorNames(['Work'])).toBe('Work');
    expect(joinPostAuthorNames(['Work', 'Club'])).toBe('Work, Club');
    expect(joinPostAuthorNames(['Work', 'Club', 'Me', 'Team'])).toBe('Work, Club +2');
  });

  it('takes a custom count', () => {
    expect(joinPostAuthorNames(['A', 'B', 'C'], 1)).toBe('A +2');
  });
});
