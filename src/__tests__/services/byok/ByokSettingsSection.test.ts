import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingDefinitionItem, SettingGroup } from 'obsidian';

// The plugin mock's Setting has no controls; give it ones that build real
// elements (as SettingTab.nativeMobileRender.test.ts does).
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
  class ControlSetting extends actual.Setting {
    addToggle(cb: (toggle: unknown) => unknown): this {
      let value = false;
      let change: ((value: boolean) => unknown) | null = null;
      const el = document.createElement('input');
      el.type = 'checkbox';
      const toggle = {
        el,
        setTooltip: () => toggle,
        setValue: (next: boolean) => {
          if (next !== value) {
            value = next;
            el.checked = next;
            void change?.(next);
          }
          return toggle;
        },
        onChange: (callback: (value: boolean) => unknown) => {
          change = callback;
          return toggle;
        },
        get value() {
          return value;
        },
      };
      Object.assign(el, { component: toggle });
      this.controlEl.appendChild(el);
      cb(toggle);
      return this;
    }
    addButton(cb: (button: unknown) => unknown): this {
      const el = document.createElement('button');
      let click: (() => unknown) | null = null;
      el.addEventListener('click', () => void click?.());
      const button = {
        buttonEl: el,
        setButtonText: (text: string) => {
          el.textContent = text;
          return button;
        },
        setDisabled: (disabled: boolean) => {
          el.disabled = disabled;
          return button;
        },
        onClick: (callback: () => unknown) => {
          click = callback;
          return button;
        },
      };
      this.controlEl.appendChild(el);
      cb(button);
      return this;
    }
    addExtraButton(cb: (button: unknown) => unknown): this {
      const button = { setIcon: () => button, setTooltip: () => button, onClick: () => button };
      cb(button);
      return this;
    }
    addDropdown(cb: (dropdown: unknown) => unknown): this {
      const selectEl = document.createElement('select');
      const dropdown = {
        selectEl,
        addOption: (value: string, label: string) => {
          selectEl.add(new Option(label, value));
          return dropdown;
        },
        setValue: (value: string) => {
          selectEl.value = value;
          return dropdown;
        },
        onChange: () => dropdown,
      };
      this.controlEl.appendChild(selectEl);
      cb(dropdown);
      return this;
    }
  }
  return { ...actual, Setting: ControlSetting };
});

vi.mock('../../../modals/ByokKeyModal', () => ({ openByokKeyModal: vi.fn() }));
vi.mock('../../../modals/ByokSecretPickerModal', () => ({ pickSavedSecret: vi.fn() }));

import { Setting } from 'obsidian';
import { byokSettingDefinitions } from '../../../settings/ByokSettingsSection';
import { openByokKeyModal } from '../../../modals/ByokKeyModal';
import { pickSavedSecret } from '../../../modals/ByokSecretPickerModal';
import { FAKE_OPENAI_KEY, byokFixture, openaiModels } from './byokTestKit';

// Built at runtime: the public mirror's secret scan rejects any key-shaped literal (sk-…).
const SHARED_KEY = ['sk', 'test-shared-0000000000'].join('-');

function render(items: readonly SettingDefinitionItem[], container: HTMLElement): void {
  for (const item of items) {
    if ('type' in item) {
      render(item.items ?? [], container);
      continue;
    }
    const visible = 'visible' in item ? item.visible : undefined;
    if (typeof visible === 'function' ? !visible() : visible === false) continue;
    const setting = new Setting(container);
    setting.setName(item.name);
    if (typeof item.desc === 'string') setting.setDesc(item.desc);
    if ('render' in item && item.render) item.render(setting, { listEl: container } as SettingGroup);
  }
}

function row(container: HTMLElement, name: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('.setting-item')).find(
    (el) => el.querySelector('.setting-item-name')?.textContent === name,
  );
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function button(rowEl: HTMLElement | undefined, text: string): HTMLButtonElement | undefined {
  return Array.from(rowEl?.querySelectorAll('button') ?? []).find((el) => el.textContent === text);
}

function link(rowEl: HTMLElement | undefined, text: string): HTMLAnchorElement | undefined {
  return Array.from(rowEl?.querySelectorAll('a') ?? []).find((el) => el.textContent === text);
}

function renderFor(fixture: ReturnType<typeof byokFixture>, refresh = vi.fn()): HTMLElement {
  const container = document.createElement('div');
  render(byokSettingDefinitions({ app: fixture.app as never, byok: () => fixture.service, refresh, cliDelegated: () => false }), container);
  return container;
}

