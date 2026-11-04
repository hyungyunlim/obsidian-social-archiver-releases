/**
 * Settings → "AI API keys": per provider, add or replace the key (pasted into
 * our own modal and kept in Obsidian's secret storage), or link a key already
 * saved there; a key test with status and fingerprint, the on/off switch (asks
 * for consent first), the model, links, and Gemini's data-use warning. Shown on
 * desktop and mobile, signed in or not: keys are device settings.
 *
 * Obsidian's SecretComponent is not used: its "Link..." button reads as cut-off
 * text, and its "ID" field reads like an id the provider issues.
 *
 * Follows the definition/blockRow pattern of SettingTab: content lives inside
 * each row's settingEl (the 1.13 renderer drops anything outside it), and
 * async updates touch only the row they were started from.
 */
import type { App, Setting, SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import { islandHost } from './settingDefinitionRenderer';
import { t } from '../i18n';
import { BYOK_PROVIDERS, BYOK_PROVIDER_IDS, ByokError, type ByokModelInfo, type ByokProviderId } from '../vendor/byok-ai-core';
import type { ByokService, ByokValidationState } from '../services/byok/ByokService';
import { byokErrorMessage } from '../services/byok/byokText';
import { defaultByokSecretName } from '../types/byok-settings';
import { openByokKeyModal } from '../modals/ByokKeyModal';
import { pickSavedSecret } from '../modals/ByokSecretPickerModal';
import { showConfirmModal } from '../utils/confirm-modal';

export interface ByokSettingsDeps {
  app: App;
  byok: () => ByokService | null;
  /** Re-render the tab: a key added or removed changes which rows show. */
  refresh: () => void;
  /** The standalone CLI runs this vault's AI jobs (desktop): these keys are not advertised. */
  cliDelegated: () => boolean;
}

export function byokSettingDefinitions(deps: ByokSettingsDeps): SettingDefinitionItem[] {
  const supported = (): boolean => deps.byok()?.isSupported() === true;
  const block = (name: string, build: (host: HTMLElement) => void): SettingGroupItem => ({
    name,
    searchable: false,
    render: (setting): void => {
      build(islandHost(setting));
    },
  });
  const note = (host: HTMLElement, text: string): void => {
    host.createDiv({ cls: ['setting-item-description', 'sa-settings-info'], text });
  };

  return [{
    type: 'group',
    heading: t('byok.settings.heading'),
    items: [
      block('AI API keys description', (host) => note(host, t('byok.settings.desc'))),
      { ...block('AI API keys unavailable', (host) => note(host, t('byok.unsupported'))), visible: () => !supported() },
      {
        ...block('AI API keys and the CLI executor', (host) => note(host, t('byok.settings.cliNote'))),
        visible: () => supported() && deps.cliDelegated(),
      },
      ...BYOK_PROVIDER_IDS.flatMap((provider) => providerRows(deps, provider, supported, block)),
    ],
  }];
}

function providerRows(
  deps: ByokSettingsDeps,
  provider: ByokProviderId,
  supported: () => boolean,
  block: (name: string, build: (host: HTMLElement) => void) => SettingGroupItem,
): SettingGroupItem[] {
  const spec = BYOK_PROVIDERS[provider];
  const service = (): ByokService | null => deps.byok();
  const hasKey = (): boolean => service()?.hasKey(provider) === true;

  const keyRow: SettingGroupItem = {
    name: spec.label,
    desc: t('byok.settings.keyHint', { provider: spec.label, prefix: spec.keyPrefixHint }),
    aliases: ['API key', 'BYOK'],
    visible: supported,
    render: (setting): void => {
      const byok = service();
      if (!byok) return;
      // Next to the description, not inside it: whatever sets `desc` cannot wipe it.
      const statusEl = setting.infoEl.createDiv({ cls: ['setting-item-description', 'sa-byok-status'] });
      const showStatus = (state: ByokValidationState | null | 'checking'): void => {
        statusEl.textContent = statusText(byok, provider, state);
      };
      showStatus(null);
      void byok.getValidation(provider).then((state) => {
        showStatus(state);
      });

      const linked = byok.providerSettings(provider).secretName;
      if (linked && linked !== defaultByokSecretName(provider) && hasKey()) {
        setting.infoEl.createDiv({
          cls: 'setting-item-description',
          text: t('byok.settings.linkedSecret', { name: linked }),
        });
      }
      const ownSecrets = new Set(BYOK_PROVIDER_IDS.map(defaultByokSecretName));
      const saved = byok.savedSecretNames().filter((name) => !ownSecrets.has(name) && name !== linked);
      if (saved.length > 0) {
        const link = setting.infoEl.createEl('a', { text: t('byok.settings.useSaved'), href: '#' });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void (async (): Promise<void> => {
            const name = await pickSavedSecret(deps.app, saved);
            if (!name) return;
            showStatus('checking');
            showStatus(await byok.setSecretName(provider, name));
            deps.refresh();
          })();
        });
      }

      setting.addButton((button) => {
        button
          .setButtonText(hasKey() ? t('byok.settings.replaceKey') : t('byok.settings.addKey'))
          .onClick(async () => {
            const key = await openByokKeyModal(deps.app, provider);
            if (!key) return;
            showStatus('checking');
            showStatus(await byok.saveKey(provider, key));
            deps.refresh();
          });
      });
      setting.addButton((button) => {
        button.setButtonText(t('byok.settings.test')).onClick(async () => {
          button.setDisabled(true);
          showStatus('checking');
          try {
            showStatus(await byok.validate(provider));
          } finally {
            button.setDisabled(false);
          }
        });
      });
      setting.addExtraButton((button) => {
        button.setIcon('trash').setTooltip(t('byok.settings.remove')).onClick(async () => {
          if (!byok.hasKey(provider) && !byok.providerSettings(provider).secretName) return;
          const confirmed = await showConfirmModal(deps.app, {
            title: t('byok.settings.remove'),
            message: t('byok.settings.removeConfirm', { provider: spec.label }),
            confirmText: t('byok.settings.remove'),
            confirmClass: 'danger',
          });
          if (!confirmed) return;
          await byok.clearKey(provider);
          deps.refresh();
        });
      });
      setting.addToggle((toggle) => {
        let reverting = false;
        toggle
          .setTooltip(t('byok.settings.enable'))
          .setValue(byok.isEnabled(provider))
          .onChange(async (enabled) => {
            if (reverting) return;
            const on = await byok.setEnabled(provider, enabled);
            if (on !== enabled) {
              // Consent declined: put the switch back without saving again.
              reverting = true;
              toggle.setValue(on);
              reverting = false;
            }
          });
      });
    },
  };

  const modelRow: SettingGroupItem = {
    name: t('byok.settings.model.name', { provider: spec.label }),
    desc: t('byok.settings.model.desc'),
    visible: () => supported() && hasKey(),
    render: (setting): void => {
      const byok = service();
      if (!byok) return;
      setting.addDropdown((dropdown) => {
        dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
        const chosen = byok.providerSettings(provider).model ?? '';
        dropdown.addOption('', t('byok.settings.model.recommended'));
        if (chosen) dropdown.addOption(chosen, chosen);
        dropdown.setValue(chosen);
        dropdown.onChange(async (value) => {
          await byok.setModel(provider, value || undefined);
          void describeModel(setting, byok, provider);
        });
        void fillModelOptions(dropdown.selectEl, byok, provider, chosen).catch(() => {
          setting.setDesc(t('byok.settings.model.loadFailed'));
        });
      });
      void describeModel(setting, byok, provider);
    },
  };

  const linksRow = block(`${spec.label} links`, (host) => {
    const links = host.createDiv({ cls: 'setting-item-description' });
    const add = (text: string, href: string): void => {
      if (links.childElementCount > 0) links.append(' · ');
      links.createEl('a', { text, href });
    };
    add(t('byok.settings.links.key'), spec.keyCreateUrl);
    add(t('byok.settings.links.billing'), spec.billingUrl);
    add(t('byok.settings.links.privacy'), spec.privacyUrl);
    if (spec.dataUseNote) {
      host.createDiv({ cls: ['setting-item-description', 'mod-warning'], text: t('byok.settings.geminiNote') });
    }
  });

  return [keyRow, modelRow, { ...linksRow, visible: supported }];
}

