import { describe, expect, it } from 'vitest';
import guide from '../../../docs/en/guide/subscriptions.md?raw';

describe('subscription attention English guide copy', () => {
  it('uses the exact PRD product label in the heading, entry, and alert setting', () => {
    // Given: the published English subscription guide.
    // When: its subscription-attention product labels are inspected.
    // Then: every named surface uses the exact PRD label and the former label is absent.
    expect(guide).toContain('## Needs attention');
    expect(guide).toContain('compact **Needs attention** entry');
    expect(guide).toContain('The **Needs attention** alert setting');
    expect(guide).not.toContain('Subscriptions needing attention');
  });
});
