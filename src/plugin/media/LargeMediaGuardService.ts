/**
 * LargeMediaGuardService
 *
 * Implements the Prevention half of the Large Media Guard PRD
 * (prd-large-media-guard.md). The service is only engaged during
 * user-initiated (foreground) archive flows. It answers two questions:
 *
 * 1. Does the post being archived contain any top-level video whose estimated
 *    size exceeds the user's threshold?
 *    -> {@link inspectTopLevelMedia}
 * 2. If so, should local media be downloaded or should the archive keep only
 *    the note (detached state)?
 *    -> {@link promptIfNeeded}
 *
 * Size probing is done via HEAD requests with a Range-based GET fallback. When
 * neither probe yields a size, the URL is treated as unknown and NOT included
 * in the oversized list (fail-open: better to download than to block on an
 * unanswered probe).
 *
 * Background / subscription / realtime flows must NOT use this service. Those
 * flows cannot reasonably surface a modal and sit outside PRD scope guardrails.
 *
 * Single Responsibility: oversize detection + user prompt. Actual note rewrite
 * and attachment deletion for an already-saved note is handled by
 * `DetachedMediaService` (Stream C).
 */

import { App, Modal, requestUrl, type RequestUrlResponse } from 'obsidian';
import type { Media, PostData } from '@/types/post';
import type { SocialArchiverSettings } from '@/types/settings';
import type { Logger } from '@/services/Logger';

// ============================================================================
// Public types
// ============================================================================

/**
 * User decision produced by {@link LargeMediaGuardService.promptIfNeeded}.
 *
 * `action === 'detach'` means top-level local media must NOT be written to the
 * vault for this archive. The note will still be saved, but it will render
 * remote URLs (or link placeholders) instead of local embeds.
 *
 * `action === 'download'` means the standard download flow continues.
 *
 * `suppressPromptForArchive === true` means this note should persist
 * `mediaPromptSuppressed: true` so subsequent re-archive flows skip the modal.
 */
export interface LargeMediaDecision {
  action: 'download' | 'detach';
  suppressPromptForArchive: boolean;
}

/**
 * Result of a top-level media inspection pass.
 *
 * `oversizedVideoUrls` is the ordered list of top-level video URLs whose
 * probed size exceeded the configured threshold. Order matches PostData.media
 * video order so the orchestrator can translate back to media indices.
 *
 * `estimatedBytesByUrl` stores the probed size keyed by original URL. It is
 * only populated for URLs we successfully probed. Absent entries mean
 * "unknown size" and should be treated as "do not prompt".
 */
export interface OversizedMediaInfo {
  oversizedVideoUrls: string[];
  estimatedBytesByUrl: Map<string, number>;
}

// ============================================================================
// Internals
// ============================================================================

/** Per-URL HEAD/Range probe timeout. Worker-friendly ceiling. */
const PROBE_TIMEOUT_MS = 8000;

