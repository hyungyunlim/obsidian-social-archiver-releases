import { App, Modal, Notice } from 'obsidian';
import type {
  ArchiveLocation,
  AttachPlaceCandidateProviderBody,
  AttachPlaceCandidatesBatchBody,
  PlaceCandidate,
  PlaceCandidateAttachmentResult,
  PlaceContextNoteDecisionResult,
  PlaceContextNoteProposal,
  ProviderSearchCandidate,
  ProviderSearchRequest,
  ProviderSearchResponse,
} from '../services/WorkersAPIClient';
import type { ExtractPlaceCandidatesExecutionPreference } from '../types/place-candidate-attachment';
import {
  resolveMapSearchProvider,
  type MapSearchProvider,
  type MapSearchProviderPreference,
} from '../shared/platforms/map-search-provider';
import {
  inferPlaceKindFromText,
  type PlaceKind,
  type PlaceKindIntent,
} from '../shared/platforms/place-kinds';
import { showConfirmModal } from '../utils/confirm-modal';
import {
  clearPlaceCandidateReviewCache,
  loadPlaceCandidateReviewCache,
  savePlaceCandidateReviewCache,
} from './placeCandidateReviewCache';
import {
  buildDirectCandidateAttachment,
  candidateSearchQuery,
  countNonHintPending,
  isStaleCandidateError,
  orderPlaceCandidates,
  PLACE_EXTRACT_PENDING_CAP,
  placeSearchStopReason,
  stageDirectCandidate,
  stageProviderCandidate,
  type CandidateCorrection,
  type CandidateInlineSearch,
  type StagedCandidateMatch,
  type StagedProviderCandidate,
} from './placeCandidateReviewModel';
import { renderCandidateReviewView } from './placeCandidateReviewView';

const PROVIDER_RESULT_LIMIT = 3;
const PROVIDER_ATTACH_CONCURRENCY = 6;
const DIRECT_ATTACH_BATCH_SIZE = 8;
const SELECTION_TOKEN_SAFE_AGE_MS = 4 * 60 * 1_000;

export type CandidatePlacePickerRequest = {
  readonly candidate: PlaceCandidate;
  readonly initialView: 'search' | 'existing';
  readonly contextNoteIntent?: 'save' | 'skip';
  readonly placeKindIntent?: PlaceKindIntent;
  readonly onAttached: (result: PlaceCandidateAttachmentResult) => void | Promise<void>;
  readonly onClosed: () => void;
};

export type PlaceExtractionModalOutcome = {
  readonly candidates: readonly PlaceCandidate[];
  readonly message: string;
};

export type PlaceCandidateProviderRuntime = {
  readonly preference: MapSearchProviderPreference;
  readonly availability: Readonly<Record<MapSearchProvider, boolean>>;
};

export type PlaceCandidateModalOptions = {
  readonly archiveId: string;
  readonly hostLocale: string;
  readonly candidates: readonly PlaceCandidate[];
  readonly currentLocations: readonly ArchiveLocation[];
  readonly attachBatch: (
    body: AttachPlaceCandidatesBatchBody,
  ) => Promise<PlaceCandidateAttachmentResult>;
  readonly attachProvider: (
    candidateId: string,
    body: AttachPlaceCandidateProviderBody,
  ) => Promise<PlaceCandidateAttachmentResult>;
  readonly searchProvider: (request: ProviderSearchRequest) => Promise<ProviderSearchResponse>;
  readonly loadProviderRuntime: () => Promise<PlaceCandidateProviderRuntime>;
  readonly rejectCandidate: (candidateId: string) => Promise<void>;
  readonly refetchCandidates: () => Promise<readonly PlaceCandidate[]>;
  readonly loadContextNoteProposals?: () => Promise<readonly PlaceContextNoteProposal[]>;
  readonly decideContextNote?: (
    candidateId: string,
    intent: 'save' | 'skip',
  ) => Promise<PlaceContextNoteDecisionResult>;
  /** Dedicated legacy note-recovery session; never inferred from zero candidates. */
  readonly recoveryOnly?: boolean;
  readonly openPlacePicker: (request: CandidatePlacePickerRequest) => void;
  readonly onReconciled: (result: PlaceCandidateAttachmentResult) => void | Promise<void>;
  /**
   * Establish authoritative candidate/location truth once all background writes
   * settle. The returned list is used to retain only genuinely pending review work.
   */
  readonly onBackgroundCommitted: (
    results: readonly PlaceCandidateAttachmentResult[],
  ) => Promise<readonly PlaceCandidate[]>;
  readonly onCandidatesChanged: (
    candidates: readonly PlaceCandidate[],
    globalPendingCount: number | null,
  ) => void | Promise<void>;
  readonly onExtract?: (
    signal: AbortSignal,
    options: {
      includeOcr: boolean;
      includeComments: boolean;
      executionPreference: ExtractPlaceCandidatesExecutionPreference;
    },
  ) => Promise<PlaceExtractionModalOutcome>;
  readonly hasImages?: boolean;
  readonly hasComments?: boolean;
  readonly focusExtractCta?: boolean;
  readonly onModalClosed?: () => void;
};

