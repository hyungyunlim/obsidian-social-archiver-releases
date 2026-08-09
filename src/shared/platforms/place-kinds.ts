/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/place-kinds.ts
 * Generated: 2026-08-09T01:16:17.434Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * User-authored place classification.
 *
 * This is intentionally separate from provider categories. Provider categories
 * are descriptive metadata; placeKind is the stable, cross-client icon choice.
 */
export const PLACE_KINDS = [
  'restaurant',
  'cafe',
  'bakery',
  'bar',
  'hospital',
  'pharmacy',
  'fitness',
  'kids',
  'hotel',
  'culture',
  'outdoor',
  'shopping',
  'transit',
  'education',
  'public',
] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_KIND_SUGGESTION_CAPABILITY = 'place-kind-suggestion-v1' as const;

export type PlaceKindSuggestionConfidence = 'high' | 'medium' | 'low';

/**
 * Optional classification carried while a place candidate is being reviewed.
 * `suggest` fills an empty canonical type without replacing an existing one;
 * `override` represents an explicit user choice and may replace or clear it.
 */
export type PlaceKindIntent = {
  readonly placeKind: PlaceKind | null;
  readonly mode: 'suggest' | 'override';
};

export type PlaceKindSuggestion = {
  readonly placeKind: PlaceKind;
  readonly confidence: PlaceKindSuggestionConfidence;
  readonly source: 'provider' | 'ai';
};

export type ProviderPlaceKindInput = {
  readonly provider: 'kakaomap' | 'googlemaps';
  readonly name?: string | null;
  readonly categoryName?: string | null;
  readonly categoryGroupCode?: string | null;
  readonly categoryGroupName?: string | null;
  readonly primaryType?: string | null;
};
/** Rounded-square surface drawn behind every mobile map place glyph. */
export const PLACE_KIND_MAP_TILE_IMAGE_ID = 'place-kind-tile' as const;
export const DEFAULT_PLACE_KIND_MAP_IMAGE_ID = 'place-kind-default' as const;
export type PlaceKindMapImageId =
  | typeof DEFAULT_PLACE_KIND_MAP_IMAGE_ID
  | `place-kind-${PlaceKind}`;

export function isPlaceKind(value: unknown): value is PlaceKind {
  return typeof value === 'string' && (PLACE_KINDS as readonly string[]).includes(value);
}

const GOOGLE_KIND_BY_TYPE: Readonly<Record<string, PlaceKind>> = {
  restaurant: 'restaurant',
  meal_takeaway: 'restaurant',
  meal_delivery: 'restaurant',
  fast_food_restaurant: 'restaurant',
  korean_restaurant: 'restaurant',
  japanese_restaurant: 'restaurant',
  chinese_restaurant: 'restaurant',
  cafe: 'cafe',
  coffee_shop: 'cafe',
  tea_house: 'cafe',
  bakery: 'bakery',
  bar: 'bar',
  pub: 'bar',
  wine_bar: 'bar',
  night_club: 'bar',
  hospital: 'hospital',
  medical_center: 'hospital',
  doctor: 'hospital',
  dental_clinic: 'hospital',
  pharmacy: 'pharmacy',
  gym: 'fitness',
  fitness_center: 'fitness',
  yoga_studio: 'fitness',
  sports_club: 'fitness',
  indoor_playground: 'kids',
  child_care_agency: 'kids',
  hotel: 'hotel',
  lodging: 'hotel',
  resort_hotel: 'hotel',
  motel: 'hotel',
  bed_and_breakfast: 'hotel',
  guest_house: 'hotel',
  museum: 'culture',
  art_gallery: 'culture',
  movie_theater: 'culture',
  performing_arts_theater: 'culture',
  historical_landmark: 'culture',
  cultural_landmark: 'culture',
  tourist_attraction: 'culture',
  park: 'outdoor',
  national_park: 'outdoor',
  hiking_area: 'outdoor',
  beach: 'outdoor',
  campground: 'outdoor',
  shopping_mall: 'shopping',
  store: 'shopping',
  supermarket: 'shopping',
  convenience_store: 'shopping',
  department_store: 'shopping',
  clothing_store: 'shopping',
  market: 'shopping',
  transit_station: 'transit',
  subway_station: 'transit',
  train_station: 'transit',
  bus_station: 'transit',
  airport: 'transit',
  school: 'education',
  university: 'education',
  library: 'education',
  educational_institution: 'education',
  government_office: 'public',
  city_hall: 'public',
  courthouse: 'public',
  police: 'public',
  fire_station: 'public',
  post_office: 'public',
};

