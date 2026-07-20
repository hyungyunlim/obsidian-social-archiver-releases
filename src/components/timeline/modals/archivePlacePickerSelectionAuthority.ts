import type { MapSearchProvider } from '@/shared/platforms/map-search-provider';

export type ProviderSelectionAuthority = {
  readonly identity: string;
  readonly idempotencyKey: string;
  readonly generation: number;
};

const authorities = new Map<string, ProviderSelectionAuthority>();

export function beginProviderSelection(
  archiveId: string,
  provider: MapSearchProvider,
  externalId: string,
  candidateId: string | null,
): ProviderSelectionAuthority {
  const identity = candidateId === null
    ? `${provider}:${externalId}`
    : `candidate:${JSON.stringify([candidateId, provider, externalId])}`;
  const current = authorities.get(archiveId);
  const authority = {
    identity,
    idempotencyKey: current?.identity === identity
      ? current.idempotencyKey
      : `place-select:${crypto.randomUUID()}`,
    generation: current?.identity === identity ? current.generation + 1 : 1,
  };
  authorities.set(archiveId, authority);
  return authority;
}

export function isProviderSelectionCurrent(
  archiveId: string,
  authority: ProviderSelectionAuthority,
): boolean {
  const current = authorities.get(archiveId);
  return current?.identity === authority.identity
    && current.idempotencyKey === authority.idempotencyKey
    && current.generation === authority.generation;
}

export function completeProviderSelection(
  archiveId: string,
  authority: ProviderSelectionAuthority,
): boolean {
  if (!isProviderSelectionCurrent(archiveId, authority)) return false;
  authorities.delete(archiveId);
  return true;
}
