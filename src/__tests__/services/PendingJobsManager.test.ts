/**
 * PendingJobsManager Test Suite
 *
 * Tests CRUD operations, localStorage quota handling, duplicate prevention,
 * schema validation, conflict resolution, and browser restart simulation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PendingJobsManager, PENDING_JOB_SCHEMA_VERSION } from '@/services/PendingJobsManager';
import type { PendingJob, JobStatus } from '@/services/PendingJobsManager';
import type { App } from 'obsidian';

describe('PendingJobsManager', () => {
  let manager: PendingJobsManager;
  let mockApp: App;
  let mockStorage: Map<string, string>;

  beforeEach(async () => {
    // Mock localStorage behavior
    mockStorage = new Map();

    // Mock Obsidian App
    mockApp = {
      saveLocalStorage: vi.fn((key: string, data: string | null) => {
        if (data === null) {
          mockStorage.delete(key);
        } else {
          mockStorage.set(key, data);
        }
      }),
      loadLocalStorage: vi.fn((key: string) => {
        return mockStorage.get(key) || null;
      }),
    } as unknown as App;

    manager = new PendingJobsManager(mockApp);
    await manager.initialize();
  });

  afterEach(async () => {
    if (manager) {
      await manager.dispose();
    }
    mockStorage.clear();
    vi.clearAllMocks();
  });

  // ========== Service Lifecycle ==========

  describe('Service Lifecycle', () => {
    it('should initialize successfully', () => {
      expect(manager.isHealthy()).toBe(true);
      expect(manager.name).toBe('PendingJobsManager');
    });

    it('should dispose successfully', async () => {
      await manager.dispose();
      expect(manager.isHealthy()).toBe(false);
    });

    it('should not reinitialize if already initialized', async () => {
      await manager.initialize(); // Second init
      expect(manager.isHealthy()).toBe(true);
    });

    it('should throw error when using service before initialization', async () => {
      const uninitializedManager = new PendingJobsManager(mockApp);
      await expect(uninitializedManager.getJobs()).rejects.toThrow('not initialized');
    });
  });

  // ========== CRUD Operations ==========

  describe('CRUD Operations', () => {
    const createTestJob = (overrides?: Partial<PendingJob>): PendingJob => ({
      id: `job-${Date.now()}`,
      url: 'https://x.com/user/status/123',
      platform: 'x',
      status: 'pending',
      timestamp: Date.now(),
      retryCount: 0,
      ...overrides,
    });

    it('should add a new job', async () => {
      const job = createTestJob();
      await manager.addJob(job);

      const jobs = await manager.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe(job.id);
    });

    it('should set schema version when adding job without it', async () => {
      const job = createTestJob();
      await manager.addJob(job);

      const retrieved = await manager.getJob(job.id);
      expect(retrieved?.schemaVersion).toBe(PENDING_JOB_SCHEMA_VERSION);
    });

    it('should retrieve all jobs', async () => {
      const job1 = createTestJob({ id: 'job1' });
      const job2 = createTestJob({ id: 'job2', platform: 'facebook' });

      await manager.addJob(job1);
      await manager.addJob(job2);

      const jobs = await manager.getJobs();
      expect(jobs).toHaveLength(2);
    });

    it('should filter jobs by status', async () => {
      const pendingJob = createTestJob({ id: 'pending1', url: 'https://x.com/test1', status: 'pending' });
      const processingJob = createTestJob({ id: 'processing1', url: 'https://x.com/test2', status: 'processing' });
      const completedJob = createTestJob({ id: 'completed1', url: 'https://x.com/test3', status: 'completed' });

      await manager.addJob(pendingJob);
      await manager.addJob(processingJob);
      await manager.addJob(completedJob);

      const pending = await manager.getJobs({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe('pending1');

      const processing = await manager.getJobs({ status: 'processing' });
      expect(processing).toHaveLength(1);
      expect(processing[0]?.id).toBe('processing1');
    });

    it('should get a specific job by ID', async () => {
      const job = createTestJob({ id: 'specific-job' });
      await manager.addJob(job);

      const retrieved = await manager.getJob('specific-job');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('specific-job');
    });

    it('should return null for non-existent job', async () => {
      const result = await manager.getJob('non-existent');
      expect(result).toBeNull();
    });

    it('should update an existing job', async () => {
      const job = createTestJob({ id: 'update-test', status: 'pending' });
      await manager.addJob(job);

      await manager.updateJob('update-test', { status: 'processing' });

      const updated = await manager.getJob('update-test');
      expect(updated?.status).toBe('processing');
    });

    it('should preserve ID and timestamp when updating', async () => {
      const job = createTestJob({ id: 'preserve-test', timestamp: 12345 });
      await manager.addJob(job);

      await manager.updateJob('preserve-test', { status: 'completed' });

      const updated = await manager.getJob('preserve-test');
      expect(updated?.id).toBe('preserve-test');
      expect(updated?.timestamp).toBe(12345);
    });

    it('should throw error when updating non-existent job', async () => {
      await expect(
        manager.updateJob('non-existent', { status: 'completed' })
      ).rejects.toThrow('not found');
    });

    it('should remove a job', async () => {
      const job = createTestJob({ id: 'remove-test' });
      await manager.addJob(job);

      await manager.removeJob('remove-test');

      const jobs = await manager.getJobs();
      expect(jobs).toHaveLength(0);
    });

    it('should handle removing non-existent job gracefully', async () => {
      await expect(manager.removeJob('non-existent')).resolves.not.toThrow();
    });
  });

  // ========== Schema Validation ==========

  describe('Schema Validation', () => {
    it('should reject job without ID', async () => {
      const invalidJob = {
        url: 'https://x.com/test',
        platform: 'x',
        status: 'pending',
        timestamp: Date.now(),
        retryCount: 0,
      } as any;

      await expect(manager.addJob(invalidJob)).rejects.toThrow('ID is required');
    });

    it('should reject job without URL', async () => {
      const invalidJob = {
        id: 'test',
        platform: 'x',
        status: 'pending',
        timestamp: Date.now(),
        retryCount: 0,
      } as any;

      await expect(manager.addJob(invalidJob)).rejects.toThrow('URL is required');
    });

    it('should reject job without platform', async () => {
      const invalidJob = {
        id: 'test',
        url: 'https://x.com/test',
        status: 'pending',
        timestamp: Date.now(),
        retryCount: 0,
      } as any;

      await expect(manager.addJob(invalidJob)).rejects.toThrow('platform is required');
    });

    it('should reject job with invalid status', async () => {
      const invalidJob = {
        id: 'test',
        url: 'https://x.com/test',
        platform: 'x',
        status: 'invalid-status',
        timestamp: Date.now(),
        retryCount: 0,
      } as any;

      await expect(manager.addJob(invalidJob)).rejects.toThrow('Invalid job status');
    });

    it('should reject job with invalid retry count', async () => {
      const invalidJob = {
        id: 'test',
        url: 'https://x.com/test',
        platform: 'x',
        status: 'pending',
        timestamp: Date.now(),
        retryCount: -1,
      } as any;

      await expect(manager.addJob(invalidJob)).rejects.toThrow('Retry count must be between');
    });

    it('should reject job with excessive retry count', async () => {
      const invalidJob = {
        id: 'test',
        url: 'https://x.com/test',
        platform: 'x',
        status: 'pending',
        timestamp: Date.now(),
        retryCount: 999,
      } as any;

      await expect(manager.addJob(invalidJob)).rejects.toThrow('Retry count must be between');
    });
  });

  // ========== Duplicate Prevention ==========

  describe('Duplicate Prevention', () => {
    it('should detect duplicate jobs (same URL and platform)', async () => {
      const baseTime = Date.now();
      const job1 = {
        id: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: baseTime,
        retryCount: 0,
      };

      const job2 = {
        id: 'job2',
        url: 'https://x.com/user/status/123',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: baseTime - 1000, // Older timestamp, so job1 should win
        retryCount: 0,
      };

      await manager.addJob(job1);

      // Since both are pending with same priority, job1 wins (newer timestamp)
      // So job2 should be rejected
      await expect(manager.addJob(job2)).rejects.toThrow('higher priority');
    });

    it('should normalize URLs when detecting duplicates', async () => {
      const baseTime = Date.now();
      const job1 = {
        id: 'job1',
        url: 'https://x.com/user/status/123/',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: baseTime,
        retryCount: 0,
      };

      const job2 = {
        id: 'job2',
        url: 'https://x.com/user/status/123#hash',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: baseTime - 1000, // Older, so job1 should win
        retryCount: 0,
      };

      await manager.addJob(job1);
      await expect(manager.addJob(job2)).rejects.toThrow('higher priority');
    });

    it('should allow same URL on different platforms', async () => {
      const job1 = {
        id: 'job1',
        url: 'https://example.com/post/123',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      const job2 = {
        id: 'job2',
        url: 'https://example.com/post/123',
        platform: 'facebook' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await manager.addJob(job1);
      await expect(manager.addJob(job2)).resolves.not.toThrow();

      const jobs = await manager.getJobs();
      expect(jobs).toHaveLength(2);
    });

    it('should allow duplicate if existing job is completed', async () => {
      const job1 = {
        id: 'job1',
        url: 'https://x.com/user/status/123',
        platform: 'x' as const,
        status: 'completed' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      const job2 = {
        id: 'job2',
        url: 'https://x.com/user/status/123',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now() + 1000,
        retryCount: 0,
      };

      await manager.addJob(job1);
      await expect(manager.addJob(job2)).resolves.not.toThrow();

      const jobs = await manager.getJobs();
      expect(jobs).toHaveLength(2);
    });
  });

  // ========== Conflict Resolution ==========

  describe('Conflict Resolution', () => {
    it('should reject new pending job if existing processing job exists', async () => {
      const processingJob = {
        id: 'processing1',
        url: 'https://x.com/test',
        platform: 'x' as const,
        status: 'processing' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      const pendingJob = {
        id: 'pending1',
        url: 'https://x.com/test',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now() + 1000,
        retryCount: 0,
      };

      await manager.addJob(processingJob);
      await expect(manager.addJob(pendingJob)).rejects.toThrow('higher priority');
    });

    it('should replace failed job with new pending job', async () => {
      const failedJob = {
        id: 'failed1',
        url: 'https://x.com/test',
        platform: 'x' as const,
        status: 'failed' as JobStatus,
        timestamp: Date.now(),
        retryCount: 3,
      };

      const pendingJob = {
        id: 'pending1',
        url: 'https://x.com/test',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now() + 1000,
        retryCount: 0,
      };

      await manager.addJob(failedJob);
      await expect(manager.addJob(pendingJob)).resolves.not.toThrow();

      // Failed job doesn't count as duplicate, so both exist
      // But we should only see the pending job (active jobs only)
      const allJobs = await manager.getJobs();
      expect(allJobs).toHaveLength(2); // Both exist in storage

      const pendingJobs = await manager.getJobs({ status: 'pending' });
      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0]?.id).toBe('pending1');
    });
  });

  // ========== Cleanup Operations ==========

  describe('Cleanup Operations', () => {
    it('should clear old jobs (older than 7 days)', async () => {
      const oldJob = {
        id: 'old-job',
        url: 'https://x.com/old',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000), // 8 days ago
        retryCount: 0,
      };

      const recentJob = {
        id: 'recent-job',
        url: 'https://x.com/recent',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await manager.addJob(oldJob);
      await manager.addJob(recentJob);

      const removedCount = await manager.clearOldJobs();
      expect(removedCount).toBe(1);

      const jobs = await manager.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe('recent-job');
    });

    it('should clear completed jobs older than 1 day', async () => {
      const oldCompleted = {
        id: 'old-completed',
        url: 'https://x.com/old',
        platform: 'x' as const,
        status: 'completed' as JobStatus,
        timestamp: Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days ago
        retryCount: 0,
      };

      const recentCompleted = {
        id: 'recent-completed',
        url: 'https://x.com/recent',
        platform: 'x' as const,
        status: 'completed' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await manager.addJob(oldCompleted);
      await manager.addJob(recentCompleted);

      const removedCount = await manager.clearOldJobs();
      expect(removedCount).toBe(1);

      const jobs = await manager.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe('recent-completed');
    });

    it('should return 0 when no old jobs to clear', async () => {
      const recentJob = {
        id: 'recent',
        url: 'https://x.com/recent',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await manager.addJob(recentJob);

      const removedCount = await manager.clearOldJobs();
      expect(removedCount).toBe(0);
    });
  });

  // ========== Storage Quota Handling ==========

  describe('Storage Quota Handling', () => {
    it('should handle quota exceeded error by cleaning old jobs', async () => {
      // Add old job that will be cleaned up
      const oldJob = {
        id: 'old-job',
        url: 'https://x.com/old',
        platform: 'x' as const,
        status: 'completed' as JobStatus,
        timestamp: Date.now() - (2 * 24 * 60 * 60 * 1000),
        retryCount: 0,
      };

      await manager.addJob(oldJob);

      // Mock quota exceeded error
      const saveLocalStorage = mockApp.saveLocalStorage as any;
      let callCount = 0;
      saveLocalStorage.mockImplementation((key: string, data: string) => {
        callCount++;
        // First call throws quota error, second call succeeds
        if (callCount === 1 && key.startsWith('pending-job-')) {
          const error = new Error('QuotaExceededError');
          error.name = 'QuotaExceededError';
          throw error;
        }
        mockStorage.set(key, data);
      });

      // Try to add new job (should trigger cleanup and retry)
      const newJob = {
        id: 'new-job',
        url: 'https://x.com/new',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await expect(manager.addJob(newJob)).resolves.not.toThrow();

      // Old job should be removed, new job should be added
      const jobs = await manager.getJobs();
      expect(jobs.find(j => j.id === 'new-job')).toBeDefined();
      expect(jobs.find(j => j.id === 'old-job')).toBeUndefined();
    });

    it('should throw StorageQuotaError if quota still exceeded after cleanup', async () => {
      // Mock quota exceeded error that persists
      const saveLocalStorage = mockApp.saveLocalStorage as any;
      saveLocalStorage.mockImplementation(() => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });

      const job = {
        id: 'quota-test',
        url: 'https://x.com/test',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await expect(manager.addJob(job)).rejects.toThrow('Storage quota exceeded');
    });
  });

  // ========== Browser Restart Simulation ==========

  describe('Browser Restart Persistence', () => {
    it('should persist jobs across browser restarts', async () => {
      const job1 = {
        id: 'persist1',
        url: 'https://x.com/test1',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      const job2 = {
        id: 'persist2',
        url: 'https://x.com/test2',
        platform: 'facebook' as const,
        status: 'processing' as JobStatus,
        timestamp: Date.now(),
        retryCount: 1,
      };

      await manager.addJob(job1);
      await manager.addJob(job2);

      // Simulate browser restart
      await manager.dispose();

      // Create new manager instance (simulates restart)
      const newManager = new PendingJobsManager(mockApp);
      await newManager.initialize();

      const jobs = await newManager.getJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs.find(j => j.id === 'persist1')).toBeDefined();
      expect(jobs.find(j => j.id === 'persist2')).toBeDefined();

      await newManager.dispose();
    });

    it('should handle corrupted data during load', async () => {
      // Manually corrupt data in storage
      mockStorage.set('pending-job-corrupted', '{ invalid json }');
      mockStorage.set('pending-jobs-index', JSON.stringify(['corrupted']));

      // Create new manager (should handle corruption gracefully)
      const newManager = new PendingJobsManager(mockApp);
      await newManager.initialize();

      const jobs = await newManager.getJobs();
      expect(jobs).toHaveLength(0); // Corrupted job should be removed

      await newManager.dispose();
    });

    it('should remove invalid jobs during load', async () => {
      // Add valid job
      const validJob = {
        id: 'valid',
        url: 'https://x.com/valid',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await manager.addJob(validJob);

      // Manually add invalid job to storage
      const invalidJob = {
        id: 'invalid',
        // Missing required fields
        timestamp: Date.now(),
      };
      mockStorage.set('pending-job-invalid', JSON.stringify(invalidJob));
      const currentIndex = JSON.parse(mockStorage.get('pending-jobs-index') || '[]');
      mockStorage.set('pending-jobs-index', JSON.stringify([...currentIndex, 'invalid']));

      // Reload manager
      await manager.dispose();
      const newManager = new PendingJobsManager(mockApp);
      await newManager.initialize();

      const jobs = await newManager.getJobs();
      expect(jobs).toHaveLength(1); // Only valid job should remain
      expect(jobs[0]?.id).toBe('valid');

      await newManager.dispose();
    });
  });

  // ========== Storage Info ==========

  describe('Storage Info', () => {
    it('should provide storage usage information', async () => {
      const job = {
        id: 'storage-test',
        url: 'https://x.com/test',
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now(),
        retryCount: 0,
      };

      await manager.addJob(job);

      const storageInfo = manager.getStorageInfo();
      expect(storageInfo.used).toBeGreaterThan(0);
      expect(storageInfo.available).toBeGreaterThan(0);
      expect(storageInfo.percentage).toBeGreaterThanOrEqual(0);
      expect(storageInfo.percentage).toBeLessThanOrEqual(1);
      expect(typeof storageInfo.isNearLimit).toBe('boolean');
    });
  });

  // ========== Edge Cases ==========

  describe('Edge Cases', () => {
    it('should handle job with metadata', async () => {
      const job: PendingJob = {
        id: 'metadata-test',
        url: 'https://x.com/test',
        platform: 'x',
        status: 'pending',
        timestamp: Date.now(),
        retryCount: 0,
        metadata: {
          notes: 'Test notes',
          estimatedCredits: 5,
          workerJobId: 'worker-123',
        },
      };

      await manager.addJob(job);

      const retrieved = await manager.getJob('metadata-test');
      expect(retrieved?.metadata?.notes).toBe('Test notes');
      expect(retrieved?.metadata?.estimatedCredits).toBe(5);
      expect(retrieved?.metadata?.workerJobId).toBe('worker-123');
    });

    it('should handle rapid concurrent operations', async () => {
      const jobs = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent-${i}`,
        url: `https://x.com/test${i}`,
        platform: 'x' as const,
        status: 'pending' as JobStatus,
        timestamp: Date.now() + i,
        retryCount: 0,
      }));

      // Add all jobs concurrently
      await Promise.all(jobs.map(job => manager.addJob(job)));

      const allJobs = await manager.getJobs();
      expect(allJobs).toHaveLength(10);
    });

    it('should handle empty job list gracefully', async () => {
      const jobs = await manager.getJobs();
      expect(jobs).toEqual([]);
    });
  });
});