function statusText(byok: ByokService, provider: ByokProviderId, state: ByokValidationState | null | 'checking'): string {
  if (state === 'checking') return t('byok.settings.status.checking');
  const fingerprint = byok.fingerprint(provider);
  if (!fingerprint) return t('byok.settings.status.notSet');
  if (!state) return t('byok.settings.status.unchecked', { fingerprint });
  if (state.ok) {
    return state.freeTier
      ? t('byok.settings.status.validFree', { fingerprint })
      : t('byok.settings.status.valid', { fingerprint });
  }
  const reason = !state.code || state.code === 'unknown'
    ? t('byok.settings.status.checkFailed')
    : byokErrorMessage(new ByokError(state.code, ''), provider);
  return t('byok.settings.status.failed', { reason, fingerprint });
}

/** The provider's live list (cached 24 h), the recommended pick named in the first option. */
async function fillModelOptions(
  select: HTMLSelectElement,
  byok: ByokService,
  provider: ByokProviderId,
  chosen: string,
): Promise<void> {
  const [models, recommended] = await Promise.all([
    byok.listModels(provider),
    byok.engine.resolve(provider, 'comment', null),
  ]);
  if ('model' in recommended) {
    const first = select.options[0];
    if (first) first.text = t('byok.settings.model.recommendedNamed', { model: recommended.model });
  }
  const present = new Set(Array.from(select.options, (option) => option.value));
  for (const model of models.filter((entry: ByokModelInfo) => !present.has(entry.id))) {
    select.add(new Option(model.label && model.label !== model.id ? `${model.label} (${model.id})` : model.id, model.id));
  }
  select.value = chosen;
}

/** Deprecated or retired chosen model: say so, with a one-tap switch to the replacement. */
async function describeModel(setting: Setting, byok: ByokService, provider: ByokProviderId): Promise<void> {
  const model = byok.providerSettings(provider).model;
  setting.setDesc(t('byok.settings.model.desc'));
  setting.controlEl.querySelector('.sa-byok-switch')?.remove();
  if (!model) return;
  const lifecycle = await byok.modelLifecycle(provider, model);
  const replacement = lifecycle.replacement?.replace(/\*$/, '');
  if (lifecycle.status === 'retired') {
    const resolved = await byok.resolveModel(provider, 'comment');
    setting.setDesc(t('byok.settings.model.retired', {
      model,
      provider: BYOK_PROVIDERS[provider].label,
      replacement: 'model' in resolved ? resolved.model : (replacement ?? '—'),
    }));
    return;
  }
  if (lifecycle.status !== 'deprecated' || !replacement) return;
  setting.setDesc(t('byok.settings.model.retires', { model, date: lifecycle.retiresAt ?? '—', replacement }));
  const button = setting.controlEl.createEl('button', { text: t('byok.settings.model.switch'), cls: 'sa-byok-switch' });
  button.addEventListener('click', () => {
    void byok.setModel(provider, replacement).then(() => {
      const select = setting.controlEl.querySelector('select');
      if (select) {
        if (!Array.from(select.options).some((option) => option.value === replacement)) select.add(new Option(replacement, replacement));
        select.value = replacement;
      }
      void describeModel(setting, byok, provider);
    });
  });
}
