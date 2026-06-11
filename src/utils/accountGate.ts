import { Notice } from 'obsidian';
import type SocialArchiverPlugin from '../main';

/**
 * Account-gated capabilities surfaced to logged-out users.
 * Every login-required touchpoint funnels through showAccountRequiredNotice()
 * so gate-hit messaging stays consistent and names the specific capability.
 * See .taskmaster/docs/prd-plugin-anonymous-local-mode.md (S2).
 */
export type AccountCapability =
  | 'archive'
  | 'share'
  | 'subscriptions'
  | 'ai-comments'
  | 'sync'
  | 'crosspost'
  | 'transcription'
  | 'tts'
  | 'import';

const CAPABILITY_COPY: Record<AccountCapability, string> = {
  archive: 'Archiving by URL runs on the Social Archiver server and needs a free account.',
  share: 'Share links are hosted on social-archive.org and need a free account.',
  subscriptions: 'Subscriptions auto-archive new posts on our server and need a free account.',
  'ai-comments': 'AI comments run on the Social Archiver server and need a free account.',
  sync: 'Syncing with the mobile app runs through your account. Sign in to enable it.',
  crosspost: 'Cross-posting publishes through your account and needs a free account.',
  transcription: 'Server transcription jobs run through your account and need a free account.',
  tts: 'Cloud text-to-speech runs through your account and needs a free account.',
  import: 'Importing local archives runs through your account and needs a free account.',
};

/**
 * Capability copy for surfaces with their own renderers (settings sections,
 * inline error states) — single source so gate messaging never drifts.
 */
export function getAccountRequiredMessage(capability: AccountCapability): string {
  return CAPABILITY_COPY[capability];
}

function openPluginSettings(plugin: SocialArchiverPlugin): void {
  const appSetting = (
    plugin.app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    }
  ).setting;
  appSetting?.open?.();
  appSetting?.openTabById?.(plugin.manifest.id);
}

/**
 * Show a capability-specific "account required" notice with a clickable
 * "Sign in" action that opens the plugin settings (Account section).
 */
export function showAccountRequiredNotice(
  plugin: SocialArchiverPlugin,
  capability: AccountCapability
): void {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(document.createTextNode(CAPABILITY_COPY[capability] + ' '));

  const link = document.createElement('a');
  link.textContent = 'Sign in';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openPluginSettings(plugin);
  });
  fragment.appendChild(link);

  new Notice(fragment, 8000);
}