describe('AI API keys settings', () => {
  beforeEach(() => {
    vi.mocked(openByokKeyModal).mockReset();
    vi.mocked(pickSavedSecret).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says BYOK needs a newer Obsidian when there is no secret storage', () => {
    const container = document.createElement('div');
    render(byokSettingDefinitions({ app: {} as never, byok: () => null, refresh: vi.fn(), cliDelegated: () => false }), container);
    expect(container.textContent).toContain('1.11.4');
    expect(row(container, 'OpenAI')).toBeUndefined();
  });

  it('adds a pasted key under its own secret, checks it and shows only its fingerprint', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna') });
    const refresh = vi.fn();
    const container = renderFor(fixture, refresh);

    for (const provider of ['OpenAI', 'Anthropic', 'Gemini', 'OpenRouter']) expect(row(container, provider)).toBeDefined();
    expect(container.textContent).toContain('No key on this device.');
    expect(container.textContent).toContain('Google may use your inputs');
    expect(container.textContent).not.toContain('Link...');
    // No key yet: no model row, and nothing saved in Obsidian to link.
    expect(row(container, 'OpenAI model')).toBeUndefined();
    expect(link(row(container, 'OpenAI'), 'Use a key already saved in Obsidian…')).toBeUndefined();

    vi.mocked(openByokKeyModal).mockResolvedValue(FAKE_OPENAI_KEY);
    button(row(container, 'OpenAI'), 'Add key…')?.click();
    await vi.waitFor(() => expect(row(container, 'OpenAI')?.textContent).toContain('Key works (…cdef).'));

    expect(openByokKeyModal).toHaveBeenCalledWith(fixture.app, 'openai');
    expect(fixture.app.secretStorage.getSecret('social-archiver-openai')).toBe(FAKE_OPENAI_KEY);
    expect(fixture.holder.settings.byok.providers.openai.secretName).toBe('social-archiver-openai');
    expect(container.textContent).not.toContain(FAKE_OPENAI_KEY);
    expect(JSON.stringify(fixture.holder.settings)).not.toContain(FAKE_OPENAI_KEY);
    expect(refresh).toHaveBeenCalled();

    const rerendered = renderFor(fixture, refresh);
    expect(button(row(rerendered, 'OpenAI'), 'Replace key…')).toBeDefined();
    expect(row(rerendered, 'OpenAI model')).toBeDefined();
  });

  it('replaces a linked shared key under its own secret and leaves the shared one alone', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna') });
    fixture.app.secretStorage.setSecret('shared-openai', SHARED_KEY);
    await fixture.service.setSecretName('openai', 'shared-openai');
    const container = renderFor(fixture);
    expect(row(container, 'OpenAI')?.textContent).toContain('“shared-openai”');

    vi.mocked(openByokKeyModal).mockResolvedValue(FAKE_OPENAI_KEY);
    button(row(container, 'OpenAI'), 'Replace key…')?.click();
    await vi.waitFor(() => expect(fixture.holder.settings.byok.providers.openai.secretName).toBe('social-archiver-openai'));

    expect(fixture.app.secretStorage.getSecret('social-archiver-openai')).toBe(FAKE_OPENAI_KEY);
    expect(fixture.app.secretStorage.getSecret('shared-openai')).toBe(SHARED_KEY);
  });

  it('changes nothing when the key modal is cancelled', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna') });
    const refresh = vi.fn();
    const container = renderFor(fixture, refresh);

    vi.mocked(openByokKeyModal).mockResolvedValue(null);
    button(row(container, 'OpenAI'), 'Add key…')?.click();
    await flush();

    expect(openByokKeyModal).toHaveBeenCalledTimes(1);
    expect(fixture.app.secretStorage.getSecret('social-archiver-openai')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(fixture.transport.calls).toHaveLength(0);
  });

  it('links a key already saved in Obsidian, offering only secrets that are not our own', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna') });
    fixture.app.secretStorage.setSecret('picked-openai', FAKE_OPENAI_KEY);
    fixture.app.secretStorage.setSecret('social-archiver-gemini', 'AIza-test-key-0000000000');
    const refresh = vi.fn();
    const container = renderFor(fixture, refresh);

    vi.mocked(pickSavedSecret).mockResolvedValue('picked-openai');
    link(row(container, 'OpenAI'), 'Use a key already saved in Obsidian…')?.click();
    await vi.waitFor(() => expect(row(container, 'OpenAI')?.textContent).toContain('Key works (…cdef).'));

    expect(pickSavedSecret).toHaveBeenCalledWith(fixture.app, ['picked-openai']);
    expect(fixture.holder.settings.byok.providers.openai.secretName).toBe('picked-openai');
    expect(refresh).toHaveBeenCalled();
  });

  it('puts the switch back when consent is declined', async () => {
    const fixture = byokFixture({ answer: () => openaiModels('gpt-6-luna'), consent: false });
    const container = document.createElement('div');
    render(byokSettingDefinitions({ app: fixture.app as never, byok: () => fixture.service, refresh: vi.fn(), cliDelegated: () => false }), container);
    const toggle = (row(container, 'Gemini')?.querySelector('input[type="checkbox"]') as unknown as {
      component: { setValue(value: boolean): unknown; value: boolean };
    });
    toggle.component.setValue(true);
    await flush();
    expect(fixture.requestConsent).toHaveBeenCalledWith('gemini');
    expect(toggle.component.value).toBe(false);
    expect(fixture.holder.settings.byok.providers.gemini.enabled).toBe(false);
  });
});
