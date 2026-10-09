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
    const toggleEl = document.createElement('div');
    const target: Record<string, unknown> = {
      selectEl: document.createElement('select'),
      inputEl: document.createElement('input'),
      buttonEl: document.createElement('button'),
      toggleEl,
      sliderEl: document.createElement('input'),
      // Kept on the element so a test can read a toggle's state off its row.
      setDisabled: (disabled: boolean) => { toggleEl.toggleAttribute('disabled', disabled); return proxy; },
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
    addToggle = (cb: (c: never) => unknown): this => {
      const toggle = component() as { toggleEl: HTMLElement };
      this.controlEl.appendChild(toggle.toggleEl);
      cb(toggle as never);
      return this;
    };
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

const signIn = (settings: object): void => {
  Object.assign(settings, { authToken: 'token', isVerified: true, username: 'aleonel' });
};

function mobileTab(signedIn: boolean, reviewFeature?: unknown, apiCalls: string[] = []): SocialArchiverSettingTab {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (signedIn) signIn(settings);
  const api = new Proxy({}, {
    get: (_target, prop) => () => {
      apiCalls.push(String(prop));
      return Promise.resolve(true);
    },
  });
  const plugin = {
    settings,
    manifest: { id: 'social-archiver', version: '4.9.1' },
    workersApiClient: api,
    getReviewFeature: () => reviewFeature,
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

  // GitHub releases#50: signed out on 1.14.4 desktop, the hidden Collection
  // activity row still fetched notification-preferences, got 401s and the
  // window froze. Hidden rows must not reach the API at all.
  it('makes no API call while signed out; the account rows fetch once signed in', () => {
    const signedOutCalls: string[] = [];
    renderLikeObsidian113(document.createElement('div'), mobileTab(false, undefined, signedOutCalls).getSettingDefinitions());
    expect(signedOutCalls).toEqual([]);

    const signedInCalls: string[] = [];
    renderLikeObsidian113(document.createElement('div'), mobileTab(true, undefined, signedInCalls).getSettingDefinitions());
    expect(signedInCalls).toContain('getCollectionActivityNotificationsEnabled');
  });
});

describe("Today's review toggles after sign-in", () => {
  const reviewFeature = {
    client: {
      getStatus: () => Promise.resolve({ enabled: true }),
      getDigest: () => Promise.resolve({ emailEnabled: true, hour: 8 }),
    },
    refreshStatusBar: () => Promise.resolve(),
    open: () => Promise.resolve(),
  };

  /** Disabled state of the "Daily review" and "Email digest" toggles. */
  async function reviewToggles(container: HTMLElement): Promise<boolean[]> {
    await new Promise((resolve) => setTimeout(resolve, 0)); // let getStatus/getDigest settle
    return [...container.querySelectorAll('.setting-item')]
      .filter((row) => ['Daily review', 'Email digest'].includes(row.querySelector('.setting-item-name')?.textContent ?? ''))
      .map((row) => row.querySelector('.setting-item-control > [disabled]') !== null);
  }

  it('enables them without a plugin reload', async () => {
    const tab = mobileTab(false, reviewFeature);
    // 1.13+ builds the tree once (addSettingTab -> update()) and re-renders that
    // same tree on every activation of the tab.
    const tree = tab.getSettingDefinitions();
    const signedOut = document.createElement('div');
    renderLikeObsidian113(signedOut, tree);
    expect(await reviewToggles(signedOut)).toEqual([true, true]);

    signIn(tab.plugin.settings);

    const reopened = document.createElement('div');
    renderLikeObsidian113(reopened, tree);
    expect(await reviewToggles(reopened)).toEqual([false, false]);

    // The pass main.ts runs right after sign-in.
    tab.display();
    expect(await reviewToggles(tab.containerEl)).toEqual([false, false]);
  });
});
