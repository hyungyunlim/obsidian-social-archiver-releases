import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authStrings } from '../../i18n/strings/auth';

describe('Obsidian Cloud-credit settings surface', () => {
  it('renders one Cloud-credit balance with AI and Google Maps breakdown copy', () => {
    // Given: the account settings source used by the native Obsidian settings tab.
    const source = readFileSync('src/settings/AuthSettingsTab.svelte', 'utf8');

    // When/Then: legacy AI quota remains a data alias, not a second visible balance.
    // The label is i18n-keyed; assert the call site and the English resource.
    expect(source).toContain("t('auth.billing.cloudCredits')");
    expect(authStrings['auth.billing.cloudCredits'].en).toBe('Cloud credits');
    expect(source).toContain('Google Maps:');
    expect(source).toContain('AI:');
    expect(source).not.toContain('<div class="billing-usage-label">AI credits</div>');
  });
});
