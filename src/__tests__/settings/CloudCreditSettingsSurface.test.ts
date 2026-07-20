import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Obsidian Cloud-credit settings surface', () => {
  it('renders one Cloud-credit balance with AI and Google Maps breakdown copy', () => {
    // Given: the account settings source used by the native Obsidian settings tab.
    const source = readFileSync('src/settings/AuthSettingsTab.svelte', 'utf8');

    // When/Then: legacy AI quota remains a data alias, not a second visible balance.
    expect(source).toContain('Cloud credits');
    expect(source).toContain('Google Maps:');
    expect(source).toContain('AI:');
    expect(source).not.toContain('<div class="billing-usage-label">AI credits</div>');
  });
});
