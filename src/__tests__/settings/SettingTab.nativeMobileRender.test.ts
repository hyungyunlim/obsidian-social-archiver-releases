import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SettingDefinitionItem, SettingGroup } from 'obsidian';

/**
 * Feedback #199: the settings tab hung on Obsidian for iPhone before sign-in.
 *
 * Obsidian 1.13+ renders the definition tree itself, and unlike our pre-1.13
 * walker it calls `render` on EVERY row — hidden ones included — and applies
 * `visible` only afterwards (verified in the 1.13.7 and 1.14.4 app.js). Rows
 * hidden on mobile (Transcription's "Model variant", the Supertonic install
 * path) still ran and reached `nodeRequire`, which throws off desktop. The
 * throw escaped Obsidian's render pass inside `openTab()`, so on a phone the
 * tab never slid in and no row was ever shown or hidden.
 */

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');

  // A control component: real elements where the code touches them, every
  // other builder call chains.
  const component = (): unknown => {
    const target: Record<string, unknown> = {
      selectEl: document.createElement('select'),
      inputEl: document.createElement('input'),
      buttonEl: document.createElement('button'),
      toggleEl: document.createElement('div'),
      sliderEl: document.createElement('input'),
      then: undefined,
    };
    const proxy: unknown = new Proxy(target, {
      get: (t, prop: string) => (prop in t ? t[prop] : () => proxy),
    });
    return proxy;
  };

  class ControlSetting extends actual.Setting {
    private add(cb: (c: never) => unknown): this {
      cb(component() as never);
      return this;
    }
    addToggle = this.add;
    addDropdown = this.add;
    addText = this.add;
    addTextArea = this.add;
    addButton = this.add;
    addSlider = this.add;
    addExtraButton = this.add;
    setDisabled(): this { return this; }
  }

  return {
    ...actual,
    Setting: ControlSetting,
    Platform: {
      isDesktop: false,
      isDesktopApp: false,
      isMobile: true,
      isMobileApp: true,
      isIosApp: true,
      isAndroidApp: false,
      isPhone: true,
      isMacOS: false,
      isWin: false,
      isLinux: false,
    },
    PluginSettingTab: class {
      app: unknown;
      containerEl = document.createElement('div');
      constructor(app: unknown) { this.app = app; }
    },
    AbstractInputSuggest: class {},
    setIcon: () => undefined,
  };
});

// The plugin's vitest config has no Svelte transform, so the islands are
// stand-ins; `mount` records which of them the pass built.
const mounted = vi.hoisted(() => [] as unknown[]);
vi.mock('svelte', () => ({
  mount: (component: unknown) => { mounted.push(component); return {}; },
  unmount: () => undefined,
}));
vi.mock('../../settings/AuthSettingsTab.svelte', () => ({ default: 'AuthSettingsTab' }));
vi.mock('../../settings/SyncSettingsTab.svelte', () => ({ default: 'SyncSettingsTab' }));
vi.mock('../../settings/CrossPostSettingsTab.svelte', () => ({ default: 'CrossPostSettingsTab' }));
vi.mock('../../settings/DangerZone.svelte', () => ({ default: 'DangerZone' }));

import { Setting } from 'obsidian';
import { SocialArchiverSettingTab } from '../../settings/SettingTab';
import { DEFAULT_SETTINGS } from '../../types/settings';

// Obsidian DOM helpers the settings rows use that test/setup.ts lacks.
const helpers: Array<[object, string, (this: never, ...args: never[]) => unknown]> = [
  [Node.prototype, 'appendText', function (this: Node, text: string) { this.appendChild(document.createTextNode(text)); }],
  [Element.prototype, 'setAttr', function (this: Element, name: string, value: string) { this.setAttribute(name, value); }],
  [Element.prototype, 'setText', function (this: Element, text: string) { this.textContent = text; }],
  [HTMLElement.prototype, 'toggle', function (this: HTMLElement, show: boolean) { this.hidden = !show; }],
];
for (const [proto, name, value] of helpers) {
  if (!(name in proto)) Object.defineProperty(proto, name, { configurable: true, writable: true, value });
}

/** Obsidian 1.13+'s pass: render every row, then apply `visible`. */
function renderLikeObsidian113(container: HTMLElement, items: readonly SettingDefinitionItem[]): void {
  for (const item of items) {
    if ('type' in item) {
      renderLikeObsidian113(container, item.items ?? []);
      continue;
    }
    const setting = new Setting(container);
    setting.setName(item.name);
    if ('render' in item && item.render) {
      item.render(setting, { listEl: container } as SettingGroup);
    }
  }
}

function mobileTab(signedIn: boolean): SocialArchiverSettingTab {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (signedIn) Object.assign(settings, { authToken: 'token', isVerified: true, username: 'aleonel' });
  const api = new Proxy({}, { get: () => () => Promise.resolve(true) });
  const plugin = {
    settings,
    manifest: { id: 'social-archiver', version: '4.9.1' },
    workersApiClient: api,
    getReviewFeature: () => undefined,
    register: () => undefined,
    saveSettings: () => Promise.resolve(),
    saveSettingsPartial: () => Promise.resolve(),
  };
  const app = {
    vault: { getMarkdownFiles: () => [], getAllLoadedFiles: () => [], getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null },
  };
  return new SocialArchiverSettingTab(app as never, plugin as never);
}

describe('settings tab on Obsidian 1.13+ mobile (feedback #199)', () => {
  beforeEach(() => {
    mounted.length = 0;
  });

  it.each([false, true])('renders the whole tree without throwing (signed in: %s)', (signedIn) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    expect(() => renderLikeObsidian113(container, mobileTab(signedIn).getSettingDefinitions())).not.toThrow();
    // The pass reached the bottom of the tab, and no row needed the catch.
    expect(container.textContent).toContain('About the creator');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('does not build hidden rows: sign-in-gated islands mount only when signed in', () => {
    renderLikeObsidian113(document.createElement('div'), mobileTab(false).getSettingDefinitions());
    expect(mounted).toEqual(['AuthSettingsTab', 'DangerZone']);

    mounted.length = 0;
    renderLikeObsidian113(document.createElement('div'), mobileTab(true).getSettingDefinitions());
    expect(mounted).toEqual(['AuthSettingsTab', 'SyncSettingsTab', 'CrossPostSettingsTab', 'DangerZone']);
  });
});
