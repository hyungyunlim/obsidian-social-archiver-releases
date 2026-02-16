/**
 * ArchiveJobTracker Test Suite
 *
 * Tests state management, observer pattern, auto-cleanup, WebSocket event matching,
 * and app restart recovery for post archive jobs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ArchiveJobTracker } from '@/services/ArchiveJobTracker';
import type { ActiveArchiveJob, ArchiveJobUpdateCallback } from '@/services/ArchiveJobTracker';
import type { PendingJob } from '@/services/PendingJobsManager';
import type { Platform } from '@/shared/platforms/types';

describe('ArchiveJobTracker', () => {
  let tracker: ArchiveJobTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new ArchiveJobTracker();
  });

  afterEach(() => {
    tracker.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ========== Job Lifecycle ==========

  describe('Job Lifecycle', () => {
    it('should start a new job with queued status', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
        status: 'queued',
        retryCount: 0,
        maxRetries: 3,
      });
      expect(jobs[0]?.startedAt).toBeGreaterThan(0);
      expect(jobs[0]?.updatedAt).toBeGreaterThan(0);
    });

    it('should support custom maxRetries', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
        maxRetries: 5,
      });

      const job = tracker.getJob('job1');
      expect(job?.maxRetries).toBe(5);
    });

    it('should mark job as archiving', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.markProcessing('job1');

      const job = tracker.getJob('job1');
      expect(job?.status).toBe('archiving');
    });

    it('should store workerJobId when marking as processing', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.markProcessing('job1', 'worker-123');

      const job = tracker.getJob('job1');
      expect(job?.workerJobId).toBe('worker-123');

      // Should be able to find by workerJobId
      const jobByWorker = tracker.getJobByWorkerJobId('worker-123');
      expect(jobByWorker?.jobId).toBe('job1');
    });

    it('should update progress text', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.updateProgress('job1', 'Downloading episode 1/10');

      const job = tracker.getJob('job1');
      expect(job?.progressText).toBe('Downloading episode 1/10');
    });

    it('should mark job as retrying with retry count', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.markRetrying('job1', 2);

      const job = tracker.getJob('job1');
      expect(job?.status).toBe('retrying');
      expect(job?.retryCount).toBe(2);
    });

    it('should mark job as completed', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.completeJob('job1');

      const job = tracker.getJob('job1');
      expect(job?.status).toBe('completed');
    });

    it('should mark job as failed with error message', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.failJob('job1', 'Network error');

      const job = tracker.getJob('job1');
      expect(job?.status).toBe('failed');
      expect(job?.error).toBe('Network error');
    });

    it('should dismiss a job manually', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.dismissJob('job1');

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(0);
    });

    it('should auto-hide completed jobs after 5 seconds', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.completeJob('job1');

      // Job still exists immediately
      expect(tracker.getActiveJobs()).toHaveLength(1);

      // Fast-forward 5 seconds
      vi.advanceTimersByTime(5000);

      // Job should be removed
      expect(tracker.getActiveJobs()).toHaveLength(0);
    });

    it('should cancel auto-hide timer when dismissing completed job', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      tracker.completeJob('job1');

      // Dismiss before timer expires
      tracker.dismissJob('job1');

      // Job should be removed immediately
      expect(tracker.getActiveJobs()).toHaveLength(0);

      // Fast-forward to ensure timer doesn't fire
      vi.advanceTimersByTime(5000);
      expect(tracker.getActiveJobs()).toHaveLength(0);
    });
  });

  // ========== Observer Pattern ==========

  describe('Observer Pattern', () => {
    it('should notify listeners on job start', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      tracker.onUpdate(callback);

      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ jobId: 'job1' }),
        ])
      );
    });

    it('should notify listeners on status change', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      tracker.onUpdate(callback);

      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      callback.mockClear();

      tracker.markProcessing('job1');
      expect(callback).toHaveBeenCalledTimes(1);

      tracker.completeJob('job1');
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should notify listeners on progress update', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      tracker.onUpdate(callback);

      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      callback.mockClear();

      tracker.updateProgress('job1', 'Downloading...');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should notify listeners on job removal', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      tracker.onUpdate(callback);

      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      callback.mockClear();

      tracker.dismissJob('job1');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith([]);
    });

    it('should support multiple listeners', () => {
      const callback1 = vi.fn<[ActiveArchiveJob[]], void>();
      const callback2 = vi.fn<[ActiveArchiveJob[]], void>();

      tracker.onUpdate(callback1);
      tracker.onUpdate(callback2);

      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe listeners correctly', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      const unsubscribe = tracker.onUpdate(callback);

      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      callback.mockClear();

      tracker.startJob({
        jobId: 'job2',
        url: 'https://x.com/user/status/456',
        platform: 'x',
      });
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ========== Query Methods ==========

  describe('Query Methods', () => {
    it('should return jobs sorted by startedAt descending (newest first)', () => {
      // Add jobs with different timestamps
      vi.setSystemTime(1000);
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      vi.setSystemTime(2000);
      tracker.startJob({
        jobId: 'job2',
        url: 'https://x.com/user/status/456',
        platform: 'x',
      });

      vi.setSystemTime(3000);
      tracker.startJob({
        jobId: 'job3',
        url: 'https://x.com/user/status/789',
        platform: 'x',
      });

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(3);
      expect(jobs[0]?.jobId).toBe('job3'); // newest
      expect(jobs[1]?.jobId).toBe('job2');
      expect(jobs[2]?.jobId).toBe('job1'); // oldest
    });

    it('should get job by ID', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      const job = tracker.getJob('job1');
      expect(job?.jobId).toBe('job1');
    });

    it('should return undefined for non-existent job ID', () => {
      const job = tracker.getJob('non-existent');
      expect(job).toBeUndefined();
    });

    it('should get job by workerJobId', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      tracker.markProcessing('job1', 'worker-123');

      const job = tracker.getJobByWorkerJobId('worker-123');
      expect(job?.jobId).toBe('job1');
    });

    it('should return undefined for non-existent workerJobId', () => {
      const job = tracker.getJobByWorkerJobId('non-existent');
      expect(job).toBeUndefined();
    });
  });

  // ========== Restore from PendingJobs ==========

  describe('Restore from PendingJobs', () => {
    const createPendingJob = (overrides?: Partial<PendingJob>): PendingJob => ({
      id: `job-${Date.now()}`,
      url: 'https://x.com/user/status/123',
      platform: 'x' as Platform,
      status: 'pending',
      timestamp: Date.now(),
      retryCount: 0,
      ...overrides,
    });

    it('should restore pending archive jobs', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'pending',
          metadata: {
            type: 'post-archive',
            workerJobId: 'worker-123',
          },
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        jobId: 'job1',
        status: 'queued',
        workerJobId: 'worker-123',
      });
    });

    it('should restore processing jobs as archiving', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'processing',
          metadata: {
            type: 'post-archive',
            startedAt: 12345,
            workerJobId: 'worker-123',
          },
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const job = tracker.getJob('job1');
      expect(job?.status).toBe('archiving');
      expect(job?.startedAt).toBe(12345);
    });

    it('should restore failed jobs with error message', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'failed',
          metadata: {
            type: 'post-archive',
            lastError: 'Network timeout',
          },
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const job = tracker.getJob('job1');
      expect(job?.status).toBe('failed');
      expect(job?.error).toBe('Network timeout');
    });

    it('should skip profile-crawl jobs', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'processing',
          metadata: {
            type: 'profile-crawl', // Should be skipped
            handle: '@username',
          },
        }),
        createPendingJob({
          id: 'job2',
          status: 'pending',
          metadata: {
            type: 'post-archive', // Should be restored
          },
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.jobId).toBe('job2');
    });

    it('should skip completed jobs', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'completed', // Should be skipped
        }),
        createPendingJob({
          id: 'job2',
          status: 'pending', // Should be restored
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.jobId).toBe('job2');
    });

    it('should skip cancelled jobs', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'cancelled', // Should be skipped
        }),
        createPendingJob({
          id: 'job2',
          status: 'pending', // Should be restored
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.jobId).toBe('job2');
    });

    it('should restore jobs without type metadata (defaults to post-archive)', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'pending',
          // No metadata.type - should restore as post-archive
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const jobs = tracker.getActiveJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.jobId).toBe('job1');
    });

    it('should map workerJobId for WebSocket event matching', () => {
      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'processing',
          metadata: {
            workerJobId: 'worker-123',
          },
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      const job = tracker.getJobByWorkerJobId('worker-123');
      expect(job?.jobId).toBe('job1');
    });

    it('should notify listeners after restoring jobs', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      tracker.onUpdate(callback);

      const pendingJobs: PendingJob[] = [
        createPendingJob({ id: 'job1', status: 'pending' }),
        createPendingJob({ id: 'job2', status: 'processing' }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ jobId: 'job1' }),
          expect.objectContaining({ jobId: 'job2' }),
        ])
      );
    });

    it('should not notify listeners if no jobs restored', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      tracker.onUpdate(callback);

      const pendingJobs: PendingJob[] = [
        createPendingJob({
          id: 'job1',
          status: 'completed', // Will be skipped
        }),
      ];

      tracker.restoreFromPendingJobs(pendingJobs);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ========== Cleanup ==========

  describe('Cleanup', () => {
    it('should clear all state on destroy', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      tracker.markProcessing('job1', 'worker-123');

      expect(tracker.getActiveJobs()).toHaveLength(1);

      tracker.destroy();

      expect(tracker.getActiveJobs()).toHaveLength(0);
      expect(tracker.getJobByWorkerJobId('worker-123')).toBeUndefined();
    });

    it('should clear all timers on destroy', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      tracker.completeJob('job1');

      tracker.destroy();

      // Fast-forward timers - job should not be auto-removed
      vi.advanceTimersByTime(5000);

      // Job already removed by destroy, not by timer
      expect(tracker.getActiveJobs()).toHaveLength(0);
    });

    it('should clear all listeners on destroy', () => {
      const callback = vi.fn<[ActiveArchiveJob[]], void>();
      tracker.onUpdate(callback);

      tracker.destroy();

      // Create new tracker instance
      tracker = new ArchiveJobTracker();
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });

      // Old callback should not be called
      expect(callback).not.toHaveBeenCalled();
    });

    it('should clean up workerJobId mapping when removing job', () => {
      tracker.startJob({
        jobId: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x',
      });
      tracker.markProcessing('job1', 'worker-123');

      expect(tracker.getJobByWorkerJobId('worker-123')).toBeDefined();

      tracker.dismissJob('job1');

      expect(tracker.getJobByWorkerJobId('worker-123')).toBeUndefined();
    });
  });
});
