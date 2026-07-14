/**
 * PlaceCandidateModal
 *
 * Obsidian Modal for reviewing pending place candidates of one archive
 * (Places P3c). Presented when the user taps the timeline
 * PlaceCandidateBanner.
 *
 * Per-candidate actions:
 * - candidates with data (name or addressText, any evidence type) →
 *   confirm-apply, with an inline "Replace current location?" second step
 *   when the note already has a location
 * - data-less hints (name=null, addressText=null) → hint copy pointing at
 *   manual entry (empty-body confirm would 400)
 * - maps_url evidence → archive the map URL through the plugin's normal
 *   archive flow (linking completes on mobile; candidate stays pending)
 * - manual entry (place name + address) → confirm with overrides
 * - "No place in this post" → reject every pending candidate
 *
 * Single Responsibility: user review UI for place candidates. Frontmatter
 * writes and cache invalidation stay with the caller (PostCardRenderer).
 */

import { App, Modal, Notice } from 'obsidian';
import type {
  PlaceCandidate,
  PlaceCandidateConfirmBody,
  PlaceCandidateConfirmResult,
} from '../services/WorkersAPIClient';

// ============================================================================
// Public types
// ============================================================================

export interface PlaceCandidateModalOptions {
  /** Pending candidates for the archive (non-empty). */
  candidates: PlaceCandidate[];
  /** Current `location` frontmatter of the note, if any. */
  currentLocation: string | null;
  /** Server confirm call. Throws with code CANDIDATE_NOT_PENDING on races. */
  confirmCandidate: (
    candidateId: string,
    body?: PlaceCandidateConfirmBody,
  ) => Promise<PlaceCandidateConfirmResult>;
  /** Server reject call. */
  rejectCandidate: (candidateId: string) => Promise<void>;
  /** Open the plugin's normal archive flow prefilled with the maps URL. */
  archiveMapsUrl: (url: string) => void;
  /** Called after a successful confirm — caller writes frontmatter + refreshes. */
  onApplied: (result: PlaceCandidateConfirmResult) => void | Promise<void>;
  /** Called after every pending candidate was rejected. */
  onRejectedAll: () => void | Promise<void>;
  /** Called when candidates turned out stale (reviewed on another device). */
  onStale: () => void;
}

// ============================================================================
// Modal
// ============================================================================

export class PlaceCandidateModal extends Modal {
  private readonly options: PlaceCandidateModalOptions;
  private busy = false;

