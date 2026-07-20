import { Notice, type App } from 'obsidian';
import type {
  ArchiveLocation,
  PlaceCandidateAttachmentResult,
  ProviderSearchCandidateContext,
} from '@/services/WorkersAPIClient';
import type { MapSearchProvider } from '@/shared/platforms/map-search-provider';
import {
  confirmGetPlaceDetails,
  dedupeExistingPlaceArchives,
  getArchivePlacePickerError,
  resolveManualMapInput,
  type ArchivePlacePickerApi,
  type ArchivePlacePickerChange,
  type ExistingPlaceOption,
} from './archivePlacePickerModel';

type LocalPanelOptions = {
  readonly panel: HTMLElement;
  readonly app: App;
  readonly archiveId: string;
  readonly api: ArchivePlacePickerApi;
  readonly onClose: () => void;
  readonly onChanged: (change: ArchivePlacePickerChange) => void | Promise<void>;
  readonly candidateContext?: ProviderSearchCandidateContext;
  readonly onCandidateAttached?: (
    result: PlaceCandidateAttachmentResult,
  ) => void | Promise<void>;
};

export class ArchivePlaceLocalPanel {
  private readonly options: LocalPanelOptions;
  private version = 0;
  private busy = false;
  private pendingExistingRequest: {
    readonly intent: string;
    readonly idempotencyKey: string;
  } | null = null;

  constructor(options: LocalPanelOptions) {
    this.options = options;
  }

  dispose(): void {
    this.version += 1;
  }

  async showExisting(attachedPlaceKeys: ReadonlySet<string> = new Set()): Promise<void> {
    const version = ++this.version;
    this.options.panel.empty();
    this.options.panel.createEl('p', {
      text: 'Loading saved places…', cls: 'sa-place-picker-status',
    });
    try {
      const archives = [];
      let offset = 0;
      for (;;) {
        // Only dedicated map-place archives qualify as existing places
        // (toExistingPlaceOption), and every verified place has one (the P2
        // provider flow always creates the place card before linking). The
        // server-side platforms filter turns what was a full-library
        // full-row scan — minutes of sequential pages on a large vault,
        // indistinguishable from a hang — into one small query.
        const page = await this.options.api.getUserArchives({
          limit: 100,
          offset,
          platforms: ['googlemaps', 'navermap', 'kakaomap'],
        });
        archives.push(...page.archives);
        offset += page.archives.length;
        if (!page.hasMore || page.archives.length === 0) break;
      }
      if (version !== this.version) return;
      this.renderExisting(dedupeExistingPlaceArchives(archives), attachedPlaceKeys);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (version === this.version) this.renderStatus(getArchivePlacePickerError(error, 'load'));
    }
  }

