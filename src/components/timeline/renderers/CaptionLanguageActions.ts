import { Notice, setIcon, type App, type TFile } from 'obsidian';
import { t } from '../../../i18n';
import { transcriptLanguageDisplayName } from '../../../constants/languages';
import type { PostData } from '../../../types/post';
import {
  CaptionLanguageError,
  type CaptionVariantSyncService,
} from '../../../plugin/transcription/CaptionVariantSyncService';
import { CaptionLanguageSuggestModal } from '../modals/CaptionLanguageSuggestModal';
import { tabKeyLanguage, type TranscriptCaptionActions } from './TranscriptRenderer';
import { resolvePostArchiveId } from './postArchiveId';

export interface CaptionActionContext {
  app: App;
  post: PostData;
  service: () => CaptionVariantSyncService | undefined;
  /** Called before an action may write the note (timeline refresh suppression). */
  beforeChange?: () => void;
  /** Re-render after a successful change. */
  onChanged: () => void;
  /** The note's existing Whisper transcription action, offered when YouTube has no captions to pick (PRD §11). */
  onTranscribe?: () => void;
}

interface CaptionTarget {
  file: TFile;
  archiveId: string;
  service: CaptionVariantSyncService;
}

/**
 * Transcript "+" / tab-menu callbacks for a YouTube post card (PL8).
 * Undefined for other platforms and unsaved posts, which hides the controls.
 * A note without captions gets them too: its first pick becomes the archive's
 * primary transcript (server `addFirstPrimary`).
 */
export function buildCaptionActions(ctx: CaptionActionContext): TranscriptCaptionActions | undefined {
  const filePath = ctx.post.filePath;
  if (ctx.post.platform !== 'youtube' || !filePath) return undefined;

  const resolveTarget = (): CaptionTarget | null => {
    const archiveId = resolvePostArchiveId(ctx.app, ctx.post);
    if (!archiveId) {
      new Notice(t('tlang.localOnly'));
      return null;
    }
    const service = ctx.service();
    if (!service) {
      new Notice(t('tlang.signIn'));
      return null;
    }
    const file = ctx.app.vault.getFileByPath(filePath);
    return file ? { file, archiveId, service } : null;
  };

  /** `fn` resolves false when nothing changed (cancelled / handed off to the picker). */
  const run = (target: CaptionTarget | null, fn: (target: CaptionTarget) => Promise<boolean>): void => {
    if (!target) return;
    ctx.beforeChange?.();
    void fn(target).then(
      (changed) => {
        if (changed) ctx.onChanged();
      },
      (error: unknown) => {
        if (error instanceof CaptionLanguageError) return; // already shown as a Notice
        console.error('[Social Archiver] Caption language action failed:', error);
        new Notice(t('tlang.error.generic'));
      }
    );
  };

  return {
    onAddLanguage: () => run(resolveTarget(), async (target) => {
      const loading = new Notice(t('tlang.loading'), 0);
      let available;
      try {
        available = await target.service.listAvailable(target.file, target.archiveId);
      } finally {
        loading.hide();
      }
      const { primary, tracks } = available;
      const onTranscribe = !primary || tracks.length === 0 ? ctx.onTranscribe : undefined;
      if (!onTranscribe && !tracks.some((track) => track.state !== 'primary')) {
        new Notice(t(primary ? 'tlang.noneAvailable' : 'tlang.noCaptions'));
        return false;
      }
      new CaptionLanguageSuggestModal(ctx.app, tracks, (track) => {
        if (track.state === 'primary') {
          new Notice(t('tlang.alreadyDefault', { language: transcriptLanguageDisplayName(track.language) }));
          return;
        }
        run(target, async (chosen) => {
          await chosen.service.addLanguage(chosen.file, chosen.archiveId, track);
          return true;
        });
      }, onTranscribe).open();
      return false;
    }),
    onSetDefault: (tabKey) => run(resolveTarget(), async (target) => {
      await target.service.setDefault(target.file, target.archiveId, tabKeyLanguage(tabKey));
      return true;
    }),
    onDelete: (tabKey) => run(resolveTarget(), async (target) => {
      await target.service.deleteLanguage(target.file, target.archiveId, tabKeyLanguage(tabKey));
      return true;
    }),
  };
}

/**
 * The transcript header's "+" for a YouTube note with no transcript section
 * yet (archived while YouTube refused captions): opens the same picker.
 */
export function renderAddCaptionsEntry(parent: HTMLElement, actions: TranscriptCaptionActions): void {
  const button = parent.createEl('button', { cls: 'sa-gap-6 sa-mt-8 sa-text-sm' });
  setIcon(button.createSpan({ cls: 'sa-icon-14' }), 'captions');
  button.createSpan({ text: t('tlang.addCaptions') });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    actions.onAddLanguage();
  });
}
