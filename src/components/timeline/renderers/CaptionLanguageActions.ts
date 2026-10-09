import { Notice, type App, type TFile } from 'obsidian';
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
}

interface CaptionTarget {
  file: TFile;
  archiveId: string;
  service: CaptionVariantSyncService;
}

/** True when the note has a caption section (original or added) — a Whisper-only note has no server caption primary. */
function hasCaptionSection(post: PostData): boolean {
  const sources = [...Object.values(post.multilangTranscript?.sources ?? {}), post.whisperTranscript?.source];
  return sources.some((source) => source === 'original' || source === 'caption');
}

/**
 * Transcript "+" / tab-menu callbacks for a YouTube post card (PL8).
 * Undefined for other platforms, unsaved posts and notes without a caption
 * section, which hides the controls.
 */
export function buildCaptionActions(ctx: CaptionActionContext): TranscriptCaptionActions | undefined {
  const filePath = ctx.post.filePath;
  if (ctx.post.platform !== 'youtube' || !filePath || !hasCaptionSection(ctx.post)) return undefined;

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
      let tracks;
      try {
        ({ tracks } = await target.service.listAvailable(target.file, target.archiveId));
      } finally {
        loading.hide();
      }
      if (!tracks.some((track) => track.state !== 'primary')) {
        new Notice(t('tlang.noneAvailable'));
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
      }).open();
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