  showManual(provider: MapSearchProvider, archiveMapsUrl: (url: string) => void): void {
    this.version += 1;
    const panel = this.options.panel;
    panel.empty();
    const label = panel.createEl('label', {
      text: `Paste a ${provider === 'googlemaps' ? 'Google Maps' : 'Kakao Maps'} URL or Place ID`,
      cls: 'sa-place-picker-status',
    });
    const input = panel.createEl('input', {
      type: 'text', cls: 'sa-place-picker-manual-input',
      attr: {
        id: 'sa-place-picker-manual-input',
        placeholder: 'Map URL or place ID',
        autocomplete: 'off',
        'aria-describedby': 'sa-place-picker-manual-status',
      },
    });
    label.htmlFor = input.id;
    const status = panel.createEl('p', {
      cls: 'sa-place-picker-status',
      attr: { id: 'sa-place-picker-manual-status', 'aria-live': 'polite' },
    });
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      status.removeClass('mod-error');
      status.setText('');
    });
    const submit = panel.createEl('button', {
      text: 'Continue to archive', cls: 'sa-place-picker-manual-submit',
    });
    submit.type = 'button';
    submit.addEventListener('click', () => {
      const url = resolveManualMapInput(provider, input.value);
      if (!url) {
        status.setText('Enter a valid URL or place ID for the selected provider.');
        status.addClass('mod-error');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      archiveMapsUrl(url);
      this.options.onClose();
    });
    input.focus();
  }

  private renderExisting(
    places: readonly ExistingPlaceOption[],
    attachedPlaceKeys: ReadonlySet<string>,
  ): void {
    const panel = this.options.panel;
    panel.empty();
    if (places.length === 0) {
      panel.createEl('p', { text: 'No saved places yet', cls: 'sa-place-picker-status' });
    }
    for (const place of places) {
      const button = panel.createEl('button', { cls: 'sa-place-picker-result' });
      button.type = 'button';
      button.createEl('strong', { text: place.name, cls: 'sa-place-picker-result-name' });
      button.createEl('span', {
        text: [place.provider, place.category, place.address].filter(Boolean).join(' · '),
        cls: 'sa-place-picker-result-meta',
      });
      // Already attached to this post: show as done, not tappable. Matched by
      // placeKey (both sides derive `${source}:${externalId}`).
      if (attachedPlaceKeys.has(place.placeKey)) {
        button.disabled = true;
        button.addClass('is-added');
        button.setAttribute('aria-disabled', 'true');
        button.createEl('span', { text: '✓ added', cls: 'sa-place-picker-result-added' });
        continue;
      }
      button.addEventListener('click', () => void this.attachExisting(place, button));
    }
  }

  private async attachExisting(
    place: ExistingPlaceOption,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    this.options.panel.querySelector('.sa-place-picker-status.mod-error')?.remove();
    try {
      if (this.options.candidateContext) {
        const intent = JSON.stringify([
          this.options.candidateContext.candidateId,
          place.archiveId,
          place.placeKey,
        ]);
        const request = this.pendingExistingRequest?.intent === intent
          ? this.pendingExistingRequest
          : { intent, idempotencyKey: `candidate-existing:${crypto.randomUUID()}` };
        this.pendingExistingRequest = request;
        const response = await this.options.api.attachPlaceCandidateFromExisting(
          this.options.candidateContext.candidateId,
          {
            idempotencyKey: request.idempotencyKey,
            representativeArchiveId: place.archiveId,
            placeKey: place.placeKey,
          },
        );
        await this.options.onCandidateAttached?.(response);
        this.pendingExistingRequest = null;
        this.options.onClose();
        return;
      }
      const response = await this.options.api.attachExistingLocation(
        this.options.archiveId,
        place.archiveId,
        place.placeKey,
        `existing:${this.options.archiveId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      );
      this.options.onClose();
      this.showMetadataAttachedNotice(response.location);
      void Promise.resolve(this.options.onChanged({
        location: response.location,
        enrichment: 'not_requested',
      }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.busy = false;
      button.disabled = false;
      this.options.panel.createEl('p', {
        text: getArchivePlacePickerError(error, 'selection'),
        cls: 'sa-place-picker-status mod-error',
      });
    }
  }

  private showMetadataAttachedNotice(location: ArchiveLocation): void {
    const content = document.createDocumentFragment();
    content.append(`Added ${location.name} as metadata only. `);
    const promote = document.createElement('button');
    promote.type = 'button';
    promote.textContent = 'Get details';
    promote.addEventListener('click', () => void this.promote(location.id, promote));
    content.append(promote);
    new Notice(content, 8_000);
  }

  private async promote(locationId: string, button: HTMLButtonElement): Promise<void> {
    // Disable synchronously BEFORE awaiting the confirm — a disabled button
    // won't dispatch a second click, so a rapid double-tap can't stack two
    // confirms and mint two place archives (this path has no mutex). Re-enable
    // if the user backs out.
    if (button.disabled) return;
    button.disabled = true;
    if (!(await confirmGetPlaceDetails(this.options.app))) {
      button.disabled = false;
      return;
    }
    try {
      const result = await this.options.api.promoteArchiveLocation(
        this.options.archiveId,
        locationId,
        `promote:${this.options.archiveId}:${locationId}:${Date.now()}`,
      );
      await Promise.resolve(this.options.onChanged(result));
      new Notice('Fetching place details…');
    } catch (error) {
      button.disabled = false;
      new Notice(getArchivePlacePickerError(error, 'selection'));
    }
  }

  private renderStatus(message: string): void {
    this.options.panel.empty();
    this.options.panel.createEl('p', { text: message, cls: 'sa-place-picker-status mod-error' });
  }
}
