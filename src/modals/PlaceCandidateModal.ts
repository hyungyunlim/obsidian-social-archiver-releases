import { App, Modal, Notice } from 'obsidian';
import type {
  ArchiveLocation,
  AttachPlaceCandidatesBatchBody,
  PlaceCandidate,
  PlaceCandidateAttachmentResult,
} from '../services/WorkersAPIClient';
import { showConfirmModal } from '../utils/confirm-modal';
import {
  buildDirectCandidateAttachment,
  type CandidateCorrection,
  countNonHintPending,
  isStaleCandidateError,
  orderPlaceCandidates,
  PLACE_EXTRACT_PENDING_CAP,
} from './placeCandidateReviewModel';
import { renderCandidateReviewView } from './placeCandidateReviewView';

export type CandidatePlacePickerRequest = {
  readonly candidate: PlaceCandidate;
  readonly initialView: 'search' | 'existing';
  readonly onAttached: (result: PlaceCandidateAttachmentResult) => void | Promise<void>;
  readonly onClosed: () => void;
};

/**
 * Result of a caller-owned extraction run (§7.2). The caller performs the
 * `extractPlaceCandidates` call, resolves the 202/200 flow (poll + WS), refreshes
 * the candidate store, and hands back the fresh list plus a status line. Any
 * user-facing toast (replay / no-results / errors) is the caller's job.
 */
export type PlaceExtractionModalOutcome = {
  readonly candidates: readonly PlaceCandidate[];
  readonly message: string;
};

export type PlaceCandidateModalOptions = {
  readonly candidates: readonly PlaceCandidate[];
  readonly currentLocations: readonly ArchiveLocation[];
  readonly attachBatch: (
    body: AttachPlaceCandidatesBatchBody,
  ) => Promise<PlaceCandidateAttachmentResult>;
  readonly rejectCandidate: (candidateId: string) => Promise<void>;
  readonly refetchCandidates: () => Promise<readonly PlaceCandidate[]>;
  readonly openPlacePicker: (request: CandidatePlacePickerRequest) => void;
  readonly onReconciled: (result: PlaceCandidateAttachmentResult) => void | Promise<void>;
  readonly onCandidatesChanged: (
    candidates: readonly PlaceCandidate[],
    globalPendingCount: number | null,
  ) => void | Promise<void>;
  /**
   * Optional AI place extractor. When present, the review UI offers a "Find …
   * places with AI" CTA. The `signal` aborts when the modal closes so the caller
   * can stop polling.
   */
  readonly onExtract?: (signal: AbortSignal) => Promise<PlaceExtractionModalOutcome>;
  /** Pre-focus the extract CTA on open (anchor-hint entry, §7.1). */
  readonly focusExtractCta?: boolean;
  /** Called from `onClose` so the caller can drop its open-modal reference. */
  readonly onModalClosed?: () => void;
};

export class PlaceCandidateModal extends Modal {
  private candidates: readonly PlaceCandidate[];
  private readonly selected = new Set<string>();
  private readonly corrections = new Map<string, CandidateCorrection>();
  private editingCandidateId: string | null = null;
  private pendingBatchRequest: {
    readonly intent: string;
    readonly idempotencyKey: string;
  } | null = null;
  private busy = false;
  private liveMessage = '';
  private extracting = false;
  private extractController: AbortController | null = null;
  private hasFocusedExtractCta = false;

  constructor(app: App, private readonly options: PlaceCandidateModalOptions) {
    super(app);
    this.candidates = orderPlaceCandidates(options.candidates);
  }

  onOpen(): void {
    this.modalEl.addClass('social-archiver-modal', 'sa-place-candidate-modal');
    this.render();
  }

  onClose(): void {
    this.extractController?.abort();
    this.extractController = null;
    this.contentEl.empty();
    this.options.onModalClosed?.();
  }

