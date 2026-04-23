/**
 * Public surface for the Instagram Saved Posts import engine (Phase 2).
 *
 * UI / main.ts should import from this barrel rather than reaching into
 * individual modules.
 */

export { validateManifest, parseChecksumFile } from './ImportManifestValidator';
export type { ManifestValidationResult } from './ImportManifestValidator';
export { ImportZipReader } from './ImportZipReader';
export { ImportJobStore } from './ImportJobStore';
export { ImportProgressBus } from './ImportProgressBus';
export { ImportWorker } from './ImportWorker';
export {
  ImportOrchestrator,
  type OrchestratorDeps,
} from './ImportOrchestrator';
export type {
  OnArchiveCreatedHook,
  ImportWorkerDeps,
  ImportZipReaderResolver,
  PostDataResolver,
} from './ImportWorker';
export { createImportOrchestrator } from './createImportOrchestrator';
export type { CreateImportOrchestratorDeps } from './createImportOrchestrator';
export {
  createImportAPIClientAdapter,
  type AdapterHttp,
} from './ImportAPIClientAdapter';