export class PlaceCandidateModal extends Modal {
  private candidates: readonly PlaceCandidate[];
  private readonly staged = new Map<string, StagedCandidateMatch>();
  private readonly searches = new Map<string, CandidateInlineSearch>();
  private readonly corrections = new Map<string, CandidateCorrection>();
  private readonly contextNoteIntents = new Map<string, boolean>();
  private readonly placeKindIntents = new Map<string, PlaceKindIntent>();
  private readonly suppressedAutoIds = new Set<string>();
  private editingCandidateId: string | null = null;
  private provider: MapSearchProvider;
  private providerAvailability: Record<MapSearchProvider, boolean> = {
    kakaomap: true,
    googlemaps: true,
  };
  private preparing = false;
  private busy = false;
  private liveMessage = '';
  private extracting = false;
  private includeOcr: boolean;
  private includeComments: boolean;
  private executionPreference: ExtractPlaceCandidatesExecutionPreference = 'auto';
  private extractController: AbortController | null = null;
  private hasFocusedExtractCta = false;
  private isOpen = false;
  private cacheReady = false;
  private contextNoteProposals: readonly PlaceContextNoteProposal[] = [];
  private readonly recoveryIntents = new Map<string, boolean>();
  private recoveryLoading = false;
  private recoverySaving = false;
  private readonly recoverySession: boolean;

  constructor(app: App, private readonly options: PlaceCandidateModalOptions) {
    super(app);
    this.candidates = orderPlaceCandidates(options.candidates);
    this.recoverySession = options.recoveryOnly === true;
    this.includeOcr = options.hasImages === true;
    // Match the banner flow's defaults: include every available source unless
    // the user opted out (the review cache overrides this in hydrate).
    this.includeComments = options.hasComments === true;
    this.provider = resolveMapSearchProvider('auto', options.hostLocale).provider;
    this.reconcileCandidateState();
  }

  onOpen(): void {
    this.isOpen = true;
    this.modalEl.addClass('social-archiver-modal', 'sa-place-candidate-modal');
    // Native modal title keeps the chrome consistent with the other modals.
    this.setTitle(this.recoverySession ? 'Review saved place notes' : 'Places in this post');
    this.render();
    if (this.recoverySession) {
      void this.loadContextNoteProposals();
    } else {
      void this.prepareReview();
    }
  }

  onClose(): void {
    this.isOpen = false;
    this.extractController?.abort();
    this.extractController = null;
    this.contentEl.empty();
    this.options.onModalClosed?.();
  }

  private render(): void {
    if (!this.isOpen) return;
    renderCandidateReviewView(this.contentEl, {
      candidates: this.candidates,
      currentLocations: this.options.currentLocations,
      staged: this.staged,
      searches: this.searches,
      corrections: this.corrections,
      contextNoteIntents: this.contextNoteIntents,
      placeKindIntents: this.placeKindIntents,
      editingCandidateId: this.editingCandidateId,
      provider: this.provider,
      providerAvailability: this.providerAvailability,
      preparing: this.preparing,
      busy: this.busy,
      liveMessage: this.liveMessage,
      extractAvailable: Boolean(this.options.onExtract),
      extractDisabled: countNonHintPending(this.candidates) >= PLACE_EXTRACT_PENDING_CAP,
      extracting: this.extracting,
      imagesAvailable: this.options.hasImages === true,
      commentsAvailable: this.options.hasComments === true,
      includeOcr: this.includeOcr,
      includeComments: this.includeComments,
      executionPreference: this.executionPreference,
    }, {
      onClearStage: candidateId => this.clearStage(candidateId),
      onStageDirect: candidateId => this.stageDirect(candidateId),
      onContextNoteToggle: (candidateId, checked) => {
        this.contextNoteIntents.set(candidateId, checked);
        this.persistReviewCache();
        this.render();
      },
      onPlaceKindChange: (candidateId, placeKind) => this.setPlaceKind(candidateId, placeKind),
      onEdit: candidateId => this.editCandidate(candidateId),
      onSave: (candidateId, name, address) => this.saveCorrection(candidateId, name, address),
      onSearch: (candidateId, query) => void this.searchRow(candidateId, query),
      onStageProvider: (candidateId, result) => this.stageProvider(candidateId, result),
      onPickerExisting: (candidate, button) => this.openPicker(candidate, 'existing', button),
      onProviderChange: provider => this.setProvider(provider),
      onDismiss: candidateId => void this.dismissOne(candidateId),
      onAddReady: () => void this.attachReadyInBackground(),
      onDismissAll: () => void this.dismissAll(),
      onIncludeOcrToggle: checked => {
        this.includeOcr = checked;
        this.persistReviewCache();
        this.render();
      },
      onIncludeCommentsToggle: checked => {
        this.includeComments = checked;
        this.persistReviewCache();
        this.render();
      },
      onExecutionPreferenceChange: preference => {
        this.executionPreference = preference;
        this.persistReviewCache();
        this.render();
      },
      onExtract: () => void this.runExtraction(),
      onClose: () => this.close(),
    });
    this.renderContextNoteRecovery();
    this.maybeFocusExtractCta();
  }

