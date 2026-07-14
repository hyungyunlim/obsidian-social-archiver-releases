/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/map-place-links.ts
 * Generated: 2026-07-13T15:16:05.364Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

import { getMapPlaceProviderPriority } from './map-place-policy';
import {
  getMapProviderWebLink,
  type MapPlaceTarget,
  type MapProviderWebLink,
} from './map-places';

export function getMapProviderWebLinks(target: MapPlaceTarget): MapProviderWebLink[] {
  return getMapPlaceProviderPriority(target).flatMap((provider) => {
    const link = getMapProviderWebLink(provider, target);
    return link ? [link] : [];
  });
}
