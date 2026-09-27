/**
 * LearningReviewClient — the plugin's only door to Learning Review.
 *
 * The plugin is a thin client (prd-learning-review §22 follow-up, 2026-09-27):
 * the server picks today's set and fills it in (`GET /learning/today?hydrate=1`),
 * so no selection logic and no per-post review state live in the vault. What
 * the plugin writes is the finished session (the streak shared with the apps)
 * and two switches: Review itself and the email digest.
 *
 * HTTP only. State, progress and rendering live elsewhere.
 */

import { requestUrl } from 'obsidian';
import type { WorkersAPIClient } from '../WorkersAPIClient';

export type ReviewUnitKind = 'post' | 'highlight';

/** One card as the server renders it — excerpt ladder already applied. */
export interface ReviewCardUnit {
  id: string;
  archiveId: string;
  kind: ReviewUnitKind;
  text: string;
  note?: string;
  /** Recall prompt; `text` is then its answer. */
  question?: string;
  platform: string;
  archivedAt: string;
}

export type SavedAgeUnit = 'today' | 'yesterday' | 'days' | 'weeks' | 'months' | 'years';

export interface ReviewArchiveLabel {
  title: string | null;
  authorName: string | null;
  originalUrl: string | null;
  savedAge: { unit: SavedAgeUnit; count: number } | null;
}

export interface TodayReview {
  day: string;
  units: ReviewCardUnit[];
  archives: Record<string, ReviewArchiveLabel>;
}

export interface DigestSettings {
  emailEnabled: boolean;
  hour: number;
  timezone: string | null;
  locale: string | null;
}

/** `code` is the server's error code; `status` the HTTP status (0 = network). */
export class LearningReviewError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LearningReviewError';
  }

  /** Review is switched off for this account (409) or not rolled out (503). */
  get isReviewOff(): boolean {
    return this.code === 'LEARNING_DISABLED' || this.code === 'FEATURE_DISABLED';
  }
}

export interface LearningReviewClientDeps {
  /** A getter: the plugin rebuilds its API client when settings change. */
  apiClient: () => Pick<WorkersAPIClient, 'getEndpoint' | 'getAuthToken' | 'getClientHeaders'> | undefined;
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  preferences?: unknown;
  streak?: unknown;
  error?: { code?: string; message?: string };
}

export class LearningReviewClient {
  constructor(private readonly deps: LearningReviewClientDeps) {}

  /** Today's set, rendered. `day` is the device's local `YYYY-MM-DD`. */
  async getToday(day: string): Promise<TodayReview> {
    const body = await this.call('GET', `/api/user/learning/today?hydrate=1&day=${encodeURIComponent(day)}`);
    const data = (body.data ?? {}) as Partial<TodayReview>;
    return {
      day: typeof data.day === 'string' ? data.day : day,
      units: Array.isArray(data.units) ? data.units : [],
      archives: data.archives ?? {},
    };
  }

  /** Whether Review is on for the account, and the streak the apps show. */
  async getStatus(): Promise<{ enabled: boolean; streak: number }> {
    const body = await this.call('GET', '/api/user/learning/preferences');
    const preferences = (body.preferences ?? {}) as { enabled?: boolean };
    return {
      enabled: preferences.enabled !== false,
      streak: typeof body.streak === 'number' ? body.streak : 0,
    };
  }

  /** The account-level master switch — the same one the apps' settings flip. */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.call('PATCH', '/api/user/learning/preferences', { enabled });
  }

  /** Record today's finished session; returns the streak including it. */
  async recordSession(day: string, unitCount: number): Promise<number> {
    const body = await this.call('POST', '/api/user/learning/sessions', { day, unitCount, cardCount: 0 });
    const data = (body.data ?? {}) as { streak?: number };
    return typeof data.streak === 'number' ? data.streak : 0;
  }

  async getDigest(): Promise<DigestSettings> {
    const body = await this.call('GET', '/api/users/notification-preferences');
    return toDigest(body.preferences);
  }

  /**
   * Switch the email digest. The digest cron skips accounts with no timezone,
   * and words the email in the stored locale — so switching it on fills either
   * one in from this device when the account has none yet.
   */
  async setEmailDigest(
    enabled: boolean,
    device: { timezone: string; locale: string },
    current: DigestSettings,
  ): Promise<DigestSettings> {
    const patch: Record<string, unknown> = { learningReviewEmailEnabled: enabled };
    if (enabled && !current.timezone) patch.timezone = device.timezone;
    if (enabled && !current.locale) patch.locale = device.locale;
    const body = await this.call('PATCH', '/api/users/notification-preferences', patch);
    return toDigest(body.preferences);
  }

  private async call(method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown): Promise<Envelope> {
    const api = this.deps.apiClient();
    const token = api?.getAuthToken();
    if (!api || !token) throw new LearningReviewError('Sign in to use Review', 'UNAUTHENTICATED', 401);

    let status = 0;
    let body: Envelope | null = null;
    try {
      const response = await requestUrl({
        url: `${api.getEndpoint()}${path}`,
        method,
        headers: {
          ...api.getClientHeaders(),
          Authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        throw: false,
      });
      status = response.status;
      body = response.json as Envelope | null;
    } catch (error) {
      throw new LearningReviewError(error instanceof Error ? error.message : String(error), 'NETWORK_ERROR', 0);
    }

    if (!body || body.success !== true) {
      throw new LearningReviewError(
        body?.error?.message ?? `Request failed (${status})`,
        body?.error?.code ?? 'REQUEST_FAILED',
        status,
      );
    }
    return body;
  }
}

function toDigest(raw: unknown): DigestSettings {
  const prefs = (raw ?? {}) as {
    learningReviewEmailEnabled?: boolean;
    learningReviewHour?: number;
    timezone?: string | null;
    locale?: string | null;
  };
  return {
    emailEnabled: prefs.learningReviewEmailEnabled === true,
    hour: typeof prefs.learningReviewHour === 'number' ? prefs.learningReviewHour : 8,
    timezone: prefs.timezone ?? null,
    locale: prefs.locale ?? null,
  };
}
