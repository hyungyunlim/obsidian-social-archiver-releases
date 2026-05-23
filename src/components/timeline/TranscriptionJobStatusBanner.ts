import { setIcon } from 'obsidian';
import type { TranscriptionJobBannerState } from '../../plugin/transcription/TranscriptionJobProcessor';

type CancelCallback = (jobId: string) => void;
type DismissCallback = (jobId: string) => void;

export class TranscriptionJobStatusBanner {
  private readonly containerEl: HTMLElement;
  private bannerEl: HTMLElement | null = null;
  private onCancelCallback?: CancelCallback;
  private onDismissCallback?: DismissCallback;
  private cleanup: Array<() => void> = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: 'sa-transcription-job-banners' });
  }

  onCancel(callback: CancelCallback): void {
    this.onCancelCallback = callback;
  }

  onDismiss(callback: DismissCallback): void {
    this.onDismissCallback = callback;
  }

  update(state: TranscriptionJobBannerState | null): void {
    this.clearListeners();
    this.bannerEl?.remove();
    this.bannerEl = null;

    if (!state) {
      this.containerEl.toggleClass('csb-visible', false);
      return;
    }

    const terminal = isTerminal(state.status);
    const bannerEl = this.containerEl.createDiv({
      cls: `crawl-banner banner-${statusTone(state.status)}`,
      attr: {
        role: 'status',
        'aria-live': 'polite',
        'aria-busy': terminal ? 'false' : 'true',
        'data-job-id': state.jobId,
      },
    });

    const iconEl = bannerEl.createSpan({ cls: 'banner-icon' });
    setIcon(iconEl, terminal ? (state.status === 'completed' ? 'check' : 'alert-circle') : 'captions');

    const textEl = bannerEl.createSpan({ cls: 'banner-text' });
    textEl.setText(getBannerText(state));

    const action = bannerEl.createEl('button', {
      cls: 'banner-dismiss clickable-icon csb-dismiss-btn',
      attr: { 'aria-label': terminal ? 'Dismiss transcription job' : 'Cancel transcription job' },
    });
    setIcon(action, 'x');

    const handleClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (terminal) this.onDismissCallback?.(state.jobId);
      else this.onCancelCallback?.(state.jobId);
    };
    action.addEventListener('click', handleClick);
    this.cleanup.push(() => action.removeEventListener('click', handleClick));

    this.bannerEl = bannerEl;
    this.containerEl.toggleClass('csb-visible', true);
  }

  destroy(): void {
    this.clearListeners();
    this.bannerEl?.remove();
    this.bannerEl = null;
    this.containerEl.remove();
  }

  private clearListeners(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }
}

function isTerminal(status: TranscriptionJobBannerState['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'expired';
}

function statusTone(status: TranscriptionJobBannerState['status']): 'crawling' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled' || status === 'expired') return 'failed';
  return 'crawling';
}

function getBannerText(state: TranscriptionJobBannerState): string {
  const subject = getShortSubject(state);
  const queue = state.queueDepth > 0 ? ` · queued ${state.queueDepth}` : '';
  const progress = typeof state.progressPercentage === 'number' ? ` · ${state.progressPercentage}%` : '';
  if (state.status === 'completed' && state.progressCode === 'download_completed') return `Video download completed${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'completed') return `Transcription completed${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'failed') return `${state.errorMessagePublic || 'Transcription failed'}${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'cancelled') return `Transcription cancelled${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'expired') return `Transcription expired${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'cancel_requested') return `Cancelling transcription${subject ? ` · ${subject}` : ''}${queue}`;
  return `${progressLabel(state.progressCode, state.status)}${progress}${subject ? ` · ${subject}` : ''}${queue}`;
}

function progressLabel(progressCode: string | undefined, status: TranscriptionJobBannerState['status']): string {
  switch (progressCode || status) {
    case 'preparing_archive':
      return 'Preparing archive for transcription';
    case 'preparing_media':
      return 'Preparing media for transcription';
    case 'downloading_video':
      return 'Downloading video in Obsidian';
    case 'running':
      return 'Transcribing in Obsidian';
    case 'uploading':
      return 'Uploading transcript';
    case 'download_completed':
      return 'Saving downloaded video';
    case 'merging':
      return 'Saving transcript';
    case 'retry_scheduled':
      return 'Transcription retry scheduled';
    case 'claimed':
    case 'claiming':
      return 'Starting transcription';
    case 'dispatched':
    case 'queued':
    default:
      return 'Waiting for capable transcription executor';
  }
}

function getShortSubject(state: TranscriptionJobBannerState): string {
  const raw = state.title || '';
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return state.archiveId ? `${state.archiveId.slice(0, 8)}...` : '';
  const maxLength = 48;
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 3).trimEnd()}...`
    : compact;
}
