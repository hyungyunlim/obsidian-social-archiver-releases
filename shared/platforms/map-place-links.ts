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
