import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settingTabStrings } from '../../i18n/strings/settingTab';

describe('Obsidian map provider settings surface', () => {
  it('enables the account dropdown only after authoritative preferences load', () => {
    // Given: the native settings source around the provider controller load boundary.
    const source = readFileSync('src/settings/SettingTab.ts', 'utf8');
    const loadStart = source.indexOf('void controller.load()');
    const loadEnd = source.indexOf('return dropdown;', loadStart);
    const loadFlow = source.slice(loadStart, loadEnd);
    const failureStart = loadFlow.indexOf('.catch(error =>');

    // When: success and failure continuations are inspected independently.
    const successFlow = loadFlow.slice(0, failureStart);
    const failureFlow = loadFlow.slice(failureStart);

    // Then: load failure leaves the initially disabled control fail-closed.
    expect(loadStart).toBeGreaterThan(-1);
    expect(loadEnd).toBeGreaterThan(loadStart);
    expect(failureStart).toBeGreaterThan(-1);
    expect(successFlow).toContain('dropdown.setDisabled(false)');
    expect(failureFlow).not.toContain('dropdown.setDisabled(false)');
    // Failure copy is i18n-keyed; assert the call sites and the English resource.
    expect(failureFlow).toContain("t('st.archive.placeSearch.loadFailed'");
    expect(failureFlow).toContain("t('st.archive.placeSearch.loadFailedGeneric')");
    expect(settingTabStrings['st.archive.placeSearch.loadFailed'].en).toContain(
      'Failed to load place search provider'
    );
    expect(settingTabStrings['st.archive.placeSearch.loadFailedGeneric'].en).toContain(
      'Failed to load place search provider'
    );
  });
});
