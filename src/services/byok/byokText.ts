/**
 * User-facing BYOK text derived from core data: the engine label and
 * localized provider errors. Engines are named by provider, never "local".
 */
import { t } from '../../i18n';
import { BYOK_PROVIDERS, ByokError, type ByokProviderId } from '../../vendor/byok-ai-core';

/** "OpenAI (my key)" / "OpenAI (내 키)". */
export function byokEngineLabel(provider: ByokProviderId): string {
  return t('byok.engineLabel', { provider: BYOK_PROVIDERS[provider].label });
}

/** A ByokError as one sentence for a Notice; anything else as its message. */
export function byokErrorMessage(error: unknown, provider?: ByokProviderId): string {
  if (!(error instanceof ByokError)) return error instanceof Error ? error.message : String(error);
  const id = error.provider ?? provider;
  const label = id ? BYOK_PROVIDERS[id].label : 'AI provider';
  const vars = { provider: label };
  switch (error.code) {
    case 'invalid_key':
      return t('byok.error.invalidKey', vars);
    case 'insufficient_credit':
      return t('byok.error.insufficientCredit', vars);
    case 'rate_limited':
      return error.retryAfterSeconds
        ? t('byok.error.rateLimitedRetry', { ...vars, seconds: error.retryAfterSeconds })
        : t('byok.error.rateLimited', vars);
    case 'model_not_found':
      return t('byok.error.modelNotFound', vars);
    case 'region_blocked':
      return t('byok.error.regionBlocked', vars);
    case 'content_blocked':
      return t('byok.error.contentBlocked', vars);
    case 'context_too_long':
      return t('byok.error.contextTooLong', vars);
    case 'provider_unavailable':
      return t('byok.error.unavailable', vars);
    case 'network':
      return error.hint === 'invalid_key_maybe' ? t('byok.error.networkKeyHint', vars) : t('byok.error.network', vars);
    case 'cancelled':
      return t('byok.error.cancelled', vars);
    case 'unknown':
      return t('byok.error.unknown', { ...vars, message: error.message });
  }
}