  private async prepareReview(): Promise<void> {
    this.preparing = true;
    this.liveMessage = 'Matching likely places…';
    this.render();
    try {
      const runtime = await this.options.loadProviderRuntime().catch((): PlaceCandidateProviderRuntime => ({
        preference: 'auto',
        availability: { kakaomap: true, googlemaps: true },
      }));
      this.providerAvailability = { ...runtime.availability };
      this.provider = resolveMapSearchProvider(
        runtime.preference,
        this.options.hostLocale,
        runtime.availability,
      ).provider;
      if (this.providerAvailability[this.provider] === false) {
        const fallback: MapSearchProvider = this.provider === 'kakaomap'
          ? 'googlemaps'
          : 'kakaomap';
        if (this.providerAvailability[fallback] !== false) this.provider = fallback;
      }
      this.hydrateReviewCache();
      await this.resolveCandidatesAutomatically();
      this.liveMessage = this.staged.size > 0
        ? `${this.staged.size} likely ${this.staged.size === 1 ? 'place is' : 'places are'} ready to add.`
        : this.candidates.length === 0
          ? ''
          : 'No exact matches yet. Refine a search in the row.';
    } finally {
      this.cacheReady = true;
      this.preparing = false;
      this.persistReviewCache();
      this.render();
    }
  }

  private hydrateReviewCache(): void {
    const cached = loadPlaceCandidateReviewCache(
      this.options.archiveId,
      this.candidates.map(candidate => candidate.id),
    );
    if (!cached) {
      this.cacheReady = true;
      return;
    }
    if (this.providerAvailability[cached.provider] !== false) this.provider = cached.provider;
    this.staged.clear();
    for (const [candidateId, match] of Object.entries(cached.staged)) {
      this.staged.set(candidateId, match);
    }
    this.searches.clear();
    for (const [candidateId, search] of Object.entries(cached.searches)) {
      this.searches.set(candidateId, search);
    }
    for (const [candidateId, save] of Object.entries(cached.noteIntents)) {
      this.contextNoteIntents.set(candidateId, save);
    }
    for (const [candidateId, intent] of Object.entries(cached.kindIntents)) {
      this.placeKindIntents.set(candidateId, intent);
    }
    this.suppressedAutoIds.clear();
    for (const candidateId of cached.suppressedAutoIds) {
      this.suppressedAutoIds.add(candidateId);
    }
    this.includeOcr = this.options.hasImages === true && cached.includeOcr;
    this.includeComments = this.options.hasComments === true && cached.includeComments;
    this.executionPreference = cached.executionPreference;
    this.cacheReady = true;
  }

  private persistReviewCache(): void {
    if (!this.cacheReady) return;
    savePlaceCandidateReviewCache({
      archiveId: this.options.archiveId,
      provider: this.provider,
      staged: Object.fromEntries(this.staged),
      searches: Object.fromEntries(this.searches),
      noteIntents: Object.fromEntries(this.contextNoteIntents),
      kindIntents: Object.fromEntries(this.placeKindIntents),
      suppressedAutoIds: [...this.suppressedAutoIds],
      includeOcr: this.includeOcr,
      includeComments: this.includeComments,
      executionPreference: this.executionPreference,
    });
  }

