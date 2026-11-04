/**
 * Device-local key-value store for BYOK state (catalog and model caches,
 * consent, validation results, notices): Obsidian's per-vault localStorage,
 * which Obsidian Sync does not carry. Never holds a key.
 */
import type { App } from 'obsidian';
import type { ByokKeyValueStore } from '../../vendor/byok-ai-core';

export function createObsidianByokStore(app: Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>): ByokKeyValueStore {
  return {
    get(key): Promise<string | null> {
      const value: unknown = app.loadLocalStorage(key);
      return Promise.resolve(typeof value === 'string' ? value : null);
    },
    set(key, value): Promise<void> {
      app.saveLocalStorage(key, value);
      return Promise.resolve();
    },
  };
}
