/* eslint-disable obsidianmd/ui/sentence-case -- Kakao is a proper brand name and must retain capitalization in UI copy. */
import { Modal, Notice, type App } from 'obsidian';
import {
  dedupeExistingPlaceArchives,
  getArchivePlacePickerError,
  type ArchivePlacePickerChange,
  type ArchivePlacePickerOptions,
  type ExistingPlaceOption,
} from './archivePlacePickerModel';
import {
  createArchivePlacePickerTabs,
  type ArchivePlacePickerTabs,
  type ArchivePlacePickerView,
} from './archivePlacePickerTabs';

export { dedupeExistingPlaceArchives, getArchivePlacePickerError } from './archivePlacePickerModel';
export type { ArchivePlacePickerApi, ArchivePlacePickerChange } from './archivePlacePickerModel';

export class ArchivePlacePickerModal extends Modal {
  private readonly options: ArchivePlacePickerOptions;
  private panel: HTMLDivElement | null = null;
  private tabs: ArchivePlacePickerTabs | null = null;
  private activeView: ArchivePlacePickerView = 'existing';
  private requestVersion = 0;
  private searchTimer: number | null = null;
  private busy = false;

  constructor(app: App, options: ArchivePlacePickerOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass('social-archiver-modal', 'sa-place-picker-modal');
    this.contentEl.addClass('sa-place-picker');
    this.contentEl.createEl('h2', { text: 'Link a place', cls: 'sa-place-picker-title' });
    this.contentEl.createEl('p', {
      text: 'Choose a saved place or search Kakao; place details will update in the background',
      cls: 'sa-place-picker-description',
    });
    this.tabs = createArchivePlacePickerTabs(this.contentEl, (view) => this.switchView(view));
    this.panel = this.contentEl.createDiv({ cls: 'sa-place-picker-panel' });
    this.panel.id = 'sa-place-picker-panel';
    this.panel.setAttribute('role', 'tabpanel');
    this.panel.setAttribute('aria-labelledby', 'sa-place-picker-tab-existing');
    this.scope.register([], 'Escape', () => this.close());
    void this.showExisting();
  }

  onClose(): void {
    this.requestVersion += 1;
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.contentEl.empty();
  }

  private switchView(view: ArchivePlacePickerView): void {
    if (this.activeView === view) return;
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.activeView = view;
    this.requestVersion += 1;
    this.tabs?.setActive(view);
    this.panel?.setAttribute('aria-labelledby', `sa-place-picker-tab-${view}`);
    if (view === 'existing') void this.showExisting();
    else this.showSearch();
  }