const KAKAO_KIND_BY_GROUP: Readonly<Record<string, PlaceKind>> = {
  FD6: 'restaurant',
  CE7: 'cafe',
  HP8: 'hospital',
  PM9: 'pharmacy',
  CT1: 'culture',
  AT4: 'culture',
  AD5: 'hotel',
  MT1: 'shopping',
  CS2: 'shopping',
  SW8: 'transit',
  SC4: 'education',
  AC5: 'education',
  PO3: 'public',
};

const TEXT_KIND_RULES: readonly {
  readonly kind: PlaceKind;
  readonly pattern: RegExp;
}[] = [
  { kind: 'bakery', pattern: /(?:베이커리|제과점|빵집|bakery|patisserie)/iu },
  { kind: 'bar', pattern: /(?:와인바|칵테일바|펍|호프|술집|bar|pub|night\s*club)/iu },
  { kind: 'pharmacy', pattern: /(?:약국|pharmacy|drugstore)/iu },
  { kind: 'hospital', pattern: /(?:병원|의원|클리닉|hospital|medical\s*center|clinic)/iu },
  { kind: 'fitness', pattern: /(?:헬스장|피트니스|필라테스|요가원|gym|fitness|pilates|yoga\s*studio)/iu },
  { kind: 'kids', pattern: /(?:키즈카페|놀이방|어린이집|유치원|kids?\s*cafe|indoor\s*playground)/iu },
  { kind: 'hotel', pattern: /(?:호텔|모텔|펜션|숙소|리조트|게스트하우스|hotel|motel|resort|lodging|guest\s*house)/iu },
  { kind: 'culture', pattern: /(?:박물관|미술관|공연장|극장|문화시설|유적지|museum|gallery|theater|landmark)/iu },
  { kind: 'outdoor', pattern: /(?:공원|해변|캠핑장|산책로|등산로|park|beach|campground|hiking)/iu },
  { kind: 'shopping', pattern: /(?:백화점|쇼핑몰|마트|시장|편집샵|상점|shopping|department\s*store|market)/iu },
  { kind: 'transit', pattern: /(?:공항|지하철역|기차역|버스\s*터미널|airport|subway|train\s*station|bus\s*station)/iu },
  { kind: 'education', pattern: /(?:학교|대학교|도서관|학원|school|university|library|academy)/iu },
  { kind: 'public', pattern: /(?:공공기관|구청|시청|주민센터|우체국|경찰서|government|city\s*hall|post\s*office)/iu },
  { kind: 'cafe', pattern: /(?:카페|커피숍|커피\s*로스터리|cafe|café|coffee\s*shop|tea\s*house)/iu },
  { kind: 'restaurant', pattern: /(?:음식점|식당|레스토랑|맛집|restaurant|diner|eatery)/iu },
];

/**
 * Convert descriptive provider metadata into the stable cross-client kind.
 * Exact provider taxonomies are higher-confidence than text inference.
 */
export function inferPlaceKindFromProvider(
  input: ProviderPlaceKindInput,
): PlaceKindSuggestion | null {
  if (input.provider === 'googlemaps') {
    const primaryType = input.primaryType?.trim().toLowerCase();
    const exactKind = primaryType ? GOOGLE_KIND_BY_TYPE[primaryType] : undefined;
    if (exactKind) return { placeKind: exactKind, confidence: 'high', source: 'provider' };
    const fallbackText = [primaryType?.replaceAll('_', ' '), input.name]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ');
    const placeKind = TEXT_KIND_RULES.find((rule) => rule.pattern.test(fallbackText))?.kind;
    return placeKind ? { placeKind, confidence: 'medium', source: 'provider' } : null;
  }

  const categoryGroupCode = input.categoryGroupCode?.trim().toUpperCase();
  const specificText = [input.categoryName, input.categoryGroupName]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
  const specificKind = TEXT_KIND_RULES.find((rule) => rule.pattern.test(specificText))?.kind;
  const nameKind = TEXT_KIND_RULES.find((rule) => rule.pattern.test(input.name ?? ''))?.kind;
  const placeKind = specificKind
    ?? nameKind
    ?? (categoryGroupCode ? KAKAO_KIND_BY_GROUP[categoryGroupCode] : undefined);
  return placeKind ? { placeKind, confidence: 'high', source: 'provider' } : null;
}

/** Conservative fallback for candidate text when provider metadata is absent. */
export function inferPlaceKindFromText(text: string): PlaceKindSuggestion | null {
  const placeKind = TEXT_KIND_RULES.find((rule) => rule.pattern.test(text))?.kind;
  return placeKind ? { placeKind, confidence: 'medium', source: 'ai' } : null;
}

/** Stable MapLibre image id used by the mobile map symbol layer. */
export function placeKindMapImageId(
  kind?: PlaceKind | null,
): PlaceKindMapImageId {
  return kind ? `place-kind-${kind}` : DEFAULT_PLACE_KIND_MAP_IMAGE_ID;
}
