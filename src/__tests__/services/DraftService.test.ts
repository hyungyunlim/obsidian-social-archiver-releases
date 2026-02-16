import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DraftService } from '@/services/DraftService';
import type { App } from 'obsidian';

describe('DraftService', () => {
  let service: DraftService;
  let mockApp: App;
  let mockStorage: Map<string, unknown>;

  beforeEach(async () => {
    // Mock localStorage behavior
    mockStorage = new Map();

    // Mock Obsidian App
    mockApp = {
      saveLocalStorage: vi.fn((key: string, data: unknown | null) => {
        if (data === null) {
          mockStorage.delete(key);
        } else {
          mockStorage.set(key, data);
        }
      }),
      loadLocalStorage: vi.fn((key: string) => {
        return mockStorage.get(key) || null;
      })
    } as unknown as App;

    service = new DraftService(mockApp);
    await service.initialize();
  });

  afterEach(async () => {
    if (service) {
      await service.cleanup();
    }
    mockStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Service Lifecycle', () => {
    it('should initialize successfully', async () => {
      expect(service.isServiceInitialized()).toBe(true);
      expect(service.name).toBe('DraftService');
    });

    it('should cleanup successfully', async () => {
      await service.cleanup();
      expect(service.isServiceInitialized()).toBe(false);
    });

    it('should not reinitialize if already initialized', async () => {
      await service.initialize(); // Second init
      expect(service.isServiceInitialized()).toBe(true);
    });
  });

  describe('Draft Saving', () => {
    it('should save a draft immediately', async () => {
      const draftId = 'test-draft';
      const content = 'This is a test draft';

      await service.saveDraft(draftId, content, { immediate: true });

      const loaded = service.loadDraft(draftId);
      expect(loaded).not.toBeNull();
      expect(loaded?.content).toBe(content);
      expect(loaded?.id).toBe(draftId);
    });

    it('should not save empty drafts', async () => {
      const draftId = 'empty-draft';
      await service.saveDraft(draftId, '', { immediate: true });

      const loaded = service.loadDraft(draftId);
      expect(loaded).toBeNull();
    });

    it('should not save whitespace-only drafts', async () => {
      const draftId = 'whitespace-draft';
      await service.saveDraft(draftId, '   \n\t  ', { immediate: true });

      const loaded = service.loadDraft(draftId);
      expect(loaded).toBeNull();
    });

    it('should debounce saves by default', async () => {
      vi.useFakeTimers();

      const draftId = 'debounced-draft';
      const content = 'Debounced content';

      // Save without immediate flag (default debounce: true)
      await service.saveDraft(draftId, content);

      // Should not be saved yet
      let loaded = service.loadDraft(draftId);
      expect(loaded).toBeNull();

      // Fast forward past debounce delay (2000ms)
      vi.advanceTimersByTime(2100);

      // Now it should be saved
      loaded = service.loadDraft(draftId);
      expect(loaded).not.toBeNull();
      expect(loaded?.content).toBe(content);

      vi.useRealTimers();
    });

    it('should cancel previous debounced save on new save', async () => {
      vi.useFakeTimers();

      const draftId = 'cancel-test';

      await service.saveDraft(draftId, 'First content');
      vi.advanceTimersByTime(1000); // Partial wait

      await service.saveDraft(draftId, 'Second content');
      vi.advanceTimersByTime(2100); // Complete wait for second

      const loaded = service.loadDraft(draftId);
      expect(loaded?.content).toBe('Second content');

      vi.useRealTimers();
    });

    it('should include version and timestamp in saved draft', async () => {
      const draftId = 'versioned-draft';
      const content = 'Version test';
      const beforeSave = Date.now();

      await service.saveDraft(draftId, content, { immediate: true });

      const loaded = service.loadDraft(draftId);
      expect(loaded?.version).toBe(1);
      expect(loaded?.timestamp).toBeGreaterThanOrEqual(beforeSave);
      expect(loaded?.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should include device ID in saved draft', async () => {
      const draftId = 'device-id-draft';
      const content = 'Device ID test';

      await service.saveDraft(draftId, content, { immediate: true });

      const loaded = service.loadDraft(draftId);
      expect(loaded?.deviceId).toBeDefined();
      expect(typeof loaded?.deviceId).toBe('string');
    });
  });

  describe('Draft Loading', () => {
    it('should return null for non-existent draft', () => {
      const loaded = service.loadDraft('non-existent');
      expect(loaded).toBeNull();
    });

    it('should validate draft structure', async () => {
      const draftId = 'invalid-draft';

      // Manually save invalid data
      const storageKey = `social-archiver-draft-${draftId}`;
      mockApp.saveLocalStorage(storageKey, { invalid: 'data' });

      const loaded = service.loadDraft(draftId);
      expect(loaded).toBeNull();

      // Should be removed
      const stillThere = mockApp.loadLocalStorage(storageKey);
      expect(stillThere).toBeNull();
    });

    it('should handle corrupted storage gracefully', () => {
      const draftId = 'corrupted-draft';
      const storageKey = `social-archiver-draft-${draftId}`;

      // Save non-object data
      mockApp.saveLocalStorage(storageKey, 'not-an-object');

      const loaded = service.loadDraft(draftId);
      expect(loaded).toBeNull();
    });
  });

  describe('Draft Deletion', () => {
    it('should delete an existing draft', async () => {
      const draftId = 'delete-test';
      const content = 'To be deleted';

      await service.saveDraft(draftId, content, { immediate: true });
      expect(service.loadDraft(draftId)).not.toBeNull();

      service.deleteDraft(draftId);
      expect(service.loadDraft(draftId)).toBeNull();
    });

    it('should handle deleting non-existent draft', () => {
      expect(() => service.deleteDraft('non-existent')).not.toThrow();
    });
  });

  describe('Auto-Save', () => {
    it('should start auto-save timer', () => {
      vi.useFakeTimers();

      const draftId = 'auto-save-test';
      let content = 'Initial content';
      const getContent = () => content;

      service.startAutoSave(draftId, getContent);

      // Advance time to just before first auto-save (60 seconds)
      vi.advanceTimersByTime(59000);
      expect(service.loadDraft(draftId)).toBeNull();

      // Advance to trigger auto-save
      vi.advanceTimersByTime(2000);
      expect(service.loadDraft(draftId)).not.toBeNull();

      vi.useRealTimers();
    });

    it('should not auto-save empty content', () => {
      vi.useFakeTimers();

      const draftId = 'empty-auto-save';
      const getContent = () => '';

      service.startAutoSave(draftId, getContent);
      vi.advanceTimersByTime(61000);

      expect(service.loadDraft(draftId)).toBeNull();

      vi.useRealTimers();
    });

    it('should stop auto-save on cleanup', async () => {
      vi.useFakeTimers();

      const draftId = 'cleanup-test';
      const getContent = () => 'Content';

      service.startAutoSave(draftId, getContent);
      service.stopAutoSave();

      vi.advanceTimersByTime(61000);

      // Should not be saved after stop
      expect(service.loadDraft(draftId)).toBeNull();

      vi.useRealTimers();
    });

    it('should allow restarting auto-save', () => {
      vi.useFakeTimers();

      const draftId1 = 'draft-1';
      const draftId2 = 'draft-2';

      service.startAutoSave(draftId1, () => 'Content 1');
      service.stopAutoSave();
      service.startAutoSave(draftId2, () => 'Content 2');

      vi.advanceTimersByTime(61000);

      // Only draft-2 should be saved
      expect(service.loadDraft(draftId1)).toBeNull();
      expect(service.loadDraft(draftId2)).not.toBeNull();

      vi.useRealTimers();
    });
  });

  describe('Draft Recovery', () => {
    it('should recover existing draft', async () => {
      const draftId = 'recovery-test';
      const content = 'Recovered content';

      await service.saveDraft(draftId, content, { immediate: true });

      const recovery = await service.recoverDrafts(draftId);

      expect(recovery.hasDraft).toBe(true);
      expect(recovery.draft).not.toBeUndefined();
      expect(recovery.draft?.content).toBe(content);
    });

    it('should return no draft when none exists', async () => {
      const recovery = await service.recoverDrafts('non-existent');

      expect(recovery.hasDraft).toBe(false);
      expect(recovery.draft).toBeUndefined();
      expect(recovery.conflicts).toBeUndefined();
    });

    it('should not return conflicts in current implementation', async () => {
      // Current implementation doesn't support multi-device conflict detection
      const draftId = 'conflict-test';
      await service.saveDraft(draftId, 'Content', { immediate: true });

      const recovery = await service.recoverDrafts(draftId);

      expect(recovery.conflicts).toBeUndefined();
    });
  });

  describe('Storage Management', () => {
    it('should provide storage info', () => {
      const info = service.getStorageInfo();

      expect(info).toHaveProperty('used');
      expect(info).toHaveProperty('available');
      expect(info).toHaveProperty('percentage');
      expect(info).toHaveProperty('isNearLimit');
    });

    it('should provide async storage info', async () => {
      const info = await service.getStorageInfoAsync();

      expect(info).toHaveProperty('used');
      expect(info).toHaveProperty('available');
      expect(info).toHaveProperty('percentage');
      expect(info).toHaveProperty('isNearLimit');
    });

    it('should handle quota exceeded error', async () => {
      // Mock quota exceeded error
      mockApp.saveLocalStorage = vi.fn(() => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });

      const draftId = 'quota-test';
      const content = 'Large content';

      await expect(
        service.saveDraft(draftId, content, { immediate: true })
      ).rejects.toThrow('Storage quota exceeded');
    });
  });

  describe('Device ID', () => {
    it('should generate consistent device ID', async () => {
      const draftId1 = 'device-test-1';
      const draftId2 = 'device-test-2';

      await service.saveDraft(draftId1, 'Content 1', { immediate: true });
      await service.saveDraft(draftId2, 'Content 2', { immediate: true });

      const draft1 = service.loadDraft(draftId1);
      const draft2 = service.loadDraft(draftId2);

      expect(draft1?.deviceId).toBe(draft2?.deviceId);
    });

    it('should reuse existing device ID', async () => {
      // Save first draft to establish device ID
      await service.saveDraft('first', 'Content', { immediate: true });
      const firstDeviceId = service.loadDraft('first')?.deviceId;

      // Create new service instance (simulating restart)
      const newService = new DraftService(mockApp);
      await newService.initialize();

      await newService.saveDraft('second', 'Content', { immediate: true });
      const secondDeviceId = newService.loadDraft('second')?.deviceId;

      expect(secondDeviceId).toBe(firstDeviceId);

      await newService.cleanup();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long content', async () => {
      const draftId = 'long-content';
      const longContent = 'x'.repeat(100000); // 100KB

      await service.saveDraft(draftId, longContent, { immediate: true });

      const loaded = service.loadDraft(draftId);
      expect(loaded?.content).toBe(longContent);
    });

    it('should handle special characters in content', async () => {
      const draftId = 'special-chars';
      const specialContent = '🎉 Test with émojis and ñ special çhars';

      await service.saveDraft(draftId, specialContent, { immediate: true });

      const loaded = service.loadDraft(draftId);
      expect(loaded?.content).toBe(specialContent);
    });

    it('should handle rapid successive saves', async () => {
      vi.useFakeTimers();

      const draftId = 'rapid-save';

      for (let i = 0; i < 100; i++) {
        await service.saveDraft(draftId, `Content ${i}`);
        vi.advanceTimersByTime(100);
      }

      // Wait for final debounce
      vi.advanceTimersByTime(2100);

      const loaded = service.loadDraft(draftId);
      expect(loaded?.content).toMatch(/Content \d+/);

      vi.useRealTimers();
    });

    it('should handle multiple concurrent drafts', async () => {
      const drafts = [
        { id: 'draft-1', content: 'Content 1' },
        { id: 'draft-2', content: 'Content 2' },
        { id: 'draft-3', content: 'Content 3' }
      ];

      // Save all drafts
      await Promise.all(
        drafts.map(d => service.saveDraft(d.id, d.content, { immediate: true }))
      );

      // Verify all drafts
      for (const draft of drafts) {
        const loaded = service.loadDraft(draft.id);
        expect(loaded?.content).toBe(draft.content);
      }
    });
  });

  describe('IService Interface', () => {
    it('should implement IService interface', () => {
      expect(service.name).toBe('DraftService');
      expect(service.isServiceInitialized()).toBe(true);
      expect(typeof service.initialize).toBe('function');
      expect(typeof service.cleanup).toBe('function');
    });

    it('should allow initialization and cleanup cycle', async () => {
      await service.cleanup();
      expect(service.isServiceInitialized()).toBe(false);

      await service.initialize();
      expect(service.isServiceInitialized()).toBe(true);

      await service.cleanup();
      expect(service.isServiceInitialized()).toBe(false);
    });
  });
});