  private async showExisting(): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    const requestVersion = ++this.requestVersion;
    panel.empty();
    panel.createEl('p', { text: 'Loading saved places…', cls: 'sa-place-picker-status' });
    try {
      const archives = [];
      let offset = 0;
      for (;;) {
        const page = await this.options.api.getUserArchives({ limit: 100, offset });
        archives.push(...page.archives);
        offset += page.archives.length;
        if (!page.hasMore || page.archives.length === 0) break;
      }
      if (requestVersion !== this.requestVersion || this.activeView !== 'existing') return;
      this.renderExisting(dedupeExistingPlaceArchives(archives));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (requestVersion !== this.requestVersion) return;
      this.renderStatus(getArchivePlacePickerError(error, 'load'));
    }
  }

  private renderExisting(places: readonly ExistingPlaceOption[]): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    if (this.options.currentLocation) {
      const detach = panel.createEl('button', {
        text: `Remove ${this.options.currentLocation}`,
        cls: 'sa-place-picker-detach',
      });
      detach.type = 'button';
      detach.addEventListener('click', () => void this.detach(detach));
    }
    if (places.length === 0) {
      panel.createEl('p', {
        text: 'No saved places yet; search Kakao to add one',
        cls: 'sa-place-picker-status',
      });
      return;
    }
    for (const place of places) this.renderExistingPlace(panel, place);
  }

  private renderExistingPlace(parent: HTMLElement, place: ExistingPlaceOption): void {
    const button = parent.createEl('button', { cls: 'sa-place-picker-result' });
    button.type = 'button';
    button.createEl('strong', { text: place.name, cls: 'sa-place-picker-result-name' });
    const facts = [place.provider, place.category, place.address].filter(Boolean).join(' · ');
    button.createEl('span', { text: facts, cls: 'sa-place-picker-result-meta' });
    button.addEventListener('click', () => void this.selectExisting(place.archiveId, button));
  }

  private showSearch(): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    const form = panel.createDiv({ cls: 'sa-place-picker-search' });
    const label = form.createEl('label', { text: 'Search places on Kakao' });
    label.htmlFor = 'sa-place-picker-search-input';
    const row = form.createDiv({ cls: 'sa-place-picker-search-row' });
    const input = row.createEl('input', {
      type: 'search',
      cls: 'sa-place-picker-search-input',
      attr: { id: 'sa-place-picker-search-input', placeholder: 'Place name or address', autocomplete: 'off' },
    });
    const submit = row.createEl('button', { text: 'Search' });
    submit.type = 'button';
    const results = panel.createDiv({ cls: 'sa-place-picker-results', attr: { 'aria-live': 'polite' } });
    const search = (): void => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
      void this.runSearch(input.value, results);
    };
    submit.addEventListener('click', search);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      search();
    });
    input.addEventListener('input', () => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(search, 300);
    });
    input.focus();
  }

  private async runSearch(queryValue: string, results: HTMLElement): Promise<void> {
    const query = queryValue.trim();
    const requestVersion = ++this.requestVersion;
    results.empty();
    if (!query) return;
    results.createEl('p', { text: 'Searching places on Kakao…', cls: 'sa-place-picker-status' });
    try {
      const response = await this.options.api.searchProviderPlaces(query);
      if (requestVersion !== this.requestVersion || this.activeView !== 'search') return;
      results.empty();
      if (response.results.length === 0) {
        results.createEl('p', { text: 'No places found on Kakao', cls: 'sa-place-picker-status' });
      }
      for (const candidate of response.results) {
        const button = results.createEl('button', { cls: 'sa-place-picker-result' });
        button.type = 'button';
        button.createEl('strong', { text: candidate.name, cls: 'sa-place-picker-result-name' });
        const facts = [candidate.categoryGroupName || candidate.categoryName, candidate.roadAddress || candidate.address]
          .filter(Boolean).join(' · ');
        button.createEl('span', { text: facts, cls: 'sa-place-picker-result-meta' });
        button.addEventListener('click', () => void this.selectProvider(candidate.selectionToken, button, results));
      }
      const attribution = results.createEl('a', {
        text: response.attribution.label,
        href: response.attribution.url,
        cls: 'sa-place-picker-attribution',
        attr: { target: '_blank', rel: 'noopener noreferrer' },
      });
      attribution.addEventListener('click', (event) => event.stopPropagation());
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (requestVersion !== this.requestVersion) return;
      results.empty();
      results.createEl('p', { text: getArchivePlacePickerError(error, 'search'), cls: 'sa-place-picker-status mod-error' });
    }
  }

  private async selectProvider(token: string, button: HTMLButtonElement, results: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    try {
      const key = `obsidian:${this.options.archiveId}:${crypto.randomUUID()}`;
      const response = await this.options.api.selectProviderPlace(this.options.archiveId, token, key);
      this.close();
      new Notice('Place linked. Details will update in the background.');
      void Promise.resolve(this.options.onChanged({ targetArchiveId: response.targetArchiveId, enrichment: 'queued' }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.busy = false;
      button.disabled = false;
      results.prepend(Object.assign(document.createElement('p'), {
        className: 'sa-place-picker-status mod-error',
        textContent: getArchivePlacePickerError(error, 'selection'),
      }));
    }
  }

  private async selectExisting(targetArchiveId: string, button: HTMLButtonElement): Promise<void> {
    await this.changeExisting(targetArchiveId, button, 'Place linked');
  }

  private async detach(button: HTMLButtonElement): Promise<void> {
    await this.changeExisting(null, button, 'Place removed');
  }

  private async changeExisting(targetArchiveId: string | null, button: HTMLButtonElement, notice: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    try {
      await this.options.api.setArchivePlace(this.options.archiveId, targetArchiveId);
      this.close();
      new Notice(notice);
      const change: ArchivePlacePickerChange = targetArchiveId
        ? { targetArchiveId, enrichment: 'existing' }
        : { targetArchiveId: null, enrichment: 'not-applicable' };
      void Promise.resolve(this.options.onChanged(change));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.busy = false;
      button.disabled = false;
      this.renderStatus(getArchivePlacePickerError(error, targetArchiveId ? 'selection' : 'detach'));
    }
  }

  private renderStatus(message: string): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    panel.createEl('p', { text: message, cls: 'sa-place-picker-status mod-error' });
  }
}
