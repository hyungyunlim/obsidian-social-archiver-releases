import { Modal, Notice, type App } from 'obsidian';
import type { ArchiveLocation, ProviderSearchCandidate } from '@/services/WorkersAPIClient';
import { resolveCloudCreditQuota } from '@/services/CloudCreditUsage';
import {
  resolveMapSearchProvider,
  type MapSearchProvider,
} from '@/shared/platforms/map-search-provider';
import {
  confirmGetPlaceDetails,
  getArchivePlacePickerError,
  isCandidatePlacePicker,
  type ArchivePlacePickerApi,
  type ArchivePlacePickerChange,
  type ArchivePlacePickerOptions,
} from './archivePlacePickerModel';
import {
  ArchiveProviderSearchPanel,
  type ProviderSearchSnapshot,
} from './ArchiveProviderSearchPanel';
import {
  createArchivePlacePickerTabs,
  type ArchivePlacePickerTabs,
  type ArchivePlacePickerView,
} from './archivePlacePickerTabs';
import {
  beginProviderSelection,
  completeProviderSelection,
  isProviderSelectionCurrent,
  type ProviderSelectionAuthority,
} from './archivePlacePickerSelectionAuthority';
import { ArchivePlaceLocalPanel } from './ArchivePlaceLocalPanel';

export { dedupeExistingPlaceArchives, getArchivePlacePickerError } from './archivePlacePickerModel';
export type { ArchivePlacePickerApi, ArchivePlacePickerChange } from './archivePlacePickerModel';

type PendingSelection = {
  readonly candidate: ProviderSearchCandidate;
  readonly authority: ProviderSelectionAuthority;
  readonly snapshot: ProviderSearchSnapshot;
  readonly errorMessage: string | null;
};

export class ArchivePlacePickerModal extends Modal {
  private readonly options: ArchivePlacePickerOptions;
  private panel: HTMLDivElement | null = null;
  private currentPanel: HTMLDivElement | null = null;
  private tabs: ArchivePlacePickerTabs | null = null;
  private activeView: ArchivePlacePickerView = 'existing';
  private manualProvider: MapSearchProvider = 'googlemaps';
  private searchPanel: ArchiveProviderSearchPanel | null = null;
  private localPanel: ArchivePlaceLocalPanel | null = null;
  private pendingSelection: PendingSelection | null = null;
  private requestVersion = 0;
  private busy = false;
  private attachedPlaceKeys: ReadonlySet<string> = new Set();
  private cloudCreditRemaining: number | null = null;
  private providerAvailability: Readonly<Record<MapSearchProvider, boolean>> = {
    kakaomap: false,
    googlemaps: false,
  };
  private candidateAttached = false;
  private candidateCloseReported = false;

  constructor(app: App, options: ArchivePlacePickerOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass('social-archiver-modal', 'sa-place-picker-modal');
    this.contentEl.addClass('sa-place-picker');
    this.contentEl.createEl('h2', { text: 'Link a place', cls: 'sa-place-picker-title' });
    const candidateMode = isCandidatePlacePicker(this.options);
    this.contentEl.createEl('p', {
      text: candidateMode
        ? 'Choose a provider result or saved place for this candidate.'
        : 'Manage every location on this post or add another from a map provider.',
      cls: 'sa-place-picker-description',
    });
    if (!candidateMode) {
      this.currentPanel = this.contentEl.createDiv({ cls: 'sa-place-picker-current' });
      void this.loadCurrentLocations();
    }
    this.contentEl.createEl('h3', { text: 'Add a place', cls: 'sa-place-picker-add-heading' });
    this.tabs = createArchivePlacePickerTabs(this.contentEl, view => this.switchView(view));
    this.panel = this.contentEl.createDiv({ cls: 'sa-place-picker-panel' });
    this.panel.id = 'sa-place-picker-panel';
    this.panel.setAttribute('role', 'tabpanel');
    this.localPanel = new ArchivePlaceLocalPanel({
      panel: this.panel,
      app: this.app,
      archiveId: this.options.archiveId,
      api: this.options.api,
      onClose: (): void => this.close(),
      onChanged: (change): void => { void this.publishArchiveChange(change); },
      ...(candidateMode ? {
        candidateContext: this.options.candidateContext,
        onCandidateAttached: (result): void => { void this.publishCandidateAttachment(result); },
      } : {}),
    });
    this.scope.register([], 'Escape', () => this.close());

    const recovery = this.pendingSelection;
    if (recovery?.errorMessage) {
      this.manualProvider = recovery.candidate.provider;
      this.activate('search');
      this.showProvider(recovery.candidate.provider, {
        candidate: recovery.candidate,
        snapshot: recovery.snapshot,
        errorMessage: recovery.errorMessage,
      });
      return;
    }
    if (candidateMode && this.options.initialView === 'existing') {
      this.activate('existing');
      void this.localPanel.showExisting();
    } else {
      void this.initializeDefaultView();
    }
  }

