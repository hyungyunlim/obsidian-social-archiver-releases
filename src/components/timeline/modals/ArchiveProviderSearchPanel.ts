import type {
  ProviderSearchCandidate,
  ProviderSearchCandidateContext,
  ProviderSearchRequest,
  ProviderSearchResponse,
} from '@/services/WorkersAPIClient';
import type { MapSearchProvider } from '@/shared/platforms/map-search-provider';
import {
  getArchivePlacePickerError,
  getProviderCandidateMetadata,
  getProviderCandidateName,
  type ArchivePlacePickerApi,
} from './archivePlacePickerModel';

export type ProviderSearchSnapshot = {
  readonly provider: MapSearchProvider;
  readonly query: string;
  readonly results: readonly ProviderSearchCandidate[];
  readonly attribution: ProviderSearchResponse['attribution'] | null;
  readonly nextPage: string | number | null;
  readonly remaining: number | null;
};

type SearchPanelOptions = {
  readonly root: HTMLElement;
  readonly provider: MapSearchProvider;
  readonly hostLocale: string;
  readonly initialRemaining: number | null;
  readonly availability: Readonly<Record<MapSearchProvider, boolean>>;
  readonly api: ArchivePlacePickerApi;
  readonly candidateContext?: ProviderSearchCandidateContext;
  readonly allowManual?: boolean;
  readonly recovery?: {
    readonly snapshot: ProviderSearchSnapshot;
    readonly errorMessage: string;
    readonly onRetry: () => void;
  };
  readonly onSelect: (candidate: ProviderSearchCandidate, snapshot: ProviderSearchSnapshot) => void;
  readonly onProvider: (provider: MapSearchProvider) => void;
  readonly onManual: () => void;
};

export class ArchiveProviderSearchPanel {
  private readonly options: SearchPanelOptions;
  private readonly results: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly providerSelect: HTMLSelectElement;
  private readonly submit: HTMLButtonElement;
  private readonly creditStatus: HTMLParagraphElement | null;
  private loadMore: HTMLButtonElement | null = null;
  private inFlight = false;
  private requestVersion = 0;
  private snapshot: ProviderSearchSnapshot;

