/**
 * "Chat about this post" and "Research this post" for the post card and
 * reader AI menus. What can run decides what shows: with no engine for an
 * entry, one item opens settings to add a key instead of a dead button.
 */
import { Platform } from 'obsidian';
import type SocialArchiverPlugin from '../../main';
import type { PostData } from '../../types/post';
import type { AICommentTarget } from '../../services/ai-comment/AICommentSaver';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import { getByokService } from '../../services/byok/ByokService';
import { AIChatModal, chatEngineOptions, type AIChatModalOptions } from '../../modals/AIChatModal';
import { AIResearchModal } from '../../modals/AIResearchModal';
import { AICliDetector, type AICli } from '../../utils/ai-cli';
import { isAuthenticated } from '../../utils/auth';
import { resolvePostArchiveId } from './renderers/postArchiveId';
import { t } from '../../i18n';

export interface AIConversationEntry {
  icon: string;
  title: string;
  onSelect: () => void;
}

export interface AIConversationContext {
  plugin: SocialArchiverPlugin;
  post: PostData;
  /** The note the modals save to; built only when one opens. */
  target: () => AICommentTarget | null;
  /** Reader mode holds its keyboard shortcuts while a modal is open. */
  onModalOpen?: () => void;
  onModalClosed?: () => void;
  /**
   * Open the chat beside the article (reader mode) instead of in a modal.
   * Absent where no reader can show the post: the modal is the fallback.
   */
  openChat?: () => void;
}

/** What a chat about `post` needs, whether it shows in a modal or docked in reader mode. */
export function chatPanelOptionsFor(
  plugin: SocialArchiverPlugin,
  target: AICommentTarget,
): Omit<AIChatModalOptions, 'onClosed'> {
  return {
    target,
    byok: getByokService(),
    cloud: (): WorkersAPIClient | null => {
      try {
        return plugin.workersApiClient;
      } catch {
        return null;
      }
    },
    archiveId: resolvePostArchiveId(plugin.app, target.post),
    signedIn: isAuthenticated(plugin),
    outputLanguage: plugin.settings.aiComment.outputLanguage,
    openSettings: (): void => openPluginSettings(plugin),
  };
}

export function aiConversationEntries(context: AIConversationContext): AIConversationEntry[] {
  const { plugin, post } = context;
  if (!post.filePath) return [];
  const byok = getByokService();
  const archiveId = resolvePostArchiveId(plugin.app, post);
  const chatOk = chatEngineOptions({ byok, archiveId, signedIn: isAuthenticated(plugin) }).length > 0;
  const researchOk = (byok?.readyProviders().length ?? 0) > 0 || mayHaveCli();
  const entries: AIConversationEntry[] = [];
  if (chatOk) {
    entries.push({ icon: 'message-square', title: t('byok.menu.chat'), onSelect: () => openChat(context) });
  }
  if (researchOk) {
    entries.push({ icon: 'search', title: t('byok.menu.research'), onSelect: () => openResearch(context, archiveId) });
  } else {
    entries.push({
      icon: 'key',
      title: chatOk ? t('byok.menu.addKeyResearch') : t('byok.menu.addKey'),
      onSelect: () => openPluginSettings(plugin),
    });
  }
  return entries;
}

/** Desktop CLIs are found by an async scan: before the first scan a CLI may be there. */
function mayHaveCli(): boolean {
  if (Platform.isMobile) return false;
  const scanned = [...AICliDetector.getCachedResults().values()];
  return scanned.length === 0 || scanned.some((result) => result.available);
}

function openChat(context: AIConversationContext): void {
  if (context.openChat) {
    context.openChat();
    return;
  }
  const target = context.target();
  if (!target) return;
  const { plugin } = context;
  context.onModalOpen?.();
  new AIChatModal(plugin.app, {
    ...chatPanelOptionsFor(plugin, target),
    ...(context.onModalClosed ? { onClosed: context.onModalClosed } : {}),
  }).open();
}

function openResearch(context: AIConversationContext, archiveId: string | null): void {
  const target = context.target();
  const runner = context.plugin.byokResearchRunner;
  if (!target || !runner) return;
  const { plugin } = context;
  context.onModalOpen?.();
  new AIResearchModal(plugin.app, {
    target,
    runner,
    byok: getByokService(),
    detectClis: installedClis,
    archiveId,
    outputLanguage: plugin.settings.aiComment.outputLanguage,
    openSettings: (): void => openPluginSettings(plugin),
    ...(context.onModalClosed ? { onClosed: context.onModalClosed } : {}),
  }).open();
}

async function installedClis(): Promise<AICli[]> {
  if (Platform.isMobile) return [];
  const detected = await AICliDetector.detectAll();
  return [...detected.entries()].filter(([, result]) => result.available).map(([cli]) => cli);
}

function openPluginSettings(plugin: SocialArchiverPlugin): void {
  // `app.setting` is not in Obsidian's public typings (ClipGuideModal does the same).
  const { setting } = plugin.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } };
  setting?.open?.();
  setting?.openTabById?.(plugin.manifest.id);
}
