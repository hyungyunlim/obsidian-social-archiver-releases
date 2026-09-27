/**
 * The plugin's Learning Review calls: hydrated today, the streak-carrying
 * session, and the email digest switch that must bring a timezone with it
 * (the digest cron skips accounts without one).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as ObsidianMock from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { LearningReviewClient, LearningReviewError } from '../LearningReviewClient';

const { __setRequestUrlHandler } = ObsidianMock as unknown as {
  __setRequestUrlHandler: (h: ((p: RequestUrlParam) => Promise<RequestUrlResponse>) | null) => void;
};

const calls: RequestUrlParam[] = [];

function respond(status: number, json: unknown): void {
  __setRequestUrlHandler(async (params) => {
    calls.push(params);
    return { status, headers: {}, text: JSON.stringify(json), json, arrayBuffer: new ArrayBuffer(0) };
  });
}

function client(token: string | null = 'jwt'): LearningReviewClient {
  return new LearningReviewClient({
    apiClient: () => ({
      getEndpoint: () => 'https://api.example',
      getAuthToken: () => token,
      getClientHeaders: () => ({ 'X-Client': 'obsidian-plugin' }),
    }),
  });
}

afterEach(() => {
  __setRequestUrlHandler(null);
  calls.length = 0;
});

describe('LearningReviewClient', () => {
  it('asks for the hydrated set of the device day, as the plugin client', async () => {
    respond(200, {
      success: true,
      data: {
        day: '2026-09-27',
        set: { units: [{ id: 'a1', archiveId: 'a1' }] },
        units: [{ id: 'a1', archiveId: 'a1', kind: 'post', text: 'Body', platform: 'x', archivedAt: '2026-01-01T00:00:00.000Z' }],
        archives: { a1: { title: 'T', authorName: 'A', originalUrl: 'https://x.com/1', savedAge: { unit: 'months', count: 8 } } },
      },
    });

    const today = await client().getToday('2026-09-27');

    expect(calls[0].url).toBe('https://api.example/api/user/learning/today?hydrate=1&day=2026-09-27');
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer jwt', 'X-Client': 'obsidian-plugin' });
    expect(today.units).toHaveLength(1);
    expect(today.archives.a1?.savedAge).toEqual({ unit: 'months', count: 8 });
  });

  it('turns a switched-off account into a review-off error, not a failure', async () => {
    respond(409, { success: false, error: { code: 'LEARNING_DISABLED', message: 'off' } });

    const error = await client().getToday('2026-09-27').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LearningReviewError);
    expect((error as LearningReviewError).isReviewOff).toBe(true);
  });

  it('never calls the server without a token', async () => {
    respond(200, { success: true });

    const error = await client(null).getStatus().catch((e: unknown) => e);

    expect((error as LearningReviewError).code).toBe('UNAUTHENTICATED');
    expect(calls).toHaveLength(0);
  });

  it('records the finished day and returns the new streak', async () => {
    respond(200, { success: true, data: { day: '2026-09-27', streak: 4 } });

    const streak = await client().recordSession('2026-09-27', 5);

    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body as string)).toEqual({ day: '2026-09-27', unitCount: 5, cardCount: 0 });
    expect(streak).toBe(4);
  });

  it('brings timezone and locale along when switching the email digest on for an account without them', async () => {
    respond(200, {
      success: true,
      preferences: { learningReviewEmailEnabled: true, learningReviewHour: 8, timezone: 'Asia/Seoul', locale: 'ko' },
    });
    const current = { emailEnabled: false, hour: 8, timezone: null, locale: null };

    const next = await client().setEmailDigest(true, { timezone: 'Asia/Seoul', locale: 'ko' }, current);

    expect(calls[0].url).toBe('https://api.example/api/users/notification-preferences');
    expect(JSON.parse(calls[0].body as string)).toEqual({
      learningReviewEmailEnabled: true,
      timezone: 'Asia/Seoul',
      locale: 'ko',
    });
    expect(next.emailEnabled).toBe(true);
  });

  it('leaves an existing timezone alone, and sends only the switch when turning it off', async () => {
    respond(200, { success: true, preferences: { learningReviewEmailEnabled: false } });
    const current = { emailEnabled: true, hour: 8, timezone: 'Europe/Berlin', locale: 'en' };

    await client().setEmailDigest(true, { timezone: 'Asia/Seoul', locale: 'ko' }, current);
    await client().setEmailDigest(false, { timezone: 'Asia/Seoul', locale: 'ko' }, current);

    expect(JSON.parse(calls[0].body as string)).toEqual({ learningReviewEmailEnabled: true });
    expect(JSON.parse(calls[1].body as string)).toEqual({ learningReviewEmailEnabled: false });
  });
});
