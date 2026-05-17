/**
 * ImportCliService — adapter between Obsidian CLI flag bags and the
 * existing `ImportOrchestrator` façade for Instagram Saved imports.
 *
 * Responsibilities (SRP):
 *   - Convert desktop absolute paths to the `{ name, blob }` shape the
 *     orchestrator expects.
 *   - Reject mobile platforms with `UNSUPPORTED_PLATFORM`.
 *   - Forward preflight/start/job-query/control through the same singleton
 *     orchestrator the modal uses.
 *   - Redact absolute paths in the response (collapsed to filename) unless
 *     the caller passed `verbose=true`.
 *
 * Does NOT:
 *   - Open the import modal.
 *   - Hold orchestrator references beyond the call duration.
 *   - Touch the Vault directly.
 */

import { Platform } from 'obsidian';
import type {
  ImportDestination,
  ImportItem,
  ImportJobState,
  ImportOrchestrator,
  ImportPreflightResult,
} from '@/types/import';

// ============================================================================
// Errors
// ============================================================================

export class ImportCliError extends Error {
  readonly code:
    | 'UNSUPPORTED_PLATFORM'
    | 'INVALID_ARGUMENT'
    | 'SERVICE_NOT_READY'
    | 'JOB_NOT_FOUND'
    | 'OPERATION_FAILED';
  constructor(
    code: ImportCliError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ImportCliError';
    this.code = code;
  }
}

// ============================================================================
// Public types
// ============================================================================

export interface ImportStartOptions {
  destination?: ImportDestination;
  tags?: string[];
  rateLimitPerSec?: number;
}

export interface ImportJobDTO {
  job: ImportJobState | null;
  items?: ImportItem[];
}

export interface ImportControlResult {
  jobId: string;
  action: 'pause' | 'resume' | 'cancel';
  status: ImportJobState['status'] | 'unknown';
}

/**
 * Plugin-level surface required by the import CLI.
 *
 * Both fields are lazy resolvers so the registry can defer orchestrator
 * construction until the user actually runs an import command.
 */
export interface ImportCliDeps {
  getOrchestrator: () => Promise<ImportOrchestrator>;
  /** Desktop-only file reader. Returns a Blob for the file at the given path. */
  readFileAsBlob: (absolutePath: string) => Promise<Blob>;
}

// ============================================================================
// Service
// ============================================================================

export class ImportCliService {
  constructor(private readonly deps: ImportCliDeps) {}

  /**
   * Read every desktop file path into an `{ name, blob }` tuple. Rejects
   * with `UNSUPPORTED_PLATFORM` on mobile.
   */
  async convertPathsToImportItems(
    absolutePaths: string[],
  ): Promise<Array<{ name: string; blob: Blob }>> {
    this.assertDesktop();
    if (!Array.isArray(absolutePaths) || absolutePaths.length === 0) {
      throw new ImportCliError('INVALID_ARGUMENT', 'At least one file path is required.');
    }

    const out: Array<{ name: string; blob: Blob }> = [];
    for (const abs of absolutePaths) {
      const name = filenameFromPath(abs);
      const blob = await this.deps.readFileAsBlob(abs);
      out.push({ name, blob });
    }
    return out;
  }

  /**
   * Preflight only — does not start any worker. Returns the same shape the
   * UI receives, with absolute paths redacted to filename unless `verbose`.
   */
  async preflight(
    absolutePaths: string[],
    opts: { verbose?: boolean } = {},
  ): Promise<ImportPreflightResult> {
    const files = await this.convertPathsToImportItems(absolutePaths);
    const orchestrator = await this.deps.getOrchestrator();
    const result = await orchestrator.preflight(files);
    return opts.verbose ? result : redactPreflight(result);
  }

  /**
   * Kick off the import. Returns immediately with the new jobId — does
   * NOT await terminal status.
   */
  async start(
    absolutePaths: string[],
    opts: ImportStartOptions = {},
  ): Promise<{ jobId: string }> {
    const files = await this.convertPathsToImportItems(absolutePaths);
    const orchestrator = await this.deps.getOrchestrator();
    return orchestrator.startImport({
      files,
      destination: opts.destination,
      tags: opts.tags,
      rateLimitPerSec: opts.rateLimitPerSec,
    });
  }

  /**
   * Fetch the persisted job state, optionally including per-item progress
   * when `items=true` is passed.
   */
  async getJob(
    jobId: string,
    opts: { items?: boolean } = {},
  ): Promise<ImportJobDTO> {
    this.assertDesktop();
    if (!jobId) throw new ImportCliError('INVALID_ARGUMENT', "'id' is required.");
    const orchestrator = await this.deps.getOrchestrator();
    const job = await orchestrator.getJob(jobId);
    if (!job) {
      throw new ImportCliError('JOB_NOT_FOUND', `Import job '${jobId}' was not found.`);
    }
    const items = opts.items ? await orchestrator.getItems(jobId) : undefined;
    return { job, items };
  }

  /** Pause/resume/cancel — forwards to the same orchestrator. */
  async control(
    jobId: string,
    action: 'pause' | 'resume' | 'cancel',
  ): Promise<ImportControlResult> {
    this.assertDesktop();
    if (!jobId) throw new ImportCliError('INVALID_ARGUMENT', "'id' is required.");
    const orchestrator = await this.deps.getOrchestrator();
    if (action === 'pause') await orchestrator.pause(jobId);
    else if (action === 'resume') await orchestrator.resume(jobId);
    else if (action === 'cancel') await orchestrator.cancel(jobId);
    else throw new ImportCliError('INVALID_ARGUMENT', `Unknown action '${action}'.`);

    const job = await orchestrator.getJob(jobId);
    return { jobId, action, status: job?.status ?? 'unknown' };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private assertDesktop(): void {
    const p = Platform as unknown as {
      isDesktopApp?: boolean;
      isDesktop?: boolean;
      isMobile?: boolean;
    };
    // Prefer the official `isDesktopApp` flag; fall back to `isDesktop`
    // when running under the test mock that does not expose the former.
    const isDesktop =
      p.isDesktopApp === true ||
      (p.isDesktopApp === undefined && p.isDesktop === true);
    if (!isDesktop) {
      throw new ImportCliError(
        'UNSUPPORTED_PLATFORM',
        'Instagram import is desktop-only — run this command from Obsidian Desktop.',
      );
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function filenameFromPath(absolutePath: string): string {
  if (!absolutePath) return '';
  const normalized = absolutePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Collapse absolute paths in `ImportPreflightResult` to filenames so they
 * never appear in the agent response.
 */
function redactPreflight(result: ImportPreflightResult): ImportPreflightResult {
  return {
    ...result,
    parts: result.parts.map((part) => ({
      ...part,
      filename: filenameFromPath(part.filename),
    })),
    errors: result.errors.map((e) => ({
      filename: filenameFromPath(e.filename),
      message: e.message,
    })),
  };
}