  constructor(options: SearchPanelOptions) {
    this.options = options;
    this.snapshot = options.recovery?.snapshot ?? {
      provider: options.provider,
      query: '',
      results: [],
      attribution: null,
      nextPage: options.provider === 'kakaomap' ? 1 : null,
      remaining: options.initialRemaining,
    };
    const form = options.root.createDiv({ cls: 'sa-place-picker-search' });
    const providerLabel = options.provider === 'googlemaps' ? 'Google Maps' : 'Kakao Maps';
    const label = form.createEl('label', { text: `Search places on ${providerLabel}` });
    label.addClass('sa-place-picker-sr-only');
    label.htmlFor = 'sa-place-picker-search-input';
    const row = form.createDiv({ cls: 'sa-place-picker-search-row' });
    this.providerSelect = row.createEl('select', {
      cls: 'sa-place-picker-provider-select',
      attr: { 'aria-label': 'Map search provider' },
    });
    for (const provider of ['kakaomap', 'googlemaps'] as const) {
      const option = this.providerSelect.createEl('option', {
        text: provider === 'googlemaps' ? 'Google Maps' : 'Kakao Map',
        attr: { value: provider },
      });
      option.disabled = !options.availability[provider];
    }
    this.providerSelect.value = options.provider;
    row.createSpan({ cls: 'sa-place-picker-search-divider', attr: { 'aria-hidden': 'true' } });
    this.input = row.createEl('input', {
      type: 'search',
      cls: 'sa-place-picker-search-input',
      attr: { id: 'sa-place-picker-search-input', placeholder: 'Place name or address', autocomplete: 'off' },
    });
    this.input.value = this.snapshot.query;
    this.submit = row.createEl('button', { text: 'Search' });
    this.submit.type = 'button';
    const available = options.availability[options.provider];
    this.creditStatus = options.provider === 'googlemaps' && available
      ? form.createEl('p', {
        text: this.creditLabel(this.snapshot.remaining),
        cls: 'sa-place-picker-status sa-place-picker-credit',
      })
      : null;
    this.results = options.root.createDiv({ cls: 'sa-place-picker-results', attr: { 'aria-live': 'polite' } });
    this.providerSelect.addEventListener('change', () => {
      const provider = this.providerSelect.value;
      if (provider !== 'kakaomap' && provider !== 'googlemaps') return;
      this.options.onProvider(provider);
    });
    this.submit.addEventListener('click', () => void this.search(false));
    this.input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.search(false);
    });
    if (!available) this.renderUnavailable();
    else if (options.recovery) this.renderError(options.recovery.errorMessage, options.recovery.onRetry);
    else if (this.snapshot.results.length > 0) this.renderResults();
    else this.renderManualAction();
    this.setInFlight(false);
    if (available) this.input.focus();
    else this.results.querySelector<HTMLButtonElement>('button')?.focus();
  }

  dispose(): void {
    this.requestVersion += 1;
  }

  private async search(append: boolean): Promise<void> {
    if (this.inFlight || !this.options.availability[this.options.provider]) return;
    const query = this.input.value.trim();
    if (!query) {
      this.input.focus();
      return;
    }
    const version = ++this.requestVersion;
    this.setInFlight(true);
    this.results.empty();
    this.results.createEl('p', { text: 'Searching places…', cls: 'sa-place-picker-status' });
    try {
      const response = await this.options.api.searchProviderPlaces(
        this.buildRequest(query, append),
      );
      if (version !== this.requestVersion || response.provider !== this.options.provider) return;
      const previous = append && this.snapshot.query === query ? this.snapshot.results : [];
      this.snapshot = {
        provider: response.provider,
        query,
        results: [...previous, ...response.results],
        attribution: response.attribution,
        nextPage: response.provider === 'googlemaps'
          ? response.pagination.nextCursor ?? null
          : response.isEnd ? null : response.page + 1,
        remaining: response.provider === 'googlemaps'
          ? response.cloudCredit.remaining
          : this.snapshot.remaining,
      };
      this.updateCreditStatus();
      this.renderResults();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (version !== this.requestVersion) return;
      this.renderError(getArchivePlacePickerError(error, 'search'));
    } finally {
      if (version === this.requestVersion) this.setInFlight(false);
    }
  }

  private buildRequest(query: string, append: boolean): ProviderSearchRequest {
    const candidateContext = this.options.candidateContext;
    if (this.options.provider === 'kakaomap') {
      return {
        provider: 'kakaomap' as const,
        query,
        page: append && typeof this.snapshot.nextPage === 'number' ? this.snapshot.nextPage : 1,
        size: 15,
        ...(candidateContext ? { candidateContext } : {}),
      };
    }
    return {
      provider: 'googlemaps' as const,
      query,
      size: 5,
      languageCode: this.options.hostLocale,
      ...(candidateContext ? { candidateContext } : {}),
      ...(append && typeof this.snapshot.nextPage === 'string'
        ? { nextCursor: this.snapshot.nextPage }
        : {}),
    };
  }

  private renderResults(): void {
    this.results.empty();
    this.loadMore = null;
    if (this.snapshot.results.length === 0) {
      this.results.createEl('p', { text: 'No places found', cls: 'sa-place-picker-status' });
    }
    for (const candidate of this.snapshot.results) {
      const button = this.results.createEl('button', { cls: 'sa-place-picker-result' });
      button.type = 'button';
      button.createEl('strong', {
        text: getProviderCandidateName(candidate), cls: 'sa-place-picker-result-name',
      });
      button.createEl('span', {
        text: getProviderCandidateMetadata(candidate), cls: 'sa-place-picker-result-meta',
      });
      button.addEventListener('click', () => this.options.onSelect(candidate, this.snapshot));
    }
    if (this.snapshot.attribution) {
      this.results.createEl('a', {
        text: this.snapshot.attribution.label,
        href: this.snapshot.attribution.url,
        cls: 'sa-place-picker-attribution',
        attr: { target: '_blank', rel: 'noopener noreferrer' },
      });
    }
    if (this.snapshot.nextPage !== null) {
      this.loadMore = this.results.createEl('button', {
        text: this.options.provider === 'googlemaps' ? 'Load more (1 Cloud credit)' : 'Load more',
        cls: 'sa-place-picker-load-more',
      });
      this.loadMore.type = 'button';
      this.loadMore.disabled = this.inFlight;
      this.loadMore.addEventListener('click', () => void this.search(true));
    }
    this.renderManualAction();
  }

  private renderManualAction(): void {
    if (this.options.allowManual === false) return;
    const manual = this.results.createEl('button', {
      text: 'Use a map URL or place ID instead',
      cls: 'sa-place-picker-manual-action',
    });
    manual.type = 'button';
    manual.addEventListener('click', this.options.onManual);
  }

  private renderUnavailable(): void {
    this.results.empty();
    const providerLabel = this.options.provider === 'googlemaps' ? 'Google Maps' : 'Kakao Maps';
    const otherProvider: MapSearchProvider = this.options.provider === 'googlemaps'
      ? 'kakaomap'
      : 'googlemaps';
    this.results.createEl('p', {
      text: this.options.allowManual === false
        ? `${providerLabel} search is unavailable. Choose an available provider or a saved place.`
        : this.options.availability[otherProvider]
          ? `${providerLabel} search is unavailable. Choose another provider or use a map URL.`
          : `${providerLabel} search is unavailable. Use a map URL or Place ID.`,
      cls: 'sa-place-picker-status mod-error',
    });
    const row = this.results.createDiv({ cls: 'sa-place-picker-recovery' });
    if (this.options.availability[otherProvider]) {
      const provider = row.createEl('button', {
        text: `Use ${otherProvider === 'googlemaps' ? 'Google' : 'Kakao'}`,
      });
      provider.type = 'button';
      provider.addEventListener('click', () => this.options.onProvider(otherProvider));
    }
    if (this.options.allowManual !== false) {
      const manual = row.createEl('button', { text: 'Use URL or place ID' });
      manual.type = 'button';
      manual.addEventListener('click', this.options.onManual);
    }
  }

  private renderError(message: string, retrySelection?: () => void): void {
    if (this.snapshot.results.length > 0) this.renderResults();
    else this.results.empty();
    const error = this.results.createEl('p', {
      text: message, cls: 'sa-place-picker-status mod-error',
    });
    this.results.prepend(error);
    const row = this.results.createDiv({ cls: 'sa-place-picker-recovery' });
    error.after(row);
    const retry = row.createEl('button', { text: retrySelection ? 'Retry linking' : 'Retry' });
    retry.type = 'button';
    retry.addEventListener('click', retrySelection ?? ((): void => void this.search(false)));
    if (this.options.allowManual !== false) {
      const manual = row.createEl('button', { text: 'Use URL or place ID' });
      manual.type = 'button';
      manual.addEventListener('click', this.options.onManual);
    }
  }

  private creditLabel(remaining: number | null): string {
    return `1 Cloud credit per page · ${remaining === null ? 'balance unavailable' : `${remaining} remaining`}`;
  }

  private updateCreditStatus(): void {
    this.creditStatus?.setText(this.creditLabel(this.snapshot.remaining));
  }

  private setInFlight(inFlight: boolean): void {
    this.inFlight = inFlight;
    const searchDisabled = inFlight || !this.options.availability[this.options.provider];
    this.input.disabled = searchDisabled;
    this.submit.disabled = searchDisabled;
    if (this.loadMore) this.loadMore.disabled = inFlight;
  }
}