  private async resolveCandidatesAutomatically(): Promise<void> {
    for (const candidate of this.candidates) {
      if (this.staged.has(candidate.id) || this.suppressedAutoIds.has(candidate.id)) continue;
      const existing = this.searches.get(candidate.id);
      if (existing?.status === 'results' && existing.results[0]) {
        this.stageProvider(candidate.id, existing.results[0], false);
        continue;
      }
      try {
        stageDirectCandidate(candidate, this.corrections.get(candidate.id));
        if (
          candidate.addressText?.trim()
          && !['maps_url', 'caption_llm'].includes(candidate.evidenceType)
        ) {
          this.stageDirect(candidate.id, false);
          continue;
        }
      } catch {
        // A provider-only candidate intentionally falls through to map search.
      }
      if (!candidateSearchQuery(candidate)) continue;
      const stop = await this.executeSearch(candidate, candidateSearchQuery(candidate));
      if (stop) {
        new Notice(
          stop === 'credit'
            ? 'Map search credits are unavailable. You can still use direct addresses.'
            : 'Map search paused due to a rate limit. Try again shortly.',
        );
        break;
      }
      const first = this.searches.get(candidate.id)?.results[0];
      if (first) this.stageProvider(candidate.id, first, false);
    }
  }

  private providerSearchRequest(
    candidate: PlaceCandidate,
    query: string,
    provider = this.provider,
  ): ProviderSearchRequest {
    const candidateContext = {
      archiveId: this.options.archiveId,
      candidateId: candidate.id,
    };
    return provider === 'kakaomap'
      ? { provider, query, page: 1, size: PROVIDER_RESULT_LIMIT, candidateContext }
      : {
        provider,
        query,
        size: PROVIDER_RESULT_LIMIT,
        languageCode: this.options.hostLocale,
        candidateContext,
      };
  }

  private async executeSearch(
    candidate: PlaceCandidate,
    requestedQuery: string,
    provider = this.provider,
  ): Promise<'rate' | 'credit' | null> {
    const query = requestedQuery.trim().slice(0, 100);
    if (!query) {
      this.searches.set(candidate.id, { provider, query: '', status: 'idle', results: [] });
      return null;
    }
    this.searches.set(candidate.id, { provider, query, status: 'loading', results: [] });
    this.persistReviewCache();
    this.render();
    try {
      const response = await this.options.searchProvider(
        this.providerSearchRequest(candidate, query, provider),
      );
      const results = response.provider === provider
        ? response.results.slice(0, PROVIDER_RESULT_LIMIT)
        : [];
      this.searches.set(candidate.id, {
        provider,
        query,
        status: results.length > 0 ? 'results' : 'empty',
        results,
      });
      return null;
    } catch (error) {
      const stop = placeSearchStopReason(error);
      this.searches.set(candidate.id, {
        provider,
        query,
        status: stop ? 'rate-limited' : 'error',
        results: [],
        errorMessage: error instanceof Error ? error.message : 'Could not search places.',
      });
      return stop;
    } finally {
      this.persistReviewCache();
      this.render();
    }
  }

  private async searchRow(candidateId: string, query: string): Promise<void> {
    if (this.busy) return;
    const candidate = this.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    const stop = await this.executeSearch(candidate, query);
    if (stop) {
      new Notice(stop === 'credit' ? 'Map search credits are unavailable.' : 'Map search is rate limited.');
    }
  }

  private setProvider(provider: MapSearchProvider): void {
    if (this.providerAvailability[provider] === false || this.busy || this.preparing) return;
    this.provider = provider;
    for (const candidate of this.candidates) {
      if (this.staged.has(candidate.id)) continue;
      this.searches.set(candidate.id, {
        provider,
        query: this.searches.get(candidate.id)?.query ?? candidateSearchQuery(candidate),
        status: 'idle',
        results: [],
      });
    }
    this.persistReviewCache();
    this.render();
  }

  private stageDirect(candidateId: string, rerender = true): void {
    const candidate = this.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    const match = stageDirectCandidate(candidate, this.corrections.get(candidateId));
    if (!match.displayAddress.trim()) return;
    this.staged.set(candidateId, match);
    if (match.placeKindIntent && !this.placeKindIntents.has(candidateId)) {
      this.placeKindIntents.set(candidateId, match.placeKindIntent);
    }
    this.suppressedAutoIds.delete(candidateId);
    this.searches.delete(candidateId);
    this.liveMessage = `${this.staged.size} ready to add.`;
    this.persistReviewCache();
    if (rerender) this.render();
  }

