/**
 * DraftService - Auto-save and recovery service for post drafts
 *
 * Features:
 * - Auto-save every 60 seconds with debouncing
 * - Vault-scoped localStorage using Obsidian API
 * - Draft recovery with conflict resolution
 * - Storage quota management and cleanup
 * - IService interface compliance
 */

import type { App } from 'obsidian';
import { IService } from './base/IService';

/**
 * Draft data structure stored in localStorage
 */
export interface DraftData {
  id: string;
  content: string;
  timestamp: number;
  version: number;
  deviceId?: string;
}

/**
 * Draft save options
 */
export interface DraftSaveOptions {
  debounce?: boolean;
  immediate?: boolean;
}

/**
 * Draft recovery result
 */
export interface DraftRecoveryResult {
  hasDraft: boolean;
  draft?: DraftData;
  conflicts?: DraftData[];
}

/**
 * Storage information
 */
export interface StorageInfo {
  used: number;
  available: number;
  percentage: number;
  isNearLimit: boolean;
}

/**
 * DraftService - Manages automatic draft saving and recovery
 */
export class DraftService implements IService {
  public readonly name = 'DraftService';
  private app: App;
  private isInitialized = false;
  private autoSaveTimer: number | null = null;
  private debounceTimer: number | null = null;
  private readonly STORAGE_KEY_PREFIX = 'social-archiver-draft';
  private readonly AUTO_SAVE_INTERVAL = 60000; // 60 seconds
  private readonly DEBOUNCE_DELAY = 2000; // 2 seconds
  private readonly MAX_DRAFT_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly STORAGE_WARNING_THRESHOLD = 0.8; // 80%
  private _currentDraftId: string | null = null;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Initialize the service
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Clean up old drafts on initialization
    this.cleanupOldDrafts();

