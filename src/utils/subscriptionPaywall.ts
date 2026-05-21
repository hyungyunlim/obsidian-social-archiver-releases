export const SUBSCRIPTION_PAYWALL_NOTICE_MESSAGE =
  'Profile subscriptions now require Premium. Existing subscriptions remain in your list, but creating or resuming subscriptions requires Premium.';

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

export function isSubscriptionPaywallError(error: unknown): boolean {
  const record = getRecord(error);
  const code = record?.['code'];
  const details = getRecord(record?.['details']);
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';

  return (
    code === 'PAYWALL_REQUIRED' &&
    (
      details?.['reason'] === 'subscription_required' ||
      details?.['feature'] === 'profile_subscriptions' ||
      message.toLowerCase().includes('profile subscriptions require premium')
    )
  );
}