  private stageProvider(
    candidateId: string,
    result: ProviderSearchCandidate,
    rerender = true,
  ): void {
    const candidate = this.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    const query = this.searches.get(candidateId)?.query ?? candidateSearchQuery(candidate);
    const match = stageProviderCandidate(result, candidate, query);
    this.staged.set(candidateId, match);
    if (match.placeKindIntent && !this.placeKindIntents.has(candidateId)) {
      this.placeKindIntents.set(candidateId, match.placeKindIntent);
    }
    this.suppressedAutoIds.delete(candidateId);
    this.searches.delete(candidateId);
    this.liveMessage = `${this.staged.size} ready to add.`;
    this.persistReviewCache();
    if (rerender) this.render();
  }

  private clearStage(candidateId: string): void {
    if (this.busy) return;
    const candidate = this.candidates.find(item => item.id === candidateId);
    const match = this.staged.get(candidateId);
    this.staged.delete(candidateId);
    this.suppressedAutoIds.add(candidateId);
    if (candidate) {
      this.searches.set(candidateId, {
        provider: this.provider,
        query: match?.displayName || candidateSearchQuery(candidate),
        status: 'idle',
        results: [],
      });
    }
    this.liveMessage = 'Match removed. Search again or use the archived address.';
    this.persistReviewCache();
    this.render();
  }

  private setPlaceKind(candidateId: string, placeKind: PlaceKind | null): void {
    const intent: PlaceKindIntent = { placeKind, mode: 'override' };
    this.placeKindIntents.set(candidateId, intent);
    const match = this.staged.get(candidateId);
    if (match) this.staged.set(candidateId, { ...match, placeKindIntent: intent });
    this.persistReviewCache();
    this.render();
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
    this.stageDirect(candidateId);
  }

  private openPicker(
    candidate: PlaceCandidate,
    initialView: CandidatePlacePickerRequest['initialView'],
    button: HTMLButtonElement,
  ): void {
    this.options.openPlacePicker({
      candidate,
      initialView,
      ...(this.contextNoteIntents.get(candidate.id) ? { contextNoteIntent: 'save' as const } : {}),
      ...(this.placeKindIntents.get(candidate.id)
        ? { placeKindIntent: this.placeKindIntents.get(candidate.id) }
        : {}),
      onAttached: result => this.reconcile(result),
      onClosed: () => {
        window.requestAnimationFrame(() => button.focus());
      },
    });
  }

  private async attachReadyInBackground(): Promise<void> {
    if (this.busy || this.staged.size === 0) return;
    const entries = this.candidates.flatMap((candidate) => {
      const match = this.staged.get(candidate.id);
      return match ? [[candidate, match] as const] : [];
    });
    if (entries.length === 0) return;
    this.busy = true;
    this.liveMessage = `Adding ${entries.length} places in the background…`;
    this.persistReviewCache();
    new Notice(`Adding ${entries.length} ${entries.length === 1 ? 'place' : 'places'}…`);
    this.close();

    const results: PlaceCandidateAttachmentResult[] = [];
    let requestFailures = 0;
    let noteWarning = false;
    const record = (result: PlaceCandidateAttachmentResult): void => {
      results.push(result);
      for (const outcome of result.outcomes) {
        if (!this.contextNoteIntents.get(outcome.candidateId)) continue;
        if (!['applied', 'queued'].includes(outcome.contextNote?.status ?? '')) noteWarning = true;
      }
    };
    const directEntries = entries.filter(
      (entry): entry is readonly [PlaceCandidate, Extract<StagedCandidateMatch, { kind: 'direct' }>] =>
        entry[1].kind === 'direct',
    );
    const providerEntries = entries.filter(
      (entry): entry is readonly [PlaceCandidate, StagedProviderCandidate] =>
        entry[1].kind === 'provider',
    );

    await Promise.all([
      (async (): Promise<void> => {
        for (let index = 0; index < directEntries.length; index += DIRECT_ATTACH_BATCH_SIZE) {
          const chunk = directEntries.slice(index, index + DIRECT_ATTACH_BATCH_SIZE);
          try {
            record(await this.options.attachBatch({
              idempotencyKey: `candidate-batch:${crypto.randomUUID()}`,
              candidates: chunk.map(([candidate, match]) => ({
                ...buildDirectCandidateAttachment(candidate, this.corrections.get(candidate.id)),
                ...(this.contextNoteIntents.get(candidate.id)
                  ? { contextNoteIntent: 'save' as const }
                  : {}),
                ...(this.placeKindIntents.get(candidate.id) ?? match.placeKindIntent
                  ? { placeKindIntent: this.placeKindIntents.get(candidate.id) ?? match.placeKindIntent }
                  : {}),
              })),
            }));
          } catch {
            requestFailures += chunk.length;
          }
        }
      })(),
      runWithConcurrency(providerEntries, PROVIDER_ATTACH_CONCURRENCY, async ([candidate, match]) => {
        try {
          record(await this.attachProviderCandidate(candidate, match));
        } catch {
          requestFailures += 1;
        }
      }),
    ]);

    let remaining: readonly PlaceCandidate[];
    try {
      remaining = orderPlaceCandidates(await this.options.onBackgroundCommitted(results));
    } catch {
      remaining = orderPlaceCandidates(await this.options.refetchCandidates().catch(() => this.candidates));
      requestFailures += 1;
    }
    const selectedIds = new Set(entries.map(([candidate]) => candidate.id));
    const selectedPending = remaining.filter(candidate => selectedIds.has(candidate.id)).length;
    const added = entries.length - selectedPending;
    this.candidates = remaining;
    this.pruneReviewState();
    this.busy = false;
    if (remaining.length === 0) {
      clearPlaceCandidateReviewCache(this.options.archiveId);
    } else {
      this.persistReviewCache();
    }
    if (added === entries.length) {
      new Notice(
        noteWarning
          ? `${added} places added. Some place notes need another review.`
          : `${added} ${added === 1 ? 'place' : 'places'} added.`,
      );
    } else if (added > 0) {
      new Notice(`${added} places added. ${selectedPending} still need review.`);
    } else {
      new Notice(
        requestFailures > 0
          ? `Could not add ${entries.length} places. Reopen the review to try again.`
          : 'No places were added.',
      );
    }
  }

