/**
 * createImportOrchestrator — plugin-lifetime factory.
 *
 * Assembles the concrete engine from the plugin's existing infrastructure:
 *   - Durable job store bound to the plugin's vault configDir
 *   - ImportAPIClient adapter wrapping WorkersAPIClient for the new endpoints
 *   - ImportOrchestrator bound to both
 *
 * Called once from `main.ts` the first time the user opens the import flow.
 * Subsequent calls return the same instance.
 */

import type { Plugin } from 'obsidian';
import type { PostData } from '@/types/post';
import type { ImportLogger } from '@/types/import';
import { ImportJobStore } from './ImportJobStore';
import { ImportOrchestrator, type OrchestratorDeps } from './ImportOrchestrator';
import {
  createImportAPIClientAdapter,
  type AdapterHttp,
} from './ImportAPIClientAdapter';
import { MediaPreviewService } from '@/services/import-gallery/MediaPreviewService';

export interface CreateImportOrchestratorDeps {
  plugin: Plugin;
  /**
   * Small HTTP surface the adapter needs. Usually wired from WorkersAPIClient
   * but decoupled so tests can pass a fake.
   */
  http: AdapterHttp;
  logger: ImportLogger;
  /**
   * Invoked once per successful archive creation; the plugin passes its
   * existing archive → vault note pipeline here. Failures inside the hook
   * must not fail the upload (PRD §14 risks).
   */
  onArchiveCreated?: (archiveId: string, postData: PostData) => Promise<void>;
  /** Sync client id so the server can suppress self-replay (PRD §11.2). */
  sourceClientId?: string;
  /**
   * Base folder for vault media writes. Forwarded to the worker so
   * imported media lands next to regular archive attachments. Defaults
   * to `attachments/social-archives` if the caller omits it.
   */
  mediaBasePath?: string;
}

export async function createImportOrchestrator(
  deps: CreateImportOrchestratorDeps,
): Promise<ImportOrchestrator> {
  const { plugin, http, logger, onArchiveCreated, sourceClientId, mediaBasePath } = deps;

  const pluginDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
  const jobStore = new ImportJobStore(plugin.app.vault, pluginDir);
  await jobStore.load();

  const apiClient = createImportAPIClientAdapter(http);

  // One MediaPreviewService per orchestrator (PRD §9.2). Default capacity
  // is sized for the gallery's typical viewport — cards × media-per-card +
  // headroom for scroll buffer. The orchestrator hands `acquire`/`release`
  // off to the UI via `getMediaPreviewService()` and tears down the entries
  // on every terminal job event via `clearForJob`.
  const mediaPreviewService = new MediaPreviewService();

  const orchestratorDeps: OrchestratorDeps = {
    jobStore,
    apiClient,
    logger,
    onArchiveCreated,
    sourceClientId,
    vault: plugin.app.vault,
    mediaBasePath,
    mediaPreviewService,
  };

  return new ImportOrchestrator(orchestratorDeps);
}
