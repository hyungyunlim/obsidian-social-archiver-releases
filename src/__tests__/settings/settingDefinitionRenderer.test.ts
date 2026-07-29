import { describe, it, expect, beforeEach } from 'vitest';
import type { Setting, SettingDefinitionItem } from 'obsidian';
import { renderSettingDefinitions } from '../../settings/settingDefinitionRenderer';

/**
 * `renderSettingDefinitions` is the pre-1.13 half of the declarative settings
 * migration: Obsidian 1.13+ renders the definition tree itself, and everything
 * back to minAppVersion 1.10.0 goes through here. If the two ever disagree, the
 * settings tab silently loses rows on one side, so pin the structure the walker
 * produces.
 */
describe('renderSettingDefinitions', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  const names = (): string[] => Array.from(
    container.querySelectorAll('.setting-item:not(.setting-item-heading) .setting-item-name'),
  ).map((el) => el.textContent ?? '');

  const headings = (): string[] => Array.from(
    container.querySelectorAll('.setting-item-heading .setting-item-name'),
  ).map((el) => el.textContent ?? '');

  it('renders a group heading followed by its rows', () => {
    renderSettingDefinitions(container, [{
      type: 'group',
      heading: 'View',
      items: [
        { name: 'Default view location', desc: 'Where views open by default.', render: () => undefined },
        { name: 'Timeline view', desc: 'Override the default location.', render: () => undefined },
      ],
    }]);

    expect(headings()).toEqual(['View']);
    expect(names()).toEqual(['Default view location', 'Timeline view']);
    expect(
      container.querySelector('.setting-item:not(.setting-item-heading) .setting-item-description')
        ?.textContent,
    ).toBe('Where views open by default.');
  });

  it('passes each row its own Setting so render callbacks build into it', () => {
    const seen: Setting[] = [];
    renderSettingDefinitions(container, [{
      type: 'group',
      heading: 'View',
      items: [
        { name: 'A', render: (setting) => { seen.push(setting); } },
        { name: 'B', render: (setting) => { seen.push(setting); } },
      ],
    }]);

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]?.nameEl.textContent).toBe('A');
  });

  it('exposes a container through the group argument', () => {
    let listEl: HTMLElement | null = null;
    renderSettingDefinitions(container, [{
      type: 'group',
      heading: 'Account',
      items: [{ name: 'Auth', render: (_setting, group) => { listEl = group.listEl; } }],
    }]);

    // Svelte-mounted sections need a real element to mount into; on 1.13+
    // Obsidian supplies the SettingGroup, pre-1.13 the walker shims it.
    expect(listEl).toBeInstanceOf(HTMLElement);
  });

  it('skips rows whose visible predicate is false', () => {
    let enabled = false;
    const items: SettingDefinitionItem[] = [{
      type: 'group',
      heading: 'Author',
      items: [
        { name: 'Enable author notes', render: () => undefined },
        { name: 'Author notes folder', visible: () => enabled, render: () => undefined },
        { name: 'Always shown', visible: true, render: () => undefined },
      ],
    }];

    renderSettingDefinitions(container, items);
    expect(names()).toEqual(['Enable author notes', 'Always shown']);

    enabled = true;
    container.replaceChildren();
    renderSettingDefinitions(container, items);
    expect(names()).toEqual(['Enable author notes', 'Author notes folder', 'Always shown']);
  });

  it('renders page items inline rather than dropping them', () => {
    renderSettingDefinitions(container, [{
      type: 'page',
      name: 'Advanced',
      items: [{ name: 'Nested row', render: () => undefined }],
    }]);

    expect(headings()).toEqual(['Advanced']);
    expect(names()).toEqual(['Nested row']);
  });

  it('only wraps a group in its own element when it asks for a class', () => {
    renderSettingDefinitions(container, [
      { type: 'group', heading: 'Plain', items: [{ name: 'row', render: () => undefined }] },
    ]);
    // No wrapper: rows stay siblings of the heading so existing CSS still matches.
    expect(container.querySelector(':scope > div.setting-item')).not.toBeNull();

    container.replaceChildren();
    renderSettingDefinitions(container, [
      { type: 'group', heading: 'Classed', cls: 'sa-group', items: [{ name: 'row', render: () => undefined }] },
    ]);
    expect(container.querySelector('.sa-group .setting-item')).not.toBeNull();
  });
});