  private async attachProviderCandidate(
    candidate: PlaceCandidate,
    match: StagedProviderCandidate,
  ): Promise<PlaceCandidateAttachmentResult> {
    const attach = async (selectionToken: string): Promise<PlaceCandidateAttachmentResult> => (
      this.options.attachProvider(candidate.id, {
        idempotencyKey: `candidate-provider:${crypto.randomUUID()}`,
        selectionToken,
        ...(this.contextNoteIntents.get(candidate.id)
          ? { contextNoteIntent: 'save' as const }
          : {}),
        ...(this.placeKindIntents.get(candidate.id) ?? match.placeKindIntent
          ? { placeKindIntent: this.placeKindIntents.get(candidate.id) ?? match.placeKindIntent }
          : {}),
      })
    );
    const initialToken = await this.currentSelectionToken(candidate, match);
    if (!initialToken) throw new Error('The saved map match expired.');
    try {
      return await attach(initialToken);
    } catch (error) {
      const code = error instanceof Error
        ? (error as Error & { readonly code?: string }).code
        : undefined;
      if (code !== 'EXPIRED_SELECTION_TOKEN') throw error;
      const refreshed = await this.refreshSelectionToken(candidate, match);
      if (!refreshed) throw error;
      return attach(refreshed);
    }
  }

  private async currentSelectionToken(
    candidate: PlaceCandidate,
    match: StagedProviderCandidate,
  ): Promise<string | null> {
    if (Date.now() - match.matchedAt <= SELECTION_TOKEN_SAFE_AGE_MS) return match.selectionToken;
    return this.refreshSelectionToken(candidate, match);
  }

  private async refreshSelectionToken(
    candidate: PlaceCandidate,
    match: StagedProviderCandidate,
  ): Promise<string | null> {
    await this.executeSearch(candidate, match.query, match.provider);
    const search = this.searches.get(candidate.id);
    const samePlace = search?.status === 'results'
      ? search.results.find(result => result.externalId === match.externalId)
      : undefined;
    if (!samePlace) return null;
    const refreshed = stageProviderCandidate(samePlace, candidate, search?.query ?? match.query);
    this.staged.set(candidate.id, refreshed);
    this.persistReviewCache();
    return refreshed.selectionToken;
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
    this.pruneReviewState();
    this.busy = false;
    if (this.candidates.length === 0) {
      clearPlaceCandidateReviewCache(this.options.archiveId);
      this.close();
      new Notice('Place added.');
      return;
    }
    this.persistReviewCache();
    this.liveMessage = this.candidates.length === 1
      ? '1 place remains.'
      : `${this.candidates.length} places remain.`;
    this.render();
  }