  constructor(app: App, options: PlaceCandidateModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass('social-archiver-modal', 'sa-place-candidate-modal');
    modalEl.setCssStyles({ maxWidth: '480px' });

    contentEl.createEl('h3', { text: 'Places in this post' })
      .setCssStyles({ marginBottom: '4px' });
    contentEl.createEl('p', {
      text: 'Review the detected evidence, then confirm, archive, or dismiss.',
    }).setCssStyles({ marginBottom: '12px', color: 'var(--text-muted)', fontSize: '0.85em' });

    for (const candidate of this.options.candidates) {
      this.renderCandidateCard(contentEl, candidate);
    }

    this.renderManualEntry(contentEl);
    this.renderFooter(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // --------------------------------------------------------------------------
  // Candidate cards
  // --------------------------------------------------------------------------

  private renderCandidateCard(parent: HTMLElement, candidate: PlaceCandidate): void {
    const card = parent.createDiv({ cls: 'sa-place-candidate-card' });
    card.setCssStyles({
      border: '1px solid var(--background-modifier-border)',
      borderRadius: '8px',
      padding: '10px 12px',
      marginBottom: '10px',
    });

    // Header row: name + confidence badge
    const headerRow = card.createDiv();
    headerRow.setCssStyles({ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' });
    headerRow.createEl('strong', { text: candidate.name ?? candidate.addressText ?? 'Detected place' })
      .setCssStyles({ flex: '1', minWidth: '0' });
    if (candidate.confidenceBucket) {
      const badge = headerRow.createSpan({ text: candidate.confidenceBucket });
      badge.setCssStyles({
        fontSize: '0.7em',
        padding: '1px 6px',
        borderRadius: '8px',
        backgroundColor: 'var(--background-modifier-hover)',
        color: 'var(--text-muted)',
        flexShrink: '0',
      });
    }

    if (candidate.name && candidate.addressText) {
      card.createEl('div', { text: candidate.addressText })
        .setCssStyles({ fontSize: '0.85em', color: 'var(--text-muted)', marginBottom: '4px' });
    }

    // Evidence snippet
    const evidence = candidate.evidenceText.length > 140
      ? `${candidate.evidenceText.slice(0, 140)}…`
      : candidate.evidenceText;
    if (evidence) {
      card.createEl('div', { text: `Evidence (${candidate.evidenceType}): ${evidence}` })
        .setCssStyles({ fontSize: '0.8em', color: 'var(--text-faint)', marginBottom: '8px', wordBreak: 'break-all' });
    }

    if (candidate.evidenceType === 'maps_url') {
      this.renderMapsUrlActions(card, candidate);
    } else if (candidate.name || candidate.addressText) {
      // Data-driven: any candidate with a name or extracted address line
      // (anchor-v3 addressText) is directly confirmable.
      this.renderTextConfirmActions(card, candidate);
    } else {
      // Data-less hint — an empty-body confirm would 400 (NOTHING_TO_APPLY);
      // manual entry below is the only confirm path.
      card.createEl('div', {
        text: 'A location hint was detected. Enter the place manually below.',
      }).setCssStyles({ fontSize: '0.8em', color: 'var(--text-muted)' });
    }
  }

  /** maps_url candidates: archive the map link through the normal flow. */
  private renderMapsUrlActions(card: HTMLElement, candidate: PlaceCandidate): void {
    const url = candidate.evidenceText.trim();
    const isUrl = /^https?:\/\//i.test(url);

    const providerRow = card.createDiv({
      text: `Map link${candidate.externalSource ? ` (${candidate.externalSource})` : ''}`,
    });
    providerRow.setCssStyles({ fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: '6px' });

    const note = card.createEl('div', {
      text: 'Archiving the map link uses your normal archive flow. Linking to this post completes on mobile — this suggestion stays pending until then.',
    });
    note.setCssStyles({ fontSize: '0.75em', color: 'var(--text-faint)', marginBottom: '8px' });

    const row = card.createDiv();
    row.setCssStyles({ display: 'flex', justifyContent: 'flex-end' });
    const archiveBtn = row.createEl('button', { text: 'Archive map link', cls: 'mod-cta' });
    if (!isUrl) {
      archiveBtn.disabled = true;
      archiveBtn.setAttribute('title', 'No usable map URL in this candidate');
      return;
    }
    archiveBtn.addEventListener('click', () => {
      if (this.busy) return;
      this.options.archiveMapsUrl(url);
      this.close();
    });
  }

  /** Candidates with applyable data (name or addressText): confirm-apply. */
  private renderTextConfirmActions(card: HTMLElement, candidate: PlaceCandidate): void {
    const row = card.createDiv();
    row.setCssStyles({ display: 'flex', justifyContent: 'flex-end', gap: '8px' });

    const applyBtn = row.createEl('button', { text: 'Apply to note', cls: 'mod-cta' });
    let confirmArmed = false;

    applyBtn.addEventListener('click', () => {
      if (this.busy) return;

      // Two-step confirm when the note already has a location.
      if (this.options.currentLocation && !confirmArmed) {
        confirmArmed = true;
        applyBtn.setText(`Replace "${this.options.currentLocation}"?`);
        applyBtn.removeClass('mod-cta');
        applyBtn.addClass('mod-warning');
        return;
      }

      void this.runConfirm(candidate.id, undefined, applyBtn);
    });
  }

  // --------------------------------------------------------------------------
  // Manual entry
  // --------------------------------------------------------------------------

  private renderManualEntry(parent: HTMLElement): void {
    const first = this.options.candidates[0];
    if (!first) return;

    const section = parent.createDiv();
    section.setCssStyles({ marginTop: '4px', marginBottom: '12px' });
    section.createEl('div', { text: 'Or enter the place manually' })
      .setCssStyles({ fontSize: '0.85em', color: 'var(--text-muted)', marginBottom: '6px' });

    const inputRow = section.createDiv();
    inputRow.setCssStyles({ display: 'flex', gap: '8px', marginBottom: '6px' });

    const nameInput = inputRow.createEl('input', { type: 'text', placeholder: 'Place name' });
    nameInput.setCssStyles({ flex: '1' });
    const addressInput = inputRow.createEl('input', { type: 'text', placeholder: 'Address (optional)' });
    addressInput.setCssStyles({ flex: '1' });

    const buttonRow = section.createDiv();
    buttonRow.setCssStyles({ display: 'flex', justifyContent: 'flex-end' });
    const applyBtn = buttonRow.createEl('button', { text: 'Apply manual entry' });
    applyBtn.addEventListener('click', () => {
      if (this.busy) return;
      const location = nameInput.value.trim();
      if (!location) {
        nameInput.focus();
        return;
      }
      const body: PlaceCandidateConfirmBody = { location };
      const addressText = addressInput.value.trim();
      if (addressText) body.addressText = addressText;
      // ponytail: manual entry confirms against the first pending candidate —
      // per-candidate manual overrides can come later if anyone asks.
      void this.runConfirm(first.id, body, applyBtn);
    });
  }

  // --------------------------------------------------------------------------
  // Footer (reject all)
  // --------------------------------------------------------------------------

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv();
    footer.setCssStyles({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTop: '1px solid var(--background-modifier-border)',
      paddingTop: '10px',
    });

    const rejectBtn = footer.createEl('button', { text: 'No place in this post' });
    rejectBtn.addEventListener('click', () => {
      if (this.busy) return;
      void this.runRejectAll(rejectBtn);
    });

    const closeBtn = footer.createEl('button', { text: 'Close' });
    closeBtn.addEventListener('click', () => this.close());
  }

  // --------------------------------------------------------------------------
  // Server actions
  // --------------------------------------------------------------------------

  private async runConfirm(
    candidateId: string,
    body: PlaceCandidateConfirmBody | undefined,
    button: HTMLButtonElement,
  ): Promise<void> {
    this.busy = true;
    button.disabled = true;
    const originalText = button.getText();
    button.setText('Applying…');
    try {
      const result = await this.options.confirmCandidate(candidateId, body);
      await this.options.onApplied(result);
      new Notice('Place applied to note');
      this.close();
    } catch (error) {
      this.busy = false;
      button.disabled = false;
      button.setText(originalText);
      if (this.isNotPendingError(error)) {
        new Notice('This place suggestion was already reviewed on another device.');
        this.options.onStale();
        this.close();
        return;
      }
      new Notice(`Failed to apply place: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async runRejectAll(button: HTMLButtonElement): Promise<void> {
    this.busy = true;
    button.disabled = true;
    button.setText('Dismissing…');
    try {
      for (const candidate of this.options.candidates) {
        try {
          await this.options.rejectCandidate(candidate.id);
        } catch (error) {
          // Already-reviewed candidates are fine to skip; anything else is too —
          // reject-all is best-effort suppression.
          if (!this.isNotPendingError(error)) {
            console.warn('[Social Archiver] Failed to reject place candidate:', candidate.id, error);
          }
        }
      }
      await this.options.onRejectedAll();
      this.close();
    } catch (error) {
      this.busy = false;
      button.disabled = false;
      button.setText('No place in this post');
      new Notice(`Failed to dismiss: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private isNotPendingError(error: unknown): boolean {
    return error instanceof Error
      && (error as Error & { code?: string }).code === 'CANDIDATE_NOT_PENDING';
  }
}