  onClose(): void {
    this.requestVersion += 1;
    this.searchPanel?.dispose();
    this.localPanel?.dispose();
    this.searchPanel = null;
    this.localPanel = null;
    this.currentPanel = null;
    this.contentEl.empty();
    if (isCandidatePlacePicker(this.options)
      && !this.busy
      && !this.candidateAttached
      && !this.candidateCloseReported) {
      this.candidateCloseReported = true;
      this.options.onClosed();
    }
  }

  private async initializeDefaultView(): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    const version = ++this.requestVersion;
    panel.empty();
    panel.createEl('p', { text: 'Loading place search settings…', cls: 'sa-place-picker-status' });
    const [preferences, usage] = await Promise.allSettled([
      this.options.api.getArchivePreferences(),
      this.options.api.getUserUsage(),
    ]);
    if (version !== this.requestVersion || !this.panel) return;
    const preference = preferences.status === 'fulfilled'
      ? preferences.value.mapSearchProvider
      : 'auto';
    this.providerAvailability = preferences.status === 'fulfilled'
      ? preferences.value.mapSearchProviderAvailability
      : { kakaomap: false, googlemaps: false };
    this.cloudCreditRemaining = usage.status === 'fulfilled'
      ? resolveCloudCreditQuota(usage.value)?.remaining ?? null
      : null;
    const resolution = resolveMapSearchProvider(
      preference,
      this.options.hostLocale,
      this.providerAvailability,
    );
    this.manualProvider = resolution.provider;
    this.activate('search');
    this.showProvider(resolution.provider);
  }

  private switchView(view: ArchivePlacePickerView): void {
    if (this.activeView === view) return;
    this.activate(view);
    if (view === 'existing') void this.localPanel?.showExisting(this.attachedPlaceKeys);
    else this.showProvider(this.manualProvider);
  }

  private activate(view: ArchivePlacePickerView): void {
    this.searchPanel?.dispose();
    this.searchPanel = null;
    this.activeView = view;
    this.requestVersion += 1;
    this.tabs?.setActive(view);
    this.panel?.setAttribute('aria-labelledby', `sa-place-picker-tab-${view}`);
  }

  private showProvider(
    provider: MapSearchProvider,
    recovery?: {
      readonly candidate: ProviderSearchCandidate;
      readonly snapshot: ProviderSearchSnapshot;
      readonly errorMessage: string;
    },
  ): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    this.searchPanel = new ArchiveProviderSearchPanel({
      root: panel,
      provider,
      hostLocale: this.options.hostLocale,
      initialRemaining: this.cloudCreditRemaining,
      availability: this.providerAvailability,
      api: this.options.api,
      ...(isCandidatePlacePicker(this.options)
        ? { candidateContext: this.options.candidateContext, allowManual: false }
        : {}),
      ...(recovery ? {
        recovery: {
          snapshot: recovery.snapshot,
          errorMessage: recovery.errorMessage,
          onRetry: (): void => void this.selectProvider(recovery.candidate, recovery.snapshot),
        },
      } : {}),
      onSelect: (candidate, snapshot): void => void this.selectProvider(candidate, snapshot),
      onProvider: (nextProvider): void => {
        this.manualProvider = nextProvider;
        this.activate('search');
        this.showProvider(nextProvider);
      },
      onManual: (): void => this.showManual(),
    });
  }

  private showManual(): void {
    if (isCandidatePlacePicker(this.options)) return;
    this.activate('search');
    this.localPanel?.showManual(this.manualProvider, this.options.archiveMapsUrl);
  }

  private async selectProvider(
    candidate: ProviderSearchCandidate,
    snapshot: ProviderSearchSnapshot,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const candidateId = isCandidatePlacePicker(this.options)
      ? this.options.candidateContext.candidateId
      : null;
    const authority = beginProviderSelection(
      this.options.archiveId,
      candidate.provider,
      candidate.externalId,
      candidateId,
    );
    const selection = {
      candidate,
      authority,
      snapshot,
      errorMessage: null,
    } satisfies PendingSelection;
    this.pendingSelection = selection;
    this.close();
    try {
      if (isCandidatePlacePicker(this.options)) {
        const response = await this.options.api.attachPlaceCandidateFromProvider(
          this.options.candidateContext.candidateId,
          {
            selectionToken: candidate.selectionToken,
            idempotencyKey: authority.idempotencyKey,
          },
        );
        if (!this.completeSelection(selection)) return;
        await this.publishCandidateAttachment(response);
      } else {
        const response = await this.options.api.attachProviderLocation(
          this.options.archiveId,
          candidate.selectionToken,
          authority.idempotencyKey,
        );
        if (!this.completeSelection(selection)) return;
        this.showMetadataAttachedNotice(response.location);
        void Promise.resolve(this.options.onChanged({
          location: response.location,
          enrichment: 'not_requested',
        }));
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (this.pendingSelection !== selection || !isProviderSelectionCurrent(this.options.archiveId, authority)) return;
      this.busy = false;
      const errorMessage = getArchivePlacePickerError(error, 'selection');
      this.pendingSelection = { ...selection, errorMessage };
      new Notice(errorMessage);
      this.open();
    }
  }

  private async loadCurrentLocations(): Promise<void> {
    const currentPanel = this.currentPanel;
    if (!currentPanel) return;
    currentPanel.empty();
    currentPanel.createEl('p', { text: 'Loading current locations…', cls: 'sa-place-picker-status' });
    try {
      const locations = await this.options.api.getArchiveLocations(this.options.archiveId);
      if (this.currentPanel !== currentPanel) return;
      this.renderCurrentLocations(locations);
    } catch (error) {
      if (this.currentPanel !== currentPanel) return;
      currentPanel.empty();
      currentPanel.createEl('p', {
        text: getArchivePlacePickerError(error, 'load'),
        cls: 'sa-place-picker-status mod-error',
      });
      const retry = currentPanel.createEl('button', { text: 'Retry loading locations' });
      retry.type = 'button';
      retry.addEventListener('click', () => void this.loadCurrentLocations());
    }
  }

  private renderCurrentLocations(locations: readonly ArchiveLocation[]): void {
    const panel = this.currentPanel;
    if (!panel) return;
    panel.empty();
    // PlaceKeys attached here drive the Existing list's "Added" state.
    this.attachedPlaceKeys = new Set(locations.map(location => location.placeKey));
    panel.createEl('h3', { text: `Current locations (${locations.length})` });
    if (locations.length === 0) {
      panel.createEl('p', { text: 'No locations attached yet.', cls: 'sa-place-picker-status' });
      return;
    }
    for (const location of locations) {
      const row = panel.createDiv({ cls: 'sa-place-picker-current-row' });
      const details = row.createDiv({ cls: 'sa-place-picker-current-details' });
      details.createEl('strong', { text: location.name });
      details.createEl('span', {
        text: [
          location.isPrimary ? 'Primary' : null,
          location.address,
          this.promotionLabel(location.promotionStatus),
        ].filter(Boolean).join(' · '),
      });
      const actions = row.createDiv({ cls: 'sa-place-picker-current-actions' });
      if (!location.isPrimary) {
        const primary = actions.createEl('button', { text: 'Make primary' });
        primary.type = 'button';
        primary.addEventListener('click', () => void this.makePrimary(location));
      }
      if (location.promotionStatus === 'metadata_only' || location.promotionStatus === 'archive_failed') {
        const promote = actions.createEl('button', { text: 'Get details' });
        promote.type = 'button';
        promote.addEventListener('click', () => void this.promote(location));
      }
      const remove = actions.createEl('button', { text: 'Remove' });
      remove.type = 'button';
      remove.addEventListener('click', () => void this.remove(location));
    }
  }

  private promotionLabel(status: ArchiveLocation['promotionStatus']): string {
    if (status === 'archived') return 'Details archived';
    if (status === 'archiving') return 'Archiving details';
    if (status === 'archive_failed') return 'Detail archive failed';
    return 'Location only';
  }

  private async makePrimary(location: ArchiveLocation): Promise<void> {
    if (!this.lockCurrentMutations()) return;
    try {
      const updated = await this.options.api.patchArchiveLocation(
        this.options.archiveId,
        location.id,
        { isPrimary: true },
      );
      await Promise.resolve(this.publishArchiveChange({
        location: updated,
        enrichment: 'not_requested',
      }));
      await this.loadCurrentLocations();
    } catch (error) {
      new Notice(getArchivePlacePickerError(error, 'selection'));
    } finally {
      this.unlockCurrentMutations();
    }
  }

  private async remove(location: ArchiveLocation): Promise<void> {
    if (!this.lockCurrentMutations()) return;
    try {
      await this.options.api.deleteArchiveLocation(this.options.archiveId, location.id);
      await Promise.resolve(this.publishArchiveChange({
        locationId: location.id,
        enrichment: 'removed',
      }));
      await this.loadCurrentLocations();
      new Notice('Location removed.');
    } catch (error) {
      new Notice(getArchivePlacePickerError(error, 'detach'));
    } finally {
      this.unlockCurrentMutations();
    }
  }

  private async promote(location: ArchiveLocation): Promise<void> {
    if (this.busy) return;
    if (!(await confirmGetPlaceDetails(this.app))) return;
    if (!this.lockCurrentMutations()) return;
    try {
      const result = await this.options.api.promoteArchiveLocation(
        this.options.archiveId,
        location.id,
        `promote:${this.options.archiveId}:${location.id}:${Date.now()}`,
      );
      await Promise.resolve(this.publishArchiveChange(result));
      await this.loadCurrentLocations();
      new Notice('Fetching place details…');
    } catch (error) {
      new Notice(getArchivePlacePickerError(error, 'selection'));
    } finally {
      this.unlockCurrentMutations();
    }
  }

  private lockCurrentMutations(): boolean {
    if (this.busy) return false;
    this.busy = true;
    this.currentPanel?.querySelectorAll('button').forEach(button => { button.disabled = true; });
    return true;
  }

  private unlockCurrentMutations(): void {
    this.busy = false;
    this.currentPanel?.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }

  private completeSelection(selection: PendingSelection): boolean {
    const current = completeProviderSelection(this.options.archiveId, selection.authority);
    if (this.pendingSelection === selection) this.pendingSelection = null;
    this.busy = false;
    return current;
  }

  private publishArchiveChange(
    change: ArchivePlacePickerChange,
  ): void | Promise<void> {
    if (!isCandidatePlacePicker(this.options)) return this.options.onChanged(change);
  }

  private async publishCandidateAttachment(
    result: Awaited<ReturnType<ArchivePlacePickerApi['attachPlaceCandidateFromProvider']>>,
  ): Promise<void> {
    if (!isCandidatePlacePicker(this.options)) return;
    await this.options.onCandidateAttached(result);
    this.candidateAttached = true;
  }

  private showMetadataAttachedNotice(location: ArchiveLocation): void {
    const content = document.createDocumentFragment();
    content.append(`Added ${location.name} as metadata only. `);
    const promote = document.createElement('button');
    promote.type = 'button';
    promote.textContent = 'Get details';
    promote.addEventListener('click', () => void this.promote(location));
    content.append(promote);
    new Notice(content, 8_000);
  }

}