  private async dismissOne(candidateId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.options.rejectCandidate(candidateId);
      this.candidates = this.candidates.filter(candidate => candidate.id !== candidateId);
      this.staged.delete(candidateId);
      this.searches.delete(candidateId);
      this.suppressedAutoIds.delete(candidateId);
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
      await Promise.all(this.candidates.map(candidate => this.options.rejectCandidate(candidate.id)));
      this.candidates = [];
      this.staged.clear();
      this.searches.clear();
      clearPlaceCandidateReviewCache(this.options.archiveId);
      await this.finishDismiss('All place candidates were dismissed.');
      this.close();
    } catch (error) {
      await this.recoverOrReport(error, 'dismiss all places');
    }
  }

  private async finishDismiss(message: string): Promise<void> {
    this.busy = false;
    this.liveMessage = message;
    this.persistReviewCache();
    await this.options.onCandidatesChanged(this.candidates, null);
    this.render();
  }

  private async recoverOrReport(error: unknown, action: string): Promise<void> {
    this.busy = false;
    if (isStaleCandidateError(error)) {
      this.candidates = orderPlaceCandidates(await this.options.refetchCandidates());
      this.reconcileCandidateState();
      this.pruneReviewState();
      this.liveMessage = 'Place candidates changed elsewhere. The current list is shown.';
      await this.options.onCandidatesChanged(this.candidates, null);
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.liveMessage = `Could not ${action}. ${message}`;
      new Notice(this.liveMessage);
    }
    this.persistReviewCache();
    this.render();
  }

  private async runExtraction(): Promise<void> {
    if (this.busy || this.extracting || !this.options.onExtract) return;
    this.extractController = new AbortController();
    this.extracting = true;
    this.busy = true;
    this.liveMessage = 'Analyzing for places…';
    this.render();
    try {
      const outcome = await this.options.onExtract(this.extractController.signal, {
        includeOcr: this.includeOcr,
        includeComments: this.includeComments,
        executionPreference: this.executionPreference,
      });
      this.candidates = orderPlaceCandidates(outcome.candidates);
      this.reconcileCandidateState();
      this.pruneReviewState();
      this.liveMessage = outcome.message;
      this.preparing = true;
      await this.resolveCandidatesAutomatically();
    } catch (error) {
      this.liveMessage = error instanceof Error && error.message
        ? `Could not analyze for places. ${error.message}`
        : 'Could not analyze for places.';
    } finally {
      this.extracting = false;
      this.busy = false;
      this.preparing = false;
      this.extractController = null;
      this.persistReviewCache();
      this.render();
    }
  }

  applyExtractionResult(candidates: readonly PlaceCandidate[]): void {
    if (this.extracting) return;
    this.candidates = orderPlaceCandidates(candidates);
    this.reconcileCandidateState();
    this.pruneReviewState();
    this.liveMessage = this.candidates.length === 0
      ? 'No places found in this post.'
      : 'Place suggestions updated.';
    this.render();
    if (this.isOpen && !this.recoverySession) {
      this.preparing = true;
      void this.resolveCandidatesAutomatically().finally(() => {
        this.preparing = false;
        this.persistReviewCache();
        this.render();
      });
    }
  }

  private pruneReviewState(): void {
    const presentIds = new Set(this.candidates.map(candidate => candidate.id));
    for (const candidateId of this.staged.keys()) {
      if (!presentIds.has(candidateId)) this.staged.delete(candidateId);
    }
    for (const candidateId of this.searches.keys()) {
      if (!presentIds.has(candidateId)) this.searches.delete(candidateId);
    }
    for (const candidateId of this.contextNoteIntents.keys()) {
      if (!presentIds.has(candidateId)) this.contextNoteIntents.delete(candidateId);
    }
    for (const candidateId of this.placeKindIntents.keys()) {
      if (!presentIds.has(candidateId)) this.placeKindIntents.delete(candidateId);
    }
    for (const candidateId of this.suppressedAutoIds) {
      if (!presentIds.has(candidateId)) this.suppressedAutoIds.delete(candidateId);
    }
  }

  private reconcileCandidateState(): void {
    this.pruneReviewState();
    for (const candidate of this.candidates) {
      if (!this.contextNoteIntents.has(candidate.id)) {
        this.contextNoteIntents.set(
          candidate.id,
          candidate.contextScope === 'candidate'
            && Boolean(candidate.contextText)
            && ['recommended', 'visited', 'venue', 'route_stop'].includes(candidate.role ?? ''),
        );
      }
      if (this.placeKindIntents.has(candidate.id)) continue;
      const placeKind = candidate.suggestedPlaceKind
        ?? inferPlaceKindFromText([
          candidate.name,
          candidate.evidenceText,
          candidate.contextText,
        ].filter(Boolean).join(' '))?.placeKind
        ?? null;
      if (placeKind) this.placeKindIntents.set(candidate.id, { placeKind, mode: 'suggest' });
    }
  }

  private async loadContextNoteProposals(): Promise<void> {
    if (!this.options.loadContextNoteProposals || this.recoveryLoading) return;
    this.recoveryLoading = true;
    try {
      this.contextNoteProposals = await this.options.loadContextNoteProposals();
      for (const proposal of this.contextNoteProposals) {
        if (
          (proposal.status === 'eligible' || proposal.status === 'blocked_capacity')
          && !this.recoveryIntents.has(proposal.candidateId)
        ) {
          this.recoveryIntents.set(proposal.candidateId, proposal.defaultOn);
        }
      }
    } catch {
      this.contextNoteProposals = [];
    } finally {
      this.recoveryLoading = false;
      this.render();
    }
  }

  private renderContextNoteRecovery(): void {
    if (!this.recoverySession) return;
    const proposals = this.contextNoteProposals.filter(
      proposal => proposal.status === 'eligible' || proposal.status === 'blocked_capacity',
    );
    if (proposals.length === 0) return;
    const section = this.contentEl.createDiv({ cls: 'sa-place-context-recovery' });
    section.createEl('h3', {
      text: `${proposals.length} existing place ${proposals.length === 1 ? 'description is' : 'descriptions are'} ready to save`,
    });
    section.createEl('p', {
      text: 'These exact excerpts came from the archived post. Review each one before saving.',
    });
    for (const proposal of proposals) {
      const label = section.createEl('label');
      const input = label.createEl('input', { type: 'checkbox' });
      input.checked = this.recoveryIntents.get(proposal.candidateId) === true;
      input.disabled = this.recoverySaving || proposal.status === 'blocked_capacity';
      input.addEventListener('change', () => {
        this.recoveryIntents.set(proposal.candidateId, input.checked);
      });
      const copy = label.createSpan();
      copy.createEl('strong', { text: proposal.locationName });
      copy.createEl('small', { text: proposal.contextText });
    }
    const save = section.createEl('button', {
      text: this.recoverySaving ? 'Saving place notes…' : 'Finish place-note review',
      cls: 'mod-cta',
    });
    save.disabled = this.recoverySaving;
    save.addEventListener('click', () => void this.saveContextNoteProposals());
  }

  private async saveContextNoteProposals(): Promise<void> {
    const decideContextNote = this.options.decideContextNote;
    if (!decideContextNote || this.recoverySaving) return;
    const proposals = this.contextNoteProposals.filter(
      proposal => proposal.status === 'eligible' || proposal.status === 'blocked_capacity',
    );
    if (proposals.length === 0) return;
    this.recoverySaving = true;
    this.render();
    const settled = await Promise.allSettled(proposals.map(proposal =>
      decideContextNote(
        proposal.candidateId,
        proposal.status === 'blocked_capacity'
          ? 'save'
          : this.recoveryIntents.get(proposal.candidateId) ? 'save' : 'skip',
      ),
    ));
    const decided = new Map<string, PlaceContextNoteProposal>();
    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value) {
        decided.set(item.value.proposal.candidateId, item.value.proposal);
      }
    }
    this.contextNoteProposals = this.contextNoteProposals.map(
      proposal => decided.get(proposal.candidateId) ?? proposal,
    );
    this.recoverySaving = false;
    this.render();
    new Notice(
      settled.some(item =>
        item.status === 'rejected'
          || !['applied', 'skipped', 'queued'].includes(item.value?.proposal.status ?? '')
      )
        ? 'Some place notes could not be saved. Try again.'
        : 'Place-note review completed.',
    );
  }

  private maybeFocusExtractCta(): void {
    if (this.hasFocusedExtractCta || !this.options.focusExtractCta || !this.options.onExtract) return;
    if (this.busy || this.extracting) return;
    const cta = this.contentEl.querySelector<HTMLButtonElement>('[data-extract-cta]');
    if (!cta || cta.disabled) return;
    this.hasFocusedExtractCta = true;
    cta.focus();
  }

  private focus(selector: string): void {
    this.contentEl.querySelector<HTMLElement>(selector)?.focus();
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current !== undefined) await task(current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}
