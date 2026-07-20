import { describe, expect, it } from 'vitest';
import { RealtimeFirstPollingPolicy } from '../../../plugin/jobs/RealtimeFirstPollingPolicy';

describe('RealtimeFirstPollingPolicy (obsidian AD-12 fallback)', () => {
  it('escalates realtime-first backoff 2/4/8/15 and caps at 15', () => {
    const policy = new RealtimeFirstPollingPolicy();
    const seen: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      seen.push(policy.nextDelaySeconds());
      policy.recordPollFired();
    }
    expect(seen).toEqual([2, 4, 8, 15, 15, 15]);
  });

  it('resets backoff on disconnect at every stage', () => {
    for (const stage of [1, 2, 3, 4]) {
      const policy = new RealtimeFirstPollingPolicy();
      for (let index = 0; index < stage; index += 1) policy.recordPollFired();
      policy.reset();
      expect(policy.nextDelaySeconds()).toBe(2);
    }
  });

  it('resets on a mid-request interrupt (cancel)', () => {
    const policy = new RealtimeFirstPollingPolicy();
    policy.recordPollFired();
    policy.recordPollFired();
    expect(policy.nextDelaySeconds()).toBe(8);
    policy.reset();
    expect(policy.nextDelaySeconds()).toBe(2);
  });

  it('pauses in background and resumes the same stage in foreground', () => {
    const policy = new RealtimeFirstPollingPolicy();
    policy.recordPollFired();
    policy.setPhase('background');
    expect(policy.nextDelaySeconds()).toBe(0);
    policy.recordPollFired();
    policy.setPhase('foreground');
    expect(policy.nextDelaySeconds()).toBe(4);
  });

  it('resets on reconnect', () => {
    const policy = new RealtimeFirstPollingPolicy();
    policy.recordPollFired();
    policy.recordPollFired();
    policy.recordPollFired();
    expect(policy.nextDelaySeconds()).toBe(15);
    policy.reset();
    expect(policy.nextDelaySeconds()).toBe(2);
  });

  it('runs the terminal side effect exactly once for same-tick WS and poll', () => {
    const policy = new RealtimeFirstPollingPolicy();
    let sideEffects = 0;
    const wsWon = policy.complete(() => { sideEffects += 1; });
    const pollWon = policy.complete(() => { sideEffects += 1; });
    expect(wsWon).toBe(true);
    expect(pollWon).toBe(false);
    expect(sideEffects).toBe(1);
    expect(policy.isComplete).toBe(true);
    expect(policy.nextDelaySeconds()).toBe(0);
  });

  it('restart clears completion and backoff', () => {
    const policy = new RealtimeFirstPollingPolicy();
    policy.recordPollFired();
    policy.complete(() => undefined);
    expect(policy.isComplete).toBe(true);
    policy.restart();
    expect(policy.isComplete).toBe(false);
    expect(policy.nextDelaySeconds()).toBe(2);
  });
});