  private render(): void {
    renderCandidateReviewView(this.contentEl, {
      candidates: this.candidates,
      currentLocations: this.options.currentLocations,
      selected: this.selected,
      corrections: this.corrections,
      editingCandidateId: this.editingCandidateId,
      busy: this.busy,
      liveMessage: this.liveMessage,
      extractAvailable: Boolean(this.options.onExtract),
      extractDisabled: countNonHintPending(this.candidates) >= PLACE_EXTRACT_PENDING_CAP,
      extracting: this.extracting,
    }, {
      onToggle: (candidateId, checked) => this.toggleSelected(candidateId, checked),
      onEdit: candidateId => this.editCandidate(candidateId),
      onSave: (candidateId, name, address) => this.saveCorrection(candidateId, name, address),
      onPicker: (candidate, view, button) => this.openPicker(candidate, view, button),
      onDismiss: candidateId => void this.dismissOne(candidateId),
      onAddSelected: () => void this.attachSelected(),
      onDismissAll: () => void this.dismissAll(),
      onExtract: () => void this.runExtraction(),
      onClose: () => this.close(),
    });
    this.maybeFocusExtractCta();
  }

  /** Pre-focus the extract CTA once on open when the anchor-hint entry asked for it. */
  private maybeFocusExtractCta(): void {
    if (this.hasFocusedExtractCta || !this.options.focusExtractCta || !this.options.onExtract) return;
    if (this.busy || this.extracting) return;
    const cta = this.contentEl.querySelector<HTMLButtonElement>('[data-extract-cta]');
    if (!cta || cta.disabled) return;
    this.hasFocusedExtractCta = true;
    cta.focus();
  }

  /**
   * Run the caller-owned extractor and fold its fresh candidate list back in.
   * The spinner is shown for the whole 202→terminal flow; the caller emits any
   * toast (replay / no-results / billing errors).
   */
  private async runExtraction(): Promise<void> {
    if (this.busy || this.extracting || !this.options.onExtract) return;
    this.extractController = new AbortController();
    this.extracting = true;
    this.busy = true;
    this.liveMessage = 'Analyzing for places…';
    this.render();
    try {
      const outcome = await this.options.onExtract(this.extractController.signal);
      this.candidates = orderPlaceCandidates(outcome.candidates);
      this.selected.clear();
      this.liveMessage = outcome.message;
    } catch (error) {
      // The caller surfaces the toast; the modal just narrates and unlocks.
      this.liveMessage = error instanceof Error && error.message
        ? `Could not analyze for places. ${error.message}`
        : 'Could not analyze for places.';
    } finally {
      this.extracting = false;
      this.busy = false;
      this.extractController = null;
      this.render();
    }
  }

  /**
   * Inject candidates refreshed by an out-of-band signal (the WS ai-action
   * terminal handler, §7.2). No-op while a local operation owns the list.
   */
  applyExtractionResult(candidates: readonly PlaceCandidate[]): void {
    if (this.busy || this.extracting) return;
    this.candidates = orderPlaceCandidates(candidates);
    this.liveMessage = this.candidates.length === 0
      ? 'No places found in this post.'
      : 'Place suggestions updated.';
    this.render();
  }

  private toggleSelected(candidateId: string, checked: boolean): void {
    if (checked) this.selected.add(candidateId);
    else this.selected.delete(candidateId);
    this.liveMessage = `${this.selected.size} selected.`;
    this.render();
    this.focus(`[data-select-candidate="${candidateId}"]`);
  }

  private editCandidate(candidateId: string): void {
    this.editingCandidateId = candidateId;
    this.render();
    this.focus(`[data-correction-name="${candidateId}"]`);
  }

  private saveCorrection(candidateId: string, rawName: string, rawAddress: string): void {
    const correction = { name: rawName.trim(), addressText: rawAddress.trim() };
    if (!correction.addressText) {
      this.liveMessage = 'An address is required for a direct addition.';
      this.render();
      this.focus(`[data-correction-address="${candidateId}"]`);
      return;
    }
    this.corrections.set(candidateId, correction);
    this.editingCandidateId = null;
    this.liveMessage = `Details saved for ${correction.name || 'this place'}.`;
    this.render();
    this.focus(`[data-select-candidate="${candidateId}"]`);
  }

