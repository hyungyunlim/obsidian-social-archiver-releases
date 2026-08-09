import { Modal, Notice, type App } from 'obsidian';
import type { MapSearchProvider } from '@/shared/platforms/map-search-provider';
import {
  resolveMapSearchProvider,
} from '@/shared/platforms/map-search-provider';
import { buildExactMapPlaceUrl } from '@/shared/platforms/map-places';
import type { ProviderSearchCandidate } from '@/types/place-search';
import { resolveCloudCreditQuota } from '@/services/CloudCreditUsage';
import type { ArchivePlacePickerApi } from './archivePlacePickerModel';
import { ArchiveProviderSearchPanel } from './ArchiveProviderSearchPanel';

/**
 * Search for a place and archive it on its own.
 *
 * The flow this fills in: every other route to a place ATTACHES one to a host
 * archive, so a place could only exist as a property of a post. Saving a place
 * you simply want to remember meant finding its map URL by hand and pasting it
 * into the archive modal.
 *
 * ## Why this creates a full archive rather than a metadata-only place
 *
 * `metadata_only` is not a lightweight place — it is a location riding on a
 * host archive, and the tier exists so that tagging your own post with a place
 * costs neither a credit nor a provider round trip. A standalone place has no
 * host, so a metadata-only one would be a note containing a name and a pair of
 * coordinates and nothing else: everything a place card actually shows (rating,
 * category, hours, photos, links) comes from the provider fetch, which IS the
 * detail step. `promote` exists to turn metadata into detail, and creating
 * standalone places at the metadata tier would just mean everyone promotes
 * immediately.
 *
 * So this hands the candidate's canonical map URL to the normal archive path —
 * the same thing pasting that URL does, because `place.map.kakao.com/{id}` and
 * friends already resolve to their own platforms. It costs a credit, like any
 * archive, and the button says so rather than hiding it.
 *
 * Single Responsibility: turn a place search selection into an archive request.
 * The search UI itself is `ArchiveProviderSearchPanel`, shared with the picker.
 */

export interface AddPlaceModalOptions {
  readonly api: ArchivePlacePickerApi;
  readonly hostLocale: string;
  /**
   * Archive the place at this URL. Straight to the pipeline, NOT through the
   * archive modal: picking a result here is already the decision, and that modal
   * would ask again under the title "Archive social post", offering comments and
   * video-download choices that mean nothing for a map place.
   */
  readonly archivePlace: (url: string) => void;
}

/**
 * The canonical map URL for a search result.
 *
 * Built rather than read off the candidate: only Kakao results carry a
 * `placeUrl`. A Google result has just an `externalId` and a selection token, so
 * reading a field found nothing and every Google pick reported "no map link".
 *
 * `buildExactMapPlaceUrl` is the same helper the rest of the plugin uses to mint
 * these, so an archive created here is identical to one created from a pasted
 * link — and it validates the id against the provider's pattern, so a malformed
 * result yields null instead of an un-archivable URL.
 */
export function candidateUrl(
  candidate: ProviderSearchCandidate,
  languageCode?: string,
): string | null {
  return buildExactMapPlaceUrl({
    name: candidate.provider === 'kakaomap' ? candidate.name : candidate.displayName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    locationSource: candidate.provider,
    locationExternalId: candidate.externalId,
  }, { ...(languageCode ? { languageCode } : {}) });
}

export class AddPlaceModal extends Modal {
  private panel: ArchiveProviderSearchPanel | null = null;
  private body: HTMLElement | null = null;
  private provider: MapSearchProvider = 'kakaomap';
  private availability: Readonly<Record<MapSearchProvider, boolean>> = {
    kakaomap: false,
    googlemaps: false,
  };
  private remaining: number | null = null;
  /** Guards the settings load against a modal closed while it was in flight. */
  private requestVersion = 0;

  constructor(app: App, private readonly options: AddPlaceModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('social-archiver-modal', 'sa-place-picker-modal');
    this.contentEl.addClass('sa-place-picker');
    this.titleEl.setText('Add a place');
    this.contentEl.createEl('p', {
      cls: 'sa-place-picker-description',
      text: 'Search a map provider and save the place as its own archive.',
    });

    this.body = this.contentEl.createDiv({ cls: 'sa-place-picker-panel' });
    void this.loadSettings();
  }

  onClose(): void {
    this.requestVersion += 1;
    this.panel = null;
    this.body = null;
    this.contentEl.empty();
  }

  /**
   * Which providers are usable, and how much cloud search quota is left — the
   * same pair the attach picker resolves, so both surfaces agree on which
   * provider a search defaults to.
   */
  private async loadSettings(): Promise<void> {
    const version = ++this.requestVersion;
    this.body?.createEl('p', {
      cls: 'sa-place-picker-status',
      text: 'Loading place search settings…',
    });

    const [preferences, usage] = await Promise.allSettled([
      this.options.api.getArchivePreferences(),
      this.options.api.getUserUsage(),
    ]);
    if (version !== this.requestVersion || !this.body) return;

    this.availability = preferences.status === 'fulfilled'
      ? preferences.value.mapSearchProviderAvailability
      : { kakaomap: false, googlemaps: false };
    this.remaining = usage.status === 'fulfilled'
      ? resolveCloudCreditQuota(usage.value)?.remaining ?? null
      : null;

    const resolution = resolveMapSearchProvider(
      preferences.status === 'fulfilled' ? preferences.value.mapSearchProvider : 'auto',
      this.options.hostLocale,
      this.availability,
    );
    this.showProvider(resolution.provider);
  }

  private showProvider(provider: MapSearchProvider): void {
    const body = this.body;
    if (!body) return;
    this.provider = provider;
    body.empty();

    this.panel = new ArchiveProviderSearchPanel({
      root: body,
      provider,
      hostLocale: this.options.hostLocale,
      initialRemaining: this.remaining,
      availability: this.availability,
      api: this.options.api,
      allowManual: true,
      onSelect: (candidate) => this.archive(candidate),
      onProvider: (next) => this.showProvider(next),
      // The manual entry IS this flow's fallback, so it hands the URL straight
      // to the same place the search result does.
      onManual: () => this.showManualEntry(),
    });
  }

  private archive(candidate: ProviderSearchCandidate): void {
    const url = candidateUrl(candidate, this.options.hostLocale);
    if (!url) {
      // A candidate with no canonical URL cannot be archived, and silently
      // closing would look like the pick did nothing.
      new Notice('That result has no map link to archive.');
      return;
    }
    this.close();
    this.options.archivePlace(url);
  }

  private showManualEntry(): void {
    const body = this.body;
    if (!body) return;
    body.empty();
    this.panel = null;

    body.createEl('p', {
      cls: 'sa-place-picker-description',
      text: 'Paste a map link for the place you want to save.',
    });

    const row = body.createDiv({ cls: 'sa-place-picker-search-row' });
    const input = row.createEl('input', {
      cls: 'sa-place-picker-search-input',
      attr: { type: 'text', placeholder: 'Map URL', 'aria-label': 'Map URL' },
    });
    const submit = row.createEl('button', { text: 'Add' });
    submit.type = 'button';

    const commit = (): void => {
      const url = input.value.trim();
      if (!url) return;
      this.close();
      this.options.archivePlace(url);
    };
    submit.addEventListener('click', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });

    const back = body.createEl('button', {
      cls: 'sa-place-picker-manual-action',
      text: 'Search instead',
    });
    back.type = 'button';
    back.addEventListener('click', () => this.showProvider(this.provider));

    input.focus();
  }
}