/** Parse an integer header value (e.g. Content-Length). Returns null if invalid. */
function parseIntegerHeader(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse a `Content-Range: bytes start-end/total` header.
 * Returns the total byte size if present and valid, null otherwise.
 */
function parseContentRangeTotal(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /\/(\d+)\s*$/.exec(String(value).trim());
  if (!match) return null;
  const total = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Read a header from a RequestUrlResponse case-insensitively. Obsidian's
 * `requestUrl` returns a plain object, so we can't rely on `.get()`.
 */
function getHeader(response: RequestUrlResponse, name: string): string | null {
  const headers = response.headers as Record<string, string> | undefined;
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * Internal modal shown by {@link LargeMediaGuardService.promptIfNeeded}.
 *
 * Defined in the same file because it is only meaningful as the UI surface of
 * this service. Extracting it would fragment the prevention flow.
 */
class LargeVideoPromptModal extends Modal {
  private readonly resolve: (decision: LargeMediaDecision) => void;
  private readonly thresholdMb: number;
  private readonly videoCount: number;
  private readonly largestBytes: number;
  private settled = false;

  constructor(
    app: App,
    resolve: (decision: LargeMediaDecision) => void,
    thresholdMb: number,
    videoCount: number,
    largestBytes: number,
  ) {
    super(app);
    this.resolve = resolve;
    this.thresholdMb = thresholdMb;
    this.videoCount = videoCount;
    this.largestBytes = largestBytes;
  }

  private settle(decision: LargeMediaDecision): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(decision);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    modalEl.addClass('social-archiver-modal', 'sa-large-video-prompt-modal');
    modalEl.style.maxWidth = '440px';

    // Title
    const title = contentEl.createEl('h3', { text: 'Large video detected' });
    title.style.marginBottom = '8px';

    // Body
    const body = contentEl.createEl('p', {
      text: 'This archive contains a video larger than your threshold. Choose whether to keep local media or keep the note only.',
    });
    body.style.marginBottom = '8px';

    // Size / count detail row (best effort — largestBytes may be 0 if unknown)
    const detailParts: string[] = [];
    if (this.videoCount > 1) {
      detailParts.push(`${this.videoCount} videos`);
    } else if (this.videoCount === 1) {
      detailParts.push('1 video');
    }
    detailParts.push(`threshold ${this.thresholdMb} MB`);
    if (this.largestBytes > 0) {
      const mb = Math.round(this.largestBytes / (1024 * 1024));
      detailParts.push(`largest ~${mb} MB`);
    }
    const detail = contentEl.createEl('p', {
      text: detailParts.join(' · '),
    });
    detail.style.fontSize = '0.85em';
    detail.style.color = 'var(--text-muted)';
    detail.style.marginBottom = '14px';

    // "Don't ask again" checkbox
    const checkboxRow = contentEl.createDiv();
    checkboxRow.style.display = 'flex';
    checkboxRow.style.alignItems = 'center';
    checkboxRow.style.gap = '6px';
    checkboxRow.style.marginBottom = '16px';
    const checkbox = checkboxRow.createEl('input', { type: 'checkbox' });
    checkbox.id = 'sa-large-video-dont-ask-again';
    const label = checkboxRow.createEl('label', {
      text: "Don't ask again for this archive",
      attr: { for: 'sa-large-video-dont-ask-again' },
    });
    label.style.fontSize = '0.9em';

    // Buttons
    const buttonRow = contentEl.createDiv();
    buttonRow.style.display = 'flex';
    buttonRow.style.justifyContent = 'flex-end';
    buttonRow.style.gap = '8px';

    const detachBtn = buttonRow.createEl('button', { text: 'Keep note only' });
    detachBtn.addEventListener('click', () => {
      this.settle({ action: 'detach', suppressPromptForArchive: checkbox.checked });
      this.close();
    });

    const downloadBtn = buttonRow.createEl('button', {
      text: 'Download local media',
      cls: 'mod-cta',
    });
    downloadBtn.addEventListener('click', () => {
      this.settle({ action: 'download', suppressPromptForArchive: checkbox.checked });
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissed modal (ESC/backdrop) defaults to 'download' to respect the
    // user's original archive intent. Detach is destructive and requires explicit opt-in.
    this.settle({ action: 'download', suppressPromptForArchive: false });
  }
}

// ============================================================================
// Service
// ============================================================================

export class LargeMediaGuardService {
  constructor(
    private readonly app: App,
    private readonly settings: SocialArchiverSettings,
    private readonly logger?: Logger,
  ) {}

  /**
   * Probe each top-level video in `media` and return the ones whose estimated
   * size exceeds `thresholdMb`.
   *
   * Rules:
   * - Non-video media is ignored.
   * - `thresholdMb <= 0` short-circuits to an empty result (feature disabled).
   * - URLs we fail to probe are treated as "unknown" and NOT reported.
   * - Probes run in parallel (bounded implicitly by `media.length`).
   */
  async inspectTopLevelMedia(
    media: Media[],
    thresholdMb: number,
  ): Promise<OversizedMediaInfo> {
    const result: OversizedMediaInfo = {
      oversizedVideoUrls: [],
      estimatedBytesByUrl: new Map<string, number>(),
    };

    if (!Array.isArray(media) || media.length === 0) return result;
    if (!Number.isFinite(thresholdMb) || thresholdMb <= 0) return result;

    const thresholdBytes = Math.floor(thresholdMb * 1024 * 1024);

    const videoUrls = media
      .filter((m) => m && m.type === 'video' && typeof m.url === 'string')
      .map((m) => m.url)
      // Only probe remote http(s) URLs. Local attachments already in the vault
      // would fail HEAD and wouldn't be "oversized for download" anyway.
      .filter((url) => /^https?:\/\//i.test(url));

    if (videoUrls.length === 0) return result;

    const probes = await Promise.all(
      videoUrls.map((url) => this.probeSize(url).then((bytes) => ({ url, bytes }))),
    );

    for (const { url, bytes } of probes) {
      if (bytes === null) continue; // unknown -> skip
      result.estimatedBytesByUrl.set(url, bytes);
      if (bytes > thresholdBytes) {
        result.oversizedVideoUrls.push(url);
      }
    }

    return result;
  }

  /**
   * Open the large-video modal and resolve with the user's decision.
   *
   * Returns `null` when no prompt is required. Callers must respect this and
   * NOT mutate postData when `null` is returned.
   *
   * The service also respects `postData.mediaPromptSuppressed === true`: if
   * the flag is set we skip the prompt unconditionally, preserving the user's
   * prior choice across re-archive flows (per PRD, section "Edge Cases").
   */
  async promptIfNeeded(
    oversizedInfo: OversizedMediaInfo,
    postData: PostData,
  ): Promise<LargeMediaDecision | null> {
    if (oversizedInfo.oversizedVideoUrls.length === 0) return null;
    if (postData.mediaPromptSuppressed === true) {
      this.logger?.debug?.(
        '[LargeMediaGuardService] Skipping prompt (mediaPromptSuppressed=true)',
      );
      return null;
    }

    const videoCount = oversizedInfo.oversizedVideoUrls.length;
    let largest = 0;
    for (const url of oversizedInfo.oversizedVideoUrls) {
      const bytes = oversizedInfo.estimatedBytesByUrl.get(url) ?? 0;
      if (bytes > largest) largest = bytes;
    }

    return new Promise<LargeMediaDecision | null>((resolve) => {
      let settled = false;
      const settle = (decision: LargeMediaDecision): void => {
        if (settled) return;
        settled = true;
        resolve(decision);
      };

      const modal = new LargeVideoPromptModal(
        this.app,
        settle,
        this.settings.largeVideoPromptThresholdMB,
        videoCount,
        largest,
      );
      modal.open();
    });
  }

  // --------------------------------------------------------------------------
  // Size probing (private)
  // --------------------------------------------------------------------------

  /**
   * Probe a URL for content size. Returns bytes or null when unknown.
   *
   * Strategy:
   * 1. HEAD -> Content-Length
   * 2. GET Range: bytes=0-0 -> Content-Range total, fallback Content-Length
   *
   * All errors are caught and logged at debug level. Never throws.
   */
  private async probeSize(url: string): Promise<number | null> {
    // 1. HEAD
    try {
      const headResponse = await this.timedRequest({
        url,
        method: 'HEAD',
        throw: false,
      });
      if (headResponse) {
        const contentLength = parseIntegerHeader(getHeader(headResponse, 'content-length'));
        if (contentLength !== null && contentLength > 0) return contentLength;
      }
    } catch (err) {
      this.logger?.debug?.('[LargeMediaGuardService] HEAD probe failed', { url, err });
    }

    // 2. Range fallback
    try {
      const rangeResponse = await this.timedRequest({
        url,
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        throw: false,
      });
      if (rangeResponse) {
        const total = parseContentRangeTotal(getHeader(rangeResponse, 'content-range'));
        if (total !== null) return total;

        const contentLength = parseIntegerHeader(getHeader(rangeResponse, 'content-length'));
        if (contentLength !== null && contentLength > 0) return contentLength;
      }
    } catch (err) {
      this.logger?.debug?.('[LargeMediaGuardService] Range probe failed', { url, err });
    }

    return null;
  }

  /**
   * Thin wrapper around `requestUrl` with a hard timeout. Obsidian's request
   * API does not expose an abort signal, so we race the call against a timer
   * and discard the result when the timer wins.
   */
  private async timedRequest(
    params: Parameters<typeof requestUrl>[0],
  ): Promise<RequestUrlResponse | null> {
    return new Promise<RequestUrlResponse | null>((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, PROBE_TIMEOUT_MS);

      requestUrl(params)
        .then((response) => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve(response);
        })
        .catch(() => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve(null);
        });
    });
  }
}