    this.isInitialized = true;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopAutoSave();
    this.clearDebounce();
    this.isInitialized = false;
  }

  /**
   * Check if service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Start auto-save for a draft
   * @param draftId - Unique identifier for the draft
   * @param getContent - Function to retrieve current content
   */
  startAutoSave(draftId: string, getContent: () => string): void {
    this._currentDraftId = draftId;
    this.stopAutoSave();

    this.autoSaveTimer = window.setInterval(() => {
      const content = getContent();
      if (content.trim()) {
        void this.saveDraft(draftId, content, { immediate: true });
      }
    }, this.AUTO_SAVE_INTERVAL);
  }

  /**
   * Stop auto-save
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer !== null) {
      window.clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Save a draft to localStorage
   * @param draftId - Unique identifier for the draft
   * @param content - Draft content
   * @param options - Save options
   */
  saveDraft(
    draftId: string,
    content: string,
    options: DraftSaveOptions = {}
  ): void {
    if (!content.trim()) {
      return;
    }

    const { debounce = true, immediate = false } = options;

    if (debounce && !immediate) {
      this.debouncedSave(draftId, content);
      return;
    }

    try {
      // Check storage quota before saving
      const storageInfo = this.getStorageInfo();
      if (storageInfo.isNearLimit) {
        this.cleanupOldDrafts();
      }

      const draft: DraftData = {
        id: draftId,
        content,
        timestamp: Date.now(),
        version: 1,
        deviceId: this.getDeviceId()
      };

      const storageKey = this.getStorageKey(draftId);
      this.app.saveLocalStorage(storageKey, draft);
    } catch (error) {

      // Handle quota exceeded error
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        this.handleStorageQuotaExceeded();
        // Retry once after cleanup
        try {
          const draft: DraftData = {
            id: draftId,
            content,
            timestamp: Date.now(),
            version: 1,
            deviceId: this.getDeviceId()
          };
          const storageKey = this.getStorageKey(draftId);
          this.app.saveLocalStorage(storageKey, draft);
        } catch {
          throw new Error('Storage quota exceeded. Please delete some old drafts.');
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Debounced save to prevent excessive writes
   */
  private debouncedSave(draftId: string, content: string): void {
    this.clearDebounce();

    this.debounceTimer = window.setTimeout(() => {
      void this.saveDraft(draftId, content, { immediate: true });
      this.debounceTimer = null;
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * Clear debounce timer
   */
  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Load a draft from localStorage
   * @param draftId - Unique identifier for the draft
   * @returns Draft data or null if not found
   */
  loadDraft(draftId: string): DraftData | null {
    try {
      const storageKey = this.getStorageKey(draftId);
      const data = this.app.loadLocalStorage(storageKey) as unknown;

      if (!data) {
        return null;
      }

      // Validate draft structure
      if (this.isValidDraft(data)) {
        return data as DraftData;
      }

      this.deleteDraft(draftId);
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete a draft from localStorage
   * @param draftId - Unique identifier for the draft
   */
  deleteDraft(draftId: string): void {
    try {
      const storageKey = this.getStorageKey(draftId);
      this.app.saveLocalStorage(storageKey, null);
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Recover drafts for the current context
   * @param draftId - Expected draft ID
   * @returns Recovery result with draft and any conflicts
   */
  recoverDrafts(draftId: string): DraftRecoveryResult {
    const draft = this.loadDraft(draftId);

    if (!draft) {
      return { hasDraft: false };
    }

    // Check for conflicts (multiple drafts with different device IDs)
    const conflicts = this.findConflictingDrafts(draftId, draft.deviceId);

    return {
      hasDraft: true,
      draft,
      conflicts: conflicts.length > 0 ? conflicts : undefined
    };
  }

  /**
   * Find conflicting drafts from different devices
   */
  private findConflictingDrafts(_draftId: string, _currentDeviceId?: string): DraftData[] {
    // Note: In the current implementation, we store one draft per draftId
    // If we need multi-device support, we would need to modify the storage structure
    // to include device ID in the key: `${STORAGE_KEY_PREFIX}-${draftId}-${deviceId}`
    return [];
  }

  /**
   * List all available drafts
   * @returns Array of draft data
   */
  listDrafts(): DraftData[] {
    try {
      const drafts: DraftData[] = [];

      // Note: Obsidian's loadLocalStorage doesn't provide a way to enumerate all keys
      // We would need to maintain a separate index or use a different approach
      // For now, we return an empty array

      return drafts;
    } catch (error) {
      return [];
    }
  }

  /**
   * Clean up drafts older than MAX_DRAFT_AGE
   */
  private cleanupOldDrafts(): void {
    try {
      const drafts = this.listDrafts();
      const now = Date.now();
      for (const draft of drafts) {
        if (now - draft.timestamp > this.MAX_DRAFT_AGE) {
          this.deleteDraft(draft.id);
        }
      }
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Handle storage quota exceeded error
   */
  private handleStorageQuotaExceeded(): void {
    // First, try to clean up old drafts
    this.cleanupOldDrafts();

    // If still full, implement LRU cleanup
    const drafts = this.listDrafts();
    if (drafts.length > 0) {
      // Sort by timestamp (oldest first)
      drafts.sort((a, b) => a.timestamp - b.timestamp);

      // Remove oldest 50% of drafts
      const toRemove = Math.ceil(drafts.length / 2);
      for (let i = 0; i < toRemove; i++) {
        const draft = drafts[i];
        if (draft) {
          this.deleteDraft(draft.id);
        }
      }
    }
  }

  /**
   * Get storage information
   */
  getStorageInfo(): StorageInfo {
    try {
      // Note: Web Storage API quota is not directly accessible in all browsers
      // This is a simplified estimation
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        // Modern browsers support storage estimation
        // However, this is async, so we return a placeholder for now
        return {
          used: 0,
          available: 0,
          percentage: 0,
          isNearLimit: false
        };
      }

      // Fallback estimation
      return {
        used: 0,
        available: 0,
        percentage: 0,
        isNearLimit: false
      };
    } catch (error) {
      return {
        used: 0,
        available: 0,
        percentage: 0,
        isNearLimit: false
      };
    }
  }

  /**
   * Get async storage information (accurate quota)
   */
  async getStorageInfoAsync(): Promise<StorageInfo> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const used = estimate.usage || 0;
        const available = estimate.quota || 0;
        const percentage = available > 0 ? used / available : 0;

        return {
          used,
          available,
          percentage,
          isNearLimit: percentage > this.STORAGE_WARNING_THRESHOLD
        };
      }

      return this.getStorageInfo();
    } catch (error) {
      return this.getStorageInfo();
    }
  }

  /**
   * Generate storage key for a draft
   */
  private getStorageKey(draftId: string): string {
    return `${this.STORAGE_KEY_PREFIX}-${draftId}`;
  }

  /**
   * Get or create a device ID for conflict detection
   */
  private getDeviceId(): string {
    const key = `${this.STORAGE_KEY_PREFIX}-device-id`;
    let deviceId = this.app.loadLocalStorage(key) as string | null;

    if (!deviceId) {
      deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      this.app.saveLocalStorage(key, deviceId);
    }

    return deviceId;
  }

  /**
   * Validate draft data structure
   */
  private isValidDraft(data: unknown): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const draft = data as Record<string, unknown>;
    return (
      typeof draft.id === 'string' &&
      typeof draft.content === 'string' &&
      typeof draft.timestamp === 'number' &&
      typeof draft.version === 'number'
    );
  }
}
