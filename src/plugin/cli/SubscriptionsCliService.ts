/**
 * SubscriptionsCliService — thin adapter between Obsidian CLI flag bags and
 * {@link SubscriptionManager}.
 *
 * `subscribe` creates a subscription; nothing in the CLI could see or change one
 * afterwards, so pausing one — or finding out why one stopped producing — meant
 * opening the plugin UI. The manager has had all five operations since
 * subscriptions shipped; only the CLI surface was missing them.
 *
 * Responsibilities (SRP):
 *   - Map `action=list|pause|resume|run|runs|delete` + flags → manager calls.
 *   - Reject a missing/blank `id` before any network call, and require an
 *     explicit `confirm=true` before the one irreversible action.
 *   - Flatten the manager's nested `Subscription` into a flat CLI payload —
 *     an agent reading the result should not have to walk `target.handle`.
 *
 * Does NOT register CLI handlers — that wiring lives in `CliRegistry`.
 */

import {
  CliValidationError,
  parseBool,
  parseEnum,
  parseNumber,
  parseString,
  type CliParams,
} from './CliParams';

/** The slice of SubscriptionManager this service needs (keeps tests light). */
export interface SubscriptionsCliManager {
  getSubscriptions(): Array<{
    id: string;
    name: string;
    platform: string;
    enabled: boolean;
    target: { handle: string; profileUrl: string };
    state: { lastRunAt: string | null };
    updatedAt: string;
  }>;
  updateSubscription(
    id: string,
    updates: { enabled?: boolean },
  ): Promise<{ id: string; name: string; platform: string; enabled: boolean }>;
  deleteSubscription(id: string): Promise<void>;
  triggerManualRun(id: string): Promise<{ id: string; status: string; trigger: string }>;
  getRunHistory(
    id: string,
    limit?: number,
  ): Promise<
    Array<{
      id: string;
      status: string;
      trigger: string;
      startedAt: string;
      completedAt: string | null;
      postsArchived: number;
      creditsUsed: number;
      error?: string;
    }>
  >;
}

export const SUBSCRIPTIONS_ACTIONS = ['list', 'pause', 'resume', 'run', 'runs', 'delete'] as const;
export type SubscriptionsCliAction = (typeof SUBSCRIPTIONS_ACTIONS)[number];

export interface SubscriptionCliSummary {
  subscriptionId: string;
  name: string;
  platform: string;
  handle: string;
  profileUrl: string;
  enabled: boolean;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface SubscriptionsListCliResult {
  subscriptions: SubscriptionCliSummary[];
  total: number;
  /** Split out so "which ones are paused?" needs no client-side filtering. */
  enabledCount: number;
}

export interface SubscriptionToggleCliResult {
  subscriptionId: string;
  name: string;
  platform: string;
  enabled: boolean;
}

export interface SubscriptionRunCliResult {
  subscriptionId: string;
  runId: string;
  status: string;
  trigger: string;
}

export interface SubscriptionRunsCliResult {
  subscriptionId: string;
  runs: Array<{
    runId: string;
    status: string;
    trigger: string;
    startedAt: string;
    completedAt: string | null;
    postsArchived: number;
    creditsUsed: number;
    error?: string;
  }>;
  total: number;
}

export interface SubscriptionDeleteCliResult {
  subscriptionId: string;
  deleted: true;
}

export type SubscriptionsCliResult =
  | SubscriptionsListCliResult
  | SubscriptionToggleCliResult
  | SubscriptionRunCliResult
  | SubscriptionRunsCliResult
  | SubscriptionDeleteCliResult;

export class SubscriptionsCliService {
  constructor(private readonly manager: SubscriptionsCliManager) {}

  /** Drive the `social-archiver:subscriptions` command. */
  async run(params: CliParams): Promise<SubscriptionsCliResult> {
    const action = (parseEnum(params, 'action', SUBSCRIPTIONS_ACTIONS) ??
      'list') as SubscriptionsCliAction;

    if (action === 'list') return this.list();

    const id = this.requireId(params, action);

    if (action === 'pause' || action === 'resume') {
      return this.setEnabled(id, action === 'resume');
    }
    if (action === 'run') return this.runNow(id);
    if (action === 'runs') return this.runs(params, id);
    return this.delete(params, id);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private list(): SubscriptionsListCliResult {
    const subscriptions = this.manager.getSubscriptions().map((s) => ({
      subscriptionId: s.id,
      name: s.name,
      platform: s.platform,
      handle: s.target.handle,
      profileUrl: s.target.profileUrl,
      enabled: s.enabled,
      lastRunAt: s.state.lastRunAt,
      updatedAt: s.updatedAt,
    }));
    return {
      subscriptions,
      total: subscriptions.length,
      enabledCount: subscriptions.filter((s) => s.enabled).length,
    };
  }

  private async setEnabled(id: string, enabled: boolean): Promise<SubscriptionToggleCliResult> {
    const updated = await this.manager.updateSubscription(id, { enabled });
    // Report what the manager confirmed, not what was asked for — a refused
    // pause that echoed the request would read as success.
    return {
      subscriptionId: updated.id,
      name: updated.name,
      platform: updated.platform,
      enabled: updated.enabled,
    };
  }

  private async runNow(id: string): Promise<SubscriptionRunCliResult> {
    const run = await this.manager.triggerManualRun(id);
    return {
      subscriptionId: id,
      runId: run.id,
      status: run.status,
      trigger: run.trigger,
    };
  }

  private async runs(params: CliParams, id: string): Promise<SubscriptionRunsCliResult> {
    const limit = parseNumber(params, 'limit', { integer: true, min: 1, max: 50 });
    const runs = await this.manager.getRunHistory(id, limit);
    return {
      subscriptionId: id,
      runs: runs.map((run) => ({
        runId: run.id,
        status: run.status,
        trigger: run.trigger,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        postsArchived: run.postsArchived,
        creditsUsed: run.creditsUsed,
        ...(run.error !== undefined ? { error: run.error } : {}),
      })),
      total: runs.length,
    };
  }

  private async delete(params: CliParams, id: string): Promise<SubscriptionDeleteCliResult> {
    // The caller is often an agent working from a list of ids, which is exactly
    // who deletes the wrong one by accident.
    if (!parseBool(params, 'confirm')) {
      throw new CliValidationError(
        'confirm',
        "delete removes the subscription permanently; pass confirm=true. Archives already created are kept.",
      );
    }
    await this.manager.deleteSubscription(id);
    return { subscriptionId: id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private requireId(params: CliParams, action: SubscriptionsCliAction): string {
    const id = parseString(params, 'id');
    if (!id) {
      throw new CliValidationError(
        'id',
        `action='${action}' requires 'id'. Run \`social-archiver:subscriptions\` to list them.`,
      );
    }
    return id;
  }
}
