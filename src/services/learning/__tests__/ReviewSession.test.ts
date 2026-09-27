/**
 * The review panel's steps: resume today's cursor, finish the day into a
 * recorded session (the streak), and the states that are not a deck at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { LearningReviewError, type ReviewCardUnit, type TodayReview } from '../LearningReviewClient';
import { ReviewSession, localDay, remainingCards, resumeIndex, type DeckProgress } from '../ReviewSession';

function unit(id: string): ReviewCardUnit {
  return { id, archiveId: id, kind: 'post', text: `Body ${id}`, platform: 'x', archivedAt: '2026-01-01T00:00:00.000Z' };
}

function setup(options: { units?: ReviewCardUnit[]; stored?: DeckProgress | null; enabled?: boolean; signedIn?: boolean } = {}) {
  let stored: unknown = options.stored ?? null;
  const today: TodayReview = { day: '2026-09-27', units: options.units ?? [unit('a'), unit('b')], archives: {} };
  const client = {
    getToday: vi.fn(async () => today),
    getStatus: vi.fn(async () => ({ enabled: options.enabled ?? true, streak: 2 })),
    recordSession: vi.fn(async () => 3),
  };
  const progress = { read: () => stored, write: vi.fn((next: DeckProgress) => { stored = next; }) };
  const session = new ReviewSession({ client, signedIn: () => options.signedIn ?? true, progress });
  return { session, client, progress };
}

describe('resumeIndex', () => {
  it('resumes the same day, clamps, and starts other days over', () => {
    expect(resumeIndex({ day: '2026-09-27', index: 1 }, '2026-09-27', 5)).toBe(1);
    expect(resumeIndex({ day: '2026-09-27', index: 9 }, '2026-09-27', 5)).toBe(5);
    expect(resumeIndex({ day: '2026-09-26', index: 3 }, '2026-09-27', 5)).toBe(0);
    expect(resumeIndex('garbage', '2026-09-27', 5)).toBe(0);
  });
});

describe('localDay', () => {
  it('uses the local calendar, zero-padded', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('ReviewSession', () => {
  it('opens at the stored cursor with the streak', async () => {
    const { session } = setup({ stored: { day: '2026-09-27', index: 1 } });

    const state = await session.load('2026-09-27');

    expect(state).toMatchObject({ kind: 'active', index: 1, streak: 2 });
    expect(remainingCards(state)).toBe(1);
  });

  it('finishing the last card records the session and shows the new streak', async () => {
    const { session, client, progress } = setup();
    const first = await session.load('2026-09-27');
    if (first.kind !== 'active') throw new Error(first.kind);

    const second = await session.advance(first);
    if (second.kind !== 'active') throw new Error(second.kind);
    expect(client.recordSession).not.toHaveBeenCalled();

    const done = await session.advance(second);
    expect(done).toMatchObject({ kind: 'done', streak: 3 });
    expect(client.recordSession).toHaveBeenCalledWith('2026-09-27', 2);
    expect(progress.write).toHaveBeenLastCalledWith({ day: '2026-09-27', index: 2 });
    expect(remainingCards(done)).toBe(0);
  });

  it('a day already finished on this vault opens on the finish screen, and back reopens the last card', async () => {
    const { session } = setup({ stored: { day: '2026-09-27', index: 2 } });

    const done = await session.load('2026-09-27');
    if (done.kind !== 'done') throw new Error(done.kind);

    expect(session.back(done)).toMatchObject({ kind: 'active', index: 1 });
  });

  it('still finishes when recording fails, keeping the old streak', async () => {
    const { session, client } = setup({ units: [unit('a')] });
    client.recordSession.mockRejectedValueOnce(new Error('offline'));
    const first = await session.load('2026-09-27');
    if (first.kind !== 'active') throw new Error(first.kind);

    expect(await session.advance(first)).toMatchObject({ kind: 'done', streak: 2 });
  });

  it('says why there is no deck: signed out, switched off, nothing today', async () => {
    expect(await setup({ signedIn: false }).session.load('2026-09-27')).toEqual({ kind: 'signed-out' });
    expect(await setup({ enabled: false }).session.load('2026-09-27')).toEqual({ kind: 'off' });
    expect(await setup({ units: [] }).session.load('2026-09-27')).toEqual({ kind: 'empty', day: '2026-09-27' });

    const off = setup();
    off.client.getToday.mockRejectedValueOnce(new LearningReviewError('off', 'FEATURE_DISABLED', 503));
    expect(await off.session.load('2026-09-27')).toEqual({ kind: 'off' });
  });
});
