import { Setting } from 'obsidian';
import type { SettingDefinitionItem, SettingGroup } from 'obsidian';

const SECTION_HEADER_CLS = 'sa-settings-section-header';
const FIRST_SECTION_HEADER_CLS = 'sa-settings-section-header-first';

/**
 * Renders a `getSettingDefinitions()` tree imperatively, for Obsidian versions
 * older than 1.13.0 where `PluginSettingTab.display()` is still the entry point.
 *
 * This exists so the definition tree is the SINGLE source of truth for the
 * settings UI: 1.13+ renders it natively (and indexes it for settings search),
 * everything back to `minAppVersion` 1.10.0 renders it through here. Without
 * this the tab would have to carry two parallel copies of every row.
 *
 * Only the subset of the definition schema this plugin actually emits is
 * handled — groups, and items that render themselves via `render`. Declarative
 * `control` items are deliberately not supported: reimplementing Obsidian's
 * control binding is exactly the duplication this module exists to avoid, so
 * every row keeps its existing imperative builder body inside `render`.
 */
/**
 * Turn a definition row's settingEl into a block host for custom content
 * (Svelte islands, prose blocks).
 *
 * The content must live INSIDE the settingEl. Obsidian 1.13's group renderer
 * re-parents its tracked settingEls after every render pass
 * (`listEl.setChildrenInPlace([...settingEls])`), so nodes mounted next to the
 * row — the old `settingEl.remove(); mount(parent)` trick — are dropped from
 * the DOM and whole sections silently vanish (feedback #108 follow-up: the
 * Account section, and with it the signed-out "Sign in" flow, disappeared on
 * Obsidian 1.13).
 */
export function islandHost(setting: Setting): HTMLElement {
  const host = setting.settingEl;
  // Drop the name/desc scaffolding the renderer built; the island owns layout.
  host.empty();
  host.addClass('sa-settings-island-host');
  return host;
}

export function renderSettingDefinitions(
  containerEl: HTMLElement,
  items: readonly SettingDefinitionItem[],
): void {
  for (const item of items) {
    if (!isVisible(item)) continue;

    // Only groups, lists and pages carry a top-level `type`; a plain setting
    // definition does not, so this splits the union cleanly.
    if ('type' in item) {
      // `page` entries are navigable on 1.13+; pre-1.13 there is no page
      // chrome, so render sub-items inline under a heading rather than drop
      // them.
      const heading = item.type === 'page' ? item.name : item.heading;
      if (heading) {
        // The topmost section sits tighter against the tab description, so it
        // takes the `-first` variant. Derived from what is already rendered
        // rather than declared, so it stays correct whether the tab is built
        // from one definition tree or from several separate calls.
        const isFirst = containerEl.querySelector(`.${SECTION_HEADER_CLS}, .${FIRST_SECTION_HEADER_CLS}`) === null;
        new Setting(containerEl).setName(heading).setHeading()
          .settingEl.addClass(isFirst ? FIRST_SECTION_HEADER_CLS : SECTION_HEADER_CLS);
      }
      // Render straight into the parent unless the group asks for its own
      // class — an unconditional wrapper div would change sibling selectors
      // the existing settings CSS relies on.
      const cls = item.type !== 'page' ? item.cls : undefined;
      const body = cls ? containerEl.createDiv({ cls }) : containerEl;
      renderSettingDefinitions(body, item.items ?? []);
      continue;
    }

    const setting = new Setting(containerEl);
    if (item.name) setting.setName(item.name);
    if (item.desc !== undefined) setting.setDesc(item.desc);
    if ('render' in item && item.render) {
      // ponytail: the shim only needs listEl — that is all our render callbacks
      // touch, and on 1.13+ Obsidian passes the real SettingGroup instead.
      item.render(setting, { listEl: containerEl } as SettingGroup);
    }
  }
}

function isVisible(item: SettingDefinitionItem): boolean {
  if (!('visible' in item) || item.visible === undefined) return true;
  return typeof item.visible === 'function' ? item.visible() : item.visible;
}