  private openPicker(
    candidate: PlaceCandidate,
    initialView: CandidatePlacePickerRequest['initialView'],
    button: HTMLButtonElement,
  ): void {
    this.options.openPlacePicker({
      candidate,
      initialView,
      onAttached: result => this.reconcile(result),
      onClosed: () => {
        window.requestAnimationFrame(() => button.focus());
      },
    });
  }

  private async attachSelected(): Promise<void> {
    if (this.busy || this.selected.size === 0) return;
    const candidates = this.candidates
      .filter((candidate) => this.selected.has(candidate.id))
      .map((candidate) => buildDirectCandidateAttachment(candidate, this.corrections.get(candidate.id)));
    const intent = JSON.stringify(candidates);
    const request = this.pendingBatchRequest?.intent === intent
      ? this.pendingBatchRequest
      : { intent, idempotencyKey: `candidate-batch:${crypto.randomUUID()}` };
    this.pendingBatchRequest = request;
    this.busy = true;
    this.liveMessage = 'Adding selected places…';
    this.render();
    try {
      await this.reconcile(await this.options.attachBatch({
        idempotencyKey: request.idempotencyKey,
        candidates,
      }));
    } catch (error) {
      await this.recoverOrReport(error, 'add selected places');
    }
  }

  private async reconcile(result: PlaceCandidateAttachmentResult): Promise<void> {
    try {
      await this.options.onReconciled(result);
    } catch (error) {
      new Notice(`Places were attached, but the note refresh failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`);
    }
    this.candidates = orderPlaceCandidates(result.remainingPendingCandidates);
    this.pendingBatchRequest = null;
    this.selected.clear();
    this.busy = false;
    this.liveMessage = this.candidates.length === 1
      ? '1 place remains.'
      : `${this.candidates.length} places remain.`;
    this.render();
    this.focusFirstAction();
  }

  private async dismissOne(candidateId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.options.rejectCandidate(candidateId);
      this.candidates = this.candidates.filter((candidate) => candidate.id !== candidateId);
      this.selected.delete(candidateId);
      await this.finishDismiss('Place dismissed.');
    } catch (error) {
      await this.recoverOrReport(error, 'dismiss this place');
    }
  }

  private async dismissAll(): Promise<void> {
    if (this.busy) return;
    const confirmed = await showConfirmModal(this.app, {
      title: 'Dismiss all place candidates?',
      message: 'Each remaining candidate will be dismissed independently.',
      confirmText: 'Dismiss all',
      confirmClass: 'warning',
    });
    if (!confirmed) return;
    this.busy = true;
    this.render();
    try {
      await Promise.all(this.candidates.map((candidate) => this.options.rejectCandidate(candidate.id)));
      this.candidates = [];
      this.selected.clear();
      await this.finishDismiss('All place candidates were dismissed.');
    } catch (error) {
      await this.recoverOrReport(error, 'dismiss all places');
    }
  }

  private async finishDismiss(message: string): Promise<void> {
    this.busy = false;
    this.liveMessage = message;
    await this.options.onCandidatesChanged(this.candidates, null);
    this.render();
    this.focusFirstAction();
  }

  private async recoverOrReport(error: unknown, action: string): Promise<void> {
    this.busy = false;
    if (isStaleCandidateError(error)) {
      this.pendingBatchRequest = null;
      this.candidates = orderPlaceCandidates(await this.options.refetchCandidates());
      this.selected.clear();
      this.liveMessage = 'Place candidates changed elsewhere. The current list is shown.';
      await this.options.onCandidatesChanged(this.candidates, null);
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.liveMessage = `Could not ${action}. ${message}`;
      new Notice(this.liveMessage);
    }
    this.render();
  }

  private focusFirstAction(): void {
    this.focus('[data-select-candidate], [data-provider-candidate], [data-existing-candidate], button');
  }

  private focus(selector: string): void {
    this.contentEl.querySelector<HTMLElement>(selector)?.focus();
  }
}
