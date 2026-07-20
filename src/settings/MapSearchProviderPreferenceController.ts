import {
  resolveMapSearchProvider,
  type MapSearchProvider,
  type MapSearchProviderPreference,
  type MapSearchProviderResolution,
} from '../shared/platforms/map-search-provider';

type ArchivePreferencesApi = {
  getArchivePreferences(): Promise<{
    readonly mapSearchProvider: MapSearchProviderPreference;
    readonly mapSearchProviderAvailability: Readonly<Record<MapSearchProvider, boolean>>;
  }>;
  updateArchivePreferences(
    patch: { readonly mapSearchProvider: MapSearchProviderPreference },
  ): Promise<{
    readonly mapSearchProvider: MapSearchProviderPreference;
    readonly mapSearchProviderAvailability: Readonly<Record<MapSearchProvider, boolean>>;
  }>;
};

export type MapSearchProviderSettingState = MapSearchProviderResolution & {
  readonly preference: MapSearchProviderPreference;
};

export class MapSearchProviderSaveError extends Error {
  readonly previousPreference: MapSearchProviderPreference;

  constructor(previousPreference: MapSearchProviderPreference, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Failed to save map search provider');
    this.name = 'MapSearchProviderSaveError';
    this.previousPreference = previousPreference;
    this.cause = cause;
  }
}

export class MapSearchProviderPreferenceController {
  private readonly api: ArchivePreferencesApi;
  private readonly getLocale: () => string | null | undefined;
  private preference: MapSearchProviderPreference = 'auto';
  private availability: Readonly<Record<MapSearchProvider, boolean>> = {
    kakaomap: false,
    googlemaps: false,
  };

  constructor(api: ArchivePreferencesApi, getLocale: () => string | null | undefined) {
    this.api = api;
    this.getLocale = getLocale;
  }

  get current(): MapSearchProviderPreference {
    return this.preference;
  }

  async load(): Promise<MapSearchProviderSettingState> {
    const preferences = await this.api.getArchivePreferences();
    this.preference = preferences.mapSearchProvider;
    this.availability = preferences.mapSearchProviderAvailability;
    return this.resolve();
  }

  async save(preference: MapSearchProviderPreference): Promise<MapSearchProviderSettingState> {
    const previousPreference = this.preference;
    this.preference = preference;
    try {
      const preferences = await this.api.updateArchivePreferences({ mapSearchProvider: preference });
      this.preference = preferences.mapSearchProvider;
      this.availability = preferences.mapSearchProviderAvailability;
      return this.resolve();
    } catch (error) {
      this.preference = previousPreference;
      throw new MapSearchProviderSaveError(previousPreference, error);
    }
  }

  private resolve(): MapSearchProviderSettingState {
    return {
      preference: this.preference,
      ...resolveMapSearchProvider(this.preference, this.getLocale(), this.availability),
    };
  }
}
