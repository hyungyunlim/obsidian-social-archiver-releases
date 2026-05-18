import { setIcon } from 'obsidian';
import type { AICommentJobBannerState } from '../../plugin/ai-comment/AICommentJobProcessor';

type CancelCallback = (jobId: string) => void;
type DismissCallback = (jobId: string) => void;

export class AICommentJobStatusBanner {
  private readonly containerEl: HTMLElement;
  private bannerEl: HTMLElement | null = null;
  private onCancelCallback?: CancelCallback;
  private onDismissCallback?: DismissCallback;
  private cleanup: Array<() => void> = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: 'sa-ai-comment-job-banners' });
  }

  onCancel(callback: CancelCallback): void {
    this.onCancelCallback = callback;
  }

  onDismiss(callback: DismissCallback): void {
    this.onDismissCallback = callback;
  }

  update(state: AICommentJobBannerState | null): void {
    this.clearListeners();
    this.bannerEl?.remove();
    this.bannerEl = null;

    if (!state) {
      this.containerEl.toggleClass('csb-visible', false);
      return;
    }

    const terminal = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
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
    setIcon(iconEl, terminal ? (state.status === 'completed' ? 'check' : 'alert-circle') : 'sparkles');

    const textEl = bannerEl.createSpan({ cls: 'banner-text' });
    textEl.setText(getBannerText(state));

    const action = bannerEl.createEl('button', {
      cls: 'banner-dismiss clickable-icon csb-dismiss-btn',
      attr: { 'aria-label': terminal ? 'Dismiss AI comment job' : 'Cancel AI comment job' },
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

function statusTone(status: AICommentJobBannerState['status']): 'crawling' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'crawling';
}

function getBannerText(state: AICommentJobBannerState): string {
  const subject = getShortSubject(state);
  const queue = state.queueDepth > 0 ? ` · queued ${state.queueDepth}` : '';
  const progress = typeof state.progressPercentage === 'number' ? ` · ${state.progressPercentage}%` : '';
  const label = getJobLabel(state);
  if (state.status === 'completed') return `${label} completed${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'failed') return `${state.errorMessagePublic || `${label} failed`}${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'cancelled') return `${label} cancelled${subject ? ` · ${subject}` : ''}${queue}`;
  if (state.status === 'cancel_requested') return `Cancelling ${label.toLowerCase()}${subject ? ` · ${subject}` : ''}${queue}`;
  return `${state.progressMessage || `Processing ${label.toLowerCase()} with ${state.provider}`}${progress}${queue}`;
}

function getJobLabel(state: AICommentJobBannerState): string {
  if (state.actionType === 'content.translate_variant') return 'Translation';
  if (state.actionType === 'tags.suggest_apply') return 'Tag suggestion';
  if (state.actionType?.startsWith('comment.')) return 'AI comment';
  if (state.resultKind === 'content_variant') return 'Content variant';
  if (state.resultKind === 'tag_patch') return 'Tag suggestion';
  return 'AI action';
}

function getShortSubject(state: AICommentJobBannerState): string {
  const raw = state.title || state.previewText || '';
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return `${state.archiveId.slice(0, 8)}...`;
  const maxLength = 48;
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 3).trimEnd()}...`
    : compact;
}
