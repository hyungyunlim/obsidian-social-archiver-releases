/**
 * CliRegistry — owns `plugin.registerCliHandler(...)` calls and routes every
 * Social Archiver CLI invocation through `CliResponse` for shape/redaction.
 *
 * Design notes:
 *   - Service references are resolved LAZILY inside each handler body, never
 *     captured at registration time. This keeps registration order tolerant
 *     to feature controllers that initialize after `boot()` (e.g. editor
 *     TTS, BatchTranscriptionManager).
 *   - Every handler is wrapped in try/catch → `CliResponse.err()` so an
 *     unhandled rejection cannot leak a stack trace through Obsidian's CLI.
 *   - Three regions are pre-stubbed for downstream waves. Do not move the
 *     `// region: ...` markers — they are anchors for follow-up agents.
 */

import { Platform } from 'obsidian';
import type SocialArchiverPlugin from '../../main';
import type { CliData, CliHandler } from '../../types/obsidian-cli';
import {
  CliValidationError,
  parseBool,
  parseCsv,
  parseEnum,
  parseNumber,
  parseString,
  parseVaultPath,
  parseAbsolutePath,
  type CliParams,
} from './CliParams';
import {
  BILLING_FALLBACK_MESSAGE,
  err,
  format,
  ok,
  type CliFormat,
  type CliResponse,
  ErrorCode,
} from './CliResponse';
import {
  AI_COMMENT_FLAGS,
  AI_COMMENTS_FLAGS,
  AI_PROVIDERS_FLAGS,
  ARCHIVE_FLAGS,
  AUTHOR_NOTES_FLAGS,
  COMMAND_DESCRIPTIONS,
  COMMANDS,
  DEFAULT_FLAGS,
  GOOGLEMAPS_FLAGS,
  IMPORT_CONTROL_FLAGS,
  IMPORT_INSTAGRAM_FLAGS,
  IMPORT_JOB_FLAGS,
  JOB_FLAGS,
  JOBS_CHECK_FLAGS,
  JOBS_FLAGS,
  MEDIA_FLAGS,
  POST_FLAGS,
  PROFILE_CRAWL_FLAGS,
  SHARE_FLAGS,
  SUBSCRIBE_FLAGS,
  SYNC_FLAGS,
  TAGS_FLAGS,
  TAG_APPLY_FLAGS,
  TAG_CREATE_FLAGS,
  TRANSCRIBE_FLAGS,
  type CommandId,
} from './CliFlags';
import type {
  ArchiveCliOptions,
  CliArchiveMode,
  CliMediaMode,
  JobStatusSource,
  SyncTarget,
} from './ArchiveCliService';
import { JobNotFoundError } from './ArchiveCliService';
import { isPaywallRequiredError } from '../../utils/billingError';
import { LocalNoteCliService } from './LocalNoteCliService';
import { AICommentCliService, AICommentService_NotAvailableError } from './AICommentCliService';
import type { AICli, AICommentType, AIOutputLanguage } from '../../types/ai-comment';
import { ImportCliError, ImportCliService } from './ImportCliService';
import { ProfileCliService } from './ProfileCliService';
import { ProfileCrawlService } from '../services/ProfileCrawlService';
import { extractGoogleMapsLinks } from '../../utils/googleMapsLinks';

export interface CliBootResult {
  registered: boolean;
  reason?: string;
}

/** Lightweight surface on `Plugin` for the runtime guard. */
interface CliCapablePlugin {
  registerCliHandler?: (
    command: string,
    description: string,
    flags: import('../../types/obsidian-cli').CliFlags | null,
    handler: CliHandler,
  ) => void;
}

export class CliRegistry {
  constructor(private readonly plugin: SocialArchiverPlugin) {}

  /**
   * Register every CLI handler. Returns `{ registered: false }` when the
   * host runtime lacks `Plugin.registerCliHandler` so callers can log a
   * benign reason without failing plugin load.
   */
  boot(): CliBootResult {
    const host = this.plugin as unknown as CliCapablePlugin;
    if (typeof host.registerCliHandler !== 'function') {
      return { registered: false, reason: 'CLI_UNAVAILABLE' };
    }

    this.registerDefault();
    this.registerP0();
    this.registerP1();
    this.registerP2();

    return { registered: true };
  }

  // ---------------------------------------------------------------------------
  // Default `social-archiver` command (status)
  // ---------------------------------------------------------------------------

  private registerDefault(): void {
    this.register(COMMANDS.DEFAULT, DEFAULT_FLAGS, async (params) => {
      const fmt = this.readFormat(params);
      try {
        const data = this.collectStatus();
        return this.formatOk(COMMANDS.DEFAULT, data, fmt);
      } catch (e) {
        return this.formatErr(
          COMMANDS.DEFAULT,
          ErrorCode.OPERATION_FAILED,
          this.errorMessage(e),
          fmt,
        );
      }
    });
  }

  private collectStatus(): {
    pluginId: string;
    version: string;
    authenticated: boolean;
    username: string | undefined;
    vault: string;
    features: {
      archive: boolean;
      profileCrawl: boolean;
      instagramImport: boolean;
      batchTranscription: boolean;
    };
  } {
    const plugin = this.plugin;
    const manifest = plugin.manifest;
    const settings = plugin.settings;
    const username = settings?.username ? String(settings.username) : undefined;
    const authenticated = Boolean(settings?.authToken && username);
    const isDesktop = Boolean(Platform.isDesktopApp);
    return {
      pluginId: manifest.id,
      version: manifest.version,
      authenticated,
      username: authenticated ? username : undefined,
      vault: plugin.app.vault.getName(),
      features: {
        archive: true,
        profileCrawl: true,
        instagramImport: isDesktop,
        batchTranscription: isDesktop,
      },
    };
  }

  // region: P0
  // TODO(agent-A): Implement P0 handlers — archive, job, jobs, jobs:check, sync.
  // Each handler MUST:
  //   1. Resolve services lazily off `this.plugin.<field>` inside the handler.
  //   2. Wrap the body in try/catch and route errors via `this.formatErr(...)`.
  //   3. Honor `format=json|text` via `this.readFormat(params)`.
  //   4. Use `parseString`/`parseEnum`/`parseBool`/etc. from `./CliParams`.
  //   5. Surface billing errors with `ErrorCode.INSUFFICIENT_CREDITS` /
  //      `ErrorCode.PAYWALL_REQUIRED` and `BILLING_FALLBACK_MESSAGE`.
  private registerP0(): void {
    this.register(COMMANDS.ARCHIVE, ARCHIVE_FLAGS, (p) => this.archiveHandler(p));
    this.register(COMMANDS.JOB, JOB_FLAGS, (p) => this.jobHandler(p));
    this.register(COMMANDS.JOBS, JOBS_FLAGS, (p) => this.jobsHandler(p));
    this.register(COMMANDS.JOBS_CHECK, JOBS_CHECK_FLAGS, (p) => this.jobsCheckHandler(p));
    this.register(COMMANDS.SYNC, SYNC_FLAGS, (p) => this.syncHandler(p));
  }
  // endregion: P0

  // ---------------------------------------------------------------------------
  // P0 handlers
  // ---------------------------------------------------------------------------

  private async archiveHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const url = parseString(params, 'url', { required: true })!;
      const mode = (parseEnum(params, 'mode', ['queue', 'sync', 'fetch'] as const, {
        default: 'queue',
      }) ?? 'queue') as CliArchiveMode;
      const mediaMode = (parseEnum(params, 'media', ['all', 'images', 'none'] as const, {
        default: 'all',
      }) ?? 'all') as CliMediaMode;
      const includeComments = params['comments'] !== undefined
        ? parseBool(params, 'comments', false)
        : undefined;
      const includeTranscript = params['transcript'] !== undefined
        ? parseBool(params, 'transcript', false)
        : undefined;
      const includeFormattedTranscript = params['formattedTranscript'] !== undefined
        ? parseBool(params, 'formattedTranscript', false)
        : undefined;
      const tags = parseCsv(params, 'tags');
      const comment = parseString(params, 'comment');

      const opts: ArchiveCliOptions = {
        mediaMode,
        includeComments,
        includeTranscript,
        includeFormattedTranscript,
        tags: tags.length > 0 ? tags : undefined,
        comment,
      };

      const svc = this.plugin.archiveCliService;

      if (mode === 'queue') {
        const result = await svc.enqueueArchive(url, opts);
        return this.formatOk(COMMANDS.ARCHIVE, result, fmt);
      }
      if (mode === 'sync') {
        const result = await svc.runSyncArchive(url, opts);
        return this.formatOk(
          COMMANDS.ARCHIVE,
          {
            mode: 'sync',
            url,
            success: result.success,
            filePath: result.filePath,
            shareUrl: result.shareUrl,
            creditsUsed: result.creditsUsed,
            error: result.error,
          },
          fmt,
        );
      }
      // fetch
      const post = await svc.fetchOnly(url, opts);
      return this.formatOk(
        COMMANDS.ARCHIVE,
        {
          mode: 'fetch',
          url,
          post,
        },
        fmt,
      );
    } catch (e) {
      return this.formatArchiveError(COMMANDS.ARCHIVE, e, fmt);
    }
  }

  private async jobHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const id = parseString(params, 'id', { required: true })!;
      // Default source is `local` — Obsidian 1.12.7 CLI loses output when the
      // handler yields to the macrotask queue (e.g. network I/O). Local lookup
      // is synchronous-fast; agents that want server data should run
      // `jobs:check syncServer=true` first to pull server state into local,
      // then call `job source=local`.
      const source = (parseEnum(params, 'source', ['local', 'server', 'auto'] as const, {
        default: 'local',
      }) ?? 'local') as JobStatusSource;

      const svc = this.plugin.archiveCliService;
      const result = await svc.getJobStatus(id, source);
      return this.formatOk(COMMANDS.JOB, result, fmt);
    } catch (e) {
      if (e instanceof JobNotFoundError) {
        return this.formatErr(COMMANDS.JOB, ErrorCode.JOB_NOT_FOUND, e.message, fmt);
      }
      return this.formatArchiveError(COMMANDS.JOB, e, fmt);
    }
  }

  private async jobsHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const status = parseEnum(
        params,
        'status',
        ['pending', 'processing', 'completed', 'failed', 'cancelled', 'all'] as const,
      );
      const limit = parseNumber(params, 'limit', { integer: true, min: 1, max: 200 });

      const svc = this.plugin.archiveCliService;
      const jobs = await svc.listJobs({ status, limit });
      return this.formatOk(COMMANDS.JOBS, { count: jobs.length, jobs }, fmt);
    } catch (e) {
      return this.formatArchiveError(COMMANDS.JOBS, e, fmt);
    }
  }

  private async jobsCheckHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const syncServer = parseBool(params, 'syncServer', false);
      const svc = this.plugin.archiveCliService;
      // Fire-and-forget: Obsidian 1.12.7 CLI drops handler output when the
      // handler yields to the macrotask queue. Schedule the work and return
      // immediately so agents always get an envelope. Poll `jobs status=...`
      // afterwards to observe results.
      const scheduled = svc.scheduleJobsCheck({ syncServer });
      return this.formatOk(COMMANDS.JOBS_CHECK, scheduled, fmt);
    } catch (e) {
      return this.formatArchiveError(COMMANDS.JOBS_CHECK, e, fmt);
    }
  }

  private async syncHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const target = (parseEnum(
        params,
        'target',
        ['subscriptions', 'library', 'pending', 'all'] as const,
        { default: 'all' },
      ) ?? 'all') as SyncTarget;
      const syncServer = parseBool(params, 'syncServer', false);

      const svc = this.plugin.archiveCliService;
      // Same fire-and-forget rationale as jobs:check.
      const scheduled = svc.scheduleSync(target, { syncServer });
      return this.formatOk(COMMANDS.SYNC, scheduled, fmt);
    } catch (e) {
      return this.formatArchiveError(COMMANDS.SYNC, e, fmt);
    }
  }

  /**
   * Map archive/server errors to canonical CLI error codes. Centralizes:
   *   - paywall / credit detection → INSUFFICIENT_CREDITS + billing fallback.
   *   - rate limit / network / circuit / doc_id hints.
   *   - CliValidationError → INVALID_ARGUMENT (already handled in `register`
   *     wrapper, but the inner try/catch routes here too).
   */
  private formatArchiveError(command: string, error: unknown, fmt: CliFormat): string {
    if (error instanceof CliValidationError) {
      return this.formatErr(command, ErrorCode.INVALID_ARGUMENT, error.message, fmt, {
        details: { field: error.field },
      });
    }

    if (isPaywallRequiredError(error)) {
      return this.formatErr(command, ErrorCode.INSUFFICIENT_CREDITS, BILLING_FALLBACK_MESSAGE, fmt);
    }

    const message = this.errorMessage(error);
    const lowered = message.toLowerCase();

    if (
      lowered.includes('insufficient_credits') ||
      lowered.includes('insufficient credits') ||
      lowered.includes('monthly archive limit reached')
    ) {
      return this.formatErr(command, ErrorCode.INSUFFICIENT_CREDITS, BILLING_FALLBACK_MESSAGE, fmt);
    }
    if (lowered.includes('rate_limited') || lowered.includes('rate limit')) {
      return this.formatErr(command, ErrorCode.RATE_LIMITED, message, fmt);
    }
    if (lowered.includes('circuit_open')) {
      return this.formatErr(command, ErrorCode.CIRCUIT_OPEN, message, fmt);
    }
    if (lowered.includes('doc_id_stale')) {
      return this.formatErr(command, ErrorCode.DOC_ID_STALE, message, fmt);
    }
    if (
      lowered.includes('not initialized') ||
      lowered.includes('service_not_ready') ||
      lowered.includes('not configured')
    ) {
      return this.formatErr(command, ErrorCode.SERVICE_NOT_READY, message, fmt);
    }
    if (
      lowered.includes('network') ||
      lowered.includes('fetch failed') ||
      lowered.includes('econnreset') ||
      lowered.includes('enotfound')
    ) {
      return this.formatErr(command, ErrorCode.NETWORK_ERROR, message, fmt);
    }
    if (lowered.includes('timeout') || lowered.includes('timed out')) {
      return this.formatErr(command, ErrorCode.TIMEOUT_ERROR, message, fmt);
    }

    return this.formatErr(command, ErrorCode.OPERATION_FAILED, message, fmt);
  }

  // region: P1
  // TODO(agent-B): Implement P1 handlers — profile-crawl, subscribe, googlemaps,
  // import-instagram, import-job, import-control. Follow the same conventions
  // described in the P0 region above. Note that Instagram import + Google Maps
  // batch require desktop — guard with `Platform.isDesktopApp` and emit
  // `UNSUPPORTED_PLATFORM` when not on desktop where applicable.
  private registerP1(): void {
    this.register(COMMANDS.PROFILE_CRAWL, PROFILE_CRAWL_FLAGS, (p) => this.profileCrawlHandler(p));
    this.register(COMMANDS.SUBSCRIBE, SUBSCRIBE_FLAGS, (p) => this.subscribeHandler(p));
    this.register(COMMANDS.GOOGLEMAPS, GOOGLEMAPS_FLAGS, (p) => this.googleMapsHandler(p));
    this.register(COMMANDS.IMPORT_INSTAGRAM, IMPORT_INSTAGRAM_FLAGS, (p) => this.importInstagramHandler(p));
    this.register(COMMANDS.IMPORT_JOB, IMPORT_JOB_FLAGS, (p) => this.importJobHandler(p));
    this.register(COMMANDS.IMPORT_CONTROL, IMPORT_CONTROL_FLAGS, (p) => this.importControlHandler(p));
  }
  // endregion: P1

  // ---------------------------------------------------------------------------
  // P1 handlers
  // ---------------------------------------------------------------------------

  /** Lazily build the `ProfileCliService` adapter (no caching needed). */
  private getProfileCliService(): ProfileCliService {
    const plugin = this.plugin;
    const service = new ProfileCrawlService({
      workersApiClient: () => {
        // The plugin exposes `workersApiClient` as a throwing getter once
        // settings have been configured. Catch the throw so the service
        // can surface a `SERVICE_NOT_READY` instead of a stack trace.
        try {
          return plugin.workersApiClient;
        } catch {
          return undefined;
        }
      },
      defaultFolder: () => plugin.settings?.archivePath ?? 'Social Archives',
    });
    return new ProfileCliService(service);
  }

  /**
   * Build the `ImportCliService` with a desktop-only Node `fs` reader.
   * Throws `UNSUPPORTED_PLATFORM` at call time if invoked on mobile — the
   * service guard catches that anyway, but this stays explicit.
   */
  private getImportCliService(): ImportCliService {
    const pluginAny = this.plugin as unknown as {
      getImportOrchestrator: () => Promise<unknown>;
    };
    return new ImportCliService({
      getOrchestrator: () => pluginAny.getImportOrchestrator() as Promise<import('@/types/import').ImportOrchestrator>,
      readFileAsBlob: async (absolutePath: string) => {
        // Node's `fs/promises` is only available in the desktop bundle.
        // The Platform guard in ImportCliService catches mobile callers
        // before we get here.
        const fs = await import('node:fs/promises');
        const data = await fs.readFile(absolutePath);
        // Convert Uint8Array → Blob without bringing in Buffer typings.
        const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return new Blob([u8]);
      },
    });
  }

  private async profileCrawlHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const adapter = this.getProfileCliService();
      const result = await adapter.crawl(params);
      return this.formatOk(COMMANDS.PROFILE_CRAWL, result, fmt);
    } catch (e) {
      return this.formatArchiveError(COMMANDS.PROFILE_CRAWL, e, fmt);
    }
  }

  private async subscribeHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const adapter = this.getProfileCliService();
      const result = await adapter.subscribe(params);
      return this.formatOk(COMMANDS.SUBSCRIBE, result, fmt);
    } catch (e) {
      return this.formatArchiveError(COMMANDS.SUBSCRIBE, e, fmt);
    }
  }

  /**
   * Google Maps batch archive — accepts `path` (vault path), `content`
   * (inline text), or `urls` (csv). Exactly one is required.
   *
   * Without `yes`, the handler runs a dry-run that reports the extracted
   * links so an agent can confirm before paying credits. With `yes=true`
   * the batch is sent through to the Worker.
   */
  private async googleMapsHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const path = parseVaultPath(params, 'path', this.plugin.app);
      const content = parseString(params, 'content');
      const urlsCsv = parseCsv(params, 'urls');
      const max = parseNumber(params, 'max', { integer: true, min: 1, max: 20 });
      const confirmed = parseBool(params, 'yes');

      const sources = [path, content, urlsCsv.length > 0 ? 'urls' : undefined].filter(Boolean);
      if (sources.length === 0) {
        throw new CliValidationError(
          'path',
          "Provide exactly one of 'path', 'content', or 'urls'.",
        );
      }
      if (sources.length > 1) {
        throw new CliValidationError(
          'path',
          "Provide exactly one of 'path', 'content', or 'urls' — not multiple.",
        );
      }

      let links: string[];
      let sourceNotePath: string | undefined;
      if (urlsCsv.length > 0) {
        links = urlsCsv.slice(0, max ?? urlsCsv.length);
      } else if (content) {
        links = extractGoogleMapsLinks(content, { max });
      } else if (path) {
        sourceNotePath = path;
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!file || !('extension' in file)) {
          throw new CliValidationError('path', `Vault path '${path}' is not a readable file.`);
        }
        const raw = await this.plugin.app.vault.read(file as import('obsidian').TFile);
        links = extractGoogleMapsLinks(raw, { max });
      } else {
        // Defensive — already validated above, but keeps the compiler happy.
        links = [];
      }

      if (!confirmed) {
        return this.formatOk(
          COMMANDS.GOOGLEMAPS,
          {
            dryRun: true,
            wouldArchive: links.length,
            extractedLinks: links,
            hint: "Re-run with yes=true to submit the batch.",
          },
          fmt,
        );
      }

      if (links.length === 0) {
        return this.formatOk(
          COMMANDS.GOOGLEMAPS,
          { batchJobId: '', urlCount: 0, createdDocCount: 0, failedCount: 0, createdPaths: [] },
          fmt,
        );
      }

      const pluginAny = this.plugin as unknown as {
        runGoogleMapsBatch?: (links: string[], notePath?: string) => Promise<unknown>;
      };
      if (typeof pluginAny.runGoogleMapsBatch !== 'function') {
        throw new Error('Google Maps batch archiver is not initialized.');
      }
      const batch = await pluginAny.runGoogleMapsBatch(links, sourceNotePath);
      return this.formatOk(COMMANDS.GOOGLEMAPS, batch as Record<string, unknown>, fmt);
    } catch (e) {
      return this.formatArchiveError(COMMANDS.GOOGLEMAPS, e, fmt);
    }
  }

  private async importInstagramHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      if (!Platform.isDesktopApp) {
        return this.formatErr(
          COMMANDS.IMPORT_INSTAGRAM,
          ErrorCode.UNSUPPORTED_PLATFORM,
          'Instagram import is desktop-only — run this command from Obsidian Desktop.',
          fmt,
        );
      }

      const filesCsv = parseCsv(params, 'files');
      if (filesCsv.length === 0) {
        throw new CliValidationError('files', "'files' is required (comma-separated absolute paths).");
      }
      // Validate each path is absolute before we touch the filesystem.
      for (const candidate of filesCsv) {
        parseAbsolutePath({ __tmp: candidate } as CliParams, '__tmp', { required: true });
      }
      const destination = parseEnum(params, 'destination', ['inbox', 'archive'] as const) ?? undefined;
      const tags = parseCsv(params, 'tags');
      const rate = parseNumber(params, 'rate', { min: 0.1, max: 10 });
      const preflightOnly = parseBool(params, 'preflight');
      const verbose = parseBool(params, 'verbose');

      const adapter = this.getImportCliService();
      if (preflightOnly) {
        const result = await adapter.preflight(filesCsv, { verbose });
        return this.formatOk(
          COMMANDS.IMPORT_INSTAGRAM,
          {
            preflight: true,
            totalPostsInSelection: result.totalPostsInSelection,
            readyToImport: result.readyToImport,
            duplicateCount: result.duplicateCount,
            partialMedia: result.partialMedia,
            failedPosts: result.failedPosts,
            parts: result.parts.map((p) => ({
              filename: p.filename,
              exportId: p.exportId,
              partNumber: p.partNumber,
              totalParts: p.totalParts,
              integrityOk: p.integrityOk,
              counts: p.counts,
              warnings: p.warnings,
            })),
            errors: result.errors,
          },
          fmt,
        );
      }

      const { jobId } = await adapter.start(filesCsv, {
        destination,
        tags: tags.length > 0 ? tags : undefined,
        rateLimitPerSec: rate,
      });
      return this.formatOk(COMMANDS.IMPORT_INSTAGRAM, { jobId, status: 'queued' }, fmt);
    } catch (e) {
      return this.formatImportError(COMMANDS.IMPORT_INSTAGRAM, e, fmt);
    }
  }

  private async importJobHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      if (!Platform.isDesktopApp) {
        return this.formatErr(
          COMMANDS.IMPORT_JOB,
          ErrorCode.UNSUPPORTED_PLATFORM,
          'Instagram import is desktop-only — run this command from Obsidian Desktop.',
          fmt,
        );
      }
      const jobId = parseString(params, 'id', { required: true })!;
      const includeItems = parseBool(params, 'items');
      const adapter = this.getImportCliService();
      const dto = await adapter.getJob(jobId, { items: includeItems });
      return this.formatOk(COMMANDS.IMPORT_JOB, dto, fmt);
    } catch (e) {
      return this.formatImportError(COMMANDS.IMPORT_JOB, e, fmt);
    }
  }

  private async importControlHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      if (!Platform.isDesktopApp) {
        return this.formatErr(
          COMMANDS.IMPORT_CONTROL,
          ErrorCode.UNSUPPORTED_PLATFORM,
          'Instagram import is desktop-only — run this command from Obsidian Desktop.',
          fmt,
        );
      }
      const jobId = parseString(params, 'id', { required: true })!;
      const action = parseEnum(params, 'action', ['pause', 'resume', 'cancel'] as const, {
        required: true,
      })!;
      const adapter = this.getImportCliService();
      const result = await adapter.control(jobId, action);
      return this.formatOk(COMMANDS.IMPORT_CONTROL, result, fmt);
    } catch (e) {
      return this.formatImportError(COMMANDS.IMPORT_CONTROL, e, fmt);
    }
  }

  /**
   * Map `ImportCliError`-typed failures to canonical CLI error codes; falls
   * back to `formatArchiveError` for generic Worker/network errors.
   */
  private formatImportError(command: string, error: unknown, fmt: CliFormat): string {
    if (error instanceof ImportCliError) {
      const code = error.code === 'UNSUPPORTED_PLATFORM'
        ? ErrorCode.UNSUPPORTED_PLATFORM
        : error.code === 'JOB_NOT_FOUND'
          ? ErrorCode.JOB_NOT_FOUND
          : error.code === 'SERVICE_NOT_READY'
            ? ErrorCode.SERVICE_NOT_READY
            : error.code === 'INVALID_ARGUMENT'
              ? ErrorCode.INVALID_ARGUMENT
              : ErrorCode.OPERATION_FAILED;
      return this.formatErr(command, code, error.message, fmt);
    }
    return this.formatArchiveError(command, error, fmt);
  }

  // region: P2
  // TODO(agent-C): Implement P2 handlers — post, share, tags, tag-create,
  // tag-apply, transcribe, media, author-notes. `transcribe` and
  // `author-notes` may need `SERVICE_NOT_READY` when the corresponding
  // controller has not finished initializing yet.
  private registerP2(): void {
    this.register(COMMANDS.POST, POST_FLAGS, (p) => this.postHandler(p));
    this.register(COMMANDS.SHARE, SHARE_FLAGS, (p) => this.shareHandler(p));
    this.register(COMMANDS.TAGS, TAGS_FLAGS, (p) => this.tagsHandler(p));
    this.register(COMMANDS.TAG_CREATE, TAG_CREATE_FLAGS, (p) => this.tagCreateHandler(p));
    this.register(COMMANDS.TAG_APPLY, TAG_APPLY_FLAGS, (p) => this.tagApplyHandler(p));
    this.register(COMMANDS.MEDIA, MEDIA_FLAGS, (p) => this.mediaHandler(p));
    this.register(COMMANDS.AUTHOR_NOTES, AUTHOR_NOTES_FLAGS, (p) => this.authorNotesHandler(p));
    this.register(COMMANDS.TRANSCRIBE, TRANSCRIBE_FLAGS, (p) => this.transcribeHandler(p));
    this.register(COMMANDS.AI_COMMENT, AI_COMMENT_FLAGS, (p) => this.aiCommentHandler(p));
    this.register(COMMANDS.AI_COMMENTS, AI_COMMENTS_FLAGS, (p) => this.aiCommentsHandler(p));
    this.register(COMMANDS.AI_PROVIDERS, AI_PROVIDERS_FLAGS, (p) => this.aiProvidersHandler(p));
  }
  // endregion: P2

  // ---------------------------------------------------------------------------
  // P2 handlers
  // ---------------------------------------------------------------------------

  /**
   * Lazily build a `LocalNoteCliService`. Cached per registry instance so
   * downstream callers don't pay the construction cost on every command.
   */
  private localNoteService?: LocalNoteCliService;
  private getLocalNoteService(): LocalNoteCliService {
    if (!this.localNoteService) {
      this.localNoteService = new LocalNoteCliService(this.plugin);
    }
    return this.localNoteService;
  }

  /**
   * Resolve `path` (vault-relative) OR `active` (bare flag) into a single
   * value the {@link LocalNoteCliService} understands. Exactly one of the
   * two must be supplied; missing or both → INVALID_ARGUMENT.
   */
  private resolveTargetNote(params: CliParams, field: 'path' = 'path'): string | 'active' {
    const useActive = params['active'] !== undefined ? parseBool(params, 'active', false) : false;
    const path = parseVaultPath(params, field, this.plugin.app, { required: false });
    if (useActive && path) {
      throw new CliValidationError(
        field,
        "Pass exactly one of 'path=<vault-path>' or 'active' — not both.",
      );
    }
    if (!useActive && !path) {
      throw new CliValidationError(
        field,
        "Provide 'path=<vault-path>' or the bare 'active' flag to select a note.",
      );
    }
    return useActive ? 'active' : (path as string);
  }

  private async postHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const target = this.resolveTargetNote(params);
      const result = await this.getLocalNoteService().post(target);
      return this.formatOk(COMMANDS.POST, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.POST, e, fmt);
    }
  }

  private async shareHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const target = this.resolveTargetNote(params);
      const reader = parseBool(params, 'reader', false);
      const result = await this.getLocalNoteService().share(target, { reader });
      return this.formatOk(COMMANDS.SHARE, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.SHARE, e, fmt);
    }
  }

  private async tagsHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const counts = parseBool(params, 'counts', false);
      const result = this.getLocalNoteService().tagsList({ counts });
      return this.formatOk(COMMANDS.TAGS, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.TAGS, e, fmt);
    }
  }

  private async tagCreateHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const name = parseString(params, 'name', { required: true })!;
      const color = parseString(params, 'color');
      const tag = await this.getLocalNoteService().tagCreate(name, color);
      return this.formatOk(COMMANDS.TAG_CREATE, tag, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.TAG_CREATE, e, fmt);
    }
  }

  private async tagApplyHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const path = parseVaultPath(params, 'path', this.plugin.app, { required: true })!;
      const tag = parseString(params, 'tag', { required: true })!;
      const action = (parseEnum(params, 'action', ['add', 'remove', 'toggle'] as const, {
        default: 'toggle',
      }) ?? 'toggle') as 'add' | 'remove' | 'toggle';
      const result = await this.getLocalNoteService().tagApply(path, tag, action);
      return this.formatOk(COMMANDS.TAG_APPLY, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.TAG_APPLY, e, fmt);
    }
  }

  private async mediaHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const target = this.resolveTargetNote(params);
      const action = parseEnum(
        params,
        'action',
        ['redownload-expired', 'detach', 'redownload-detached'] as const,
        { required: true },
      ) as 'redownload-expired' | 'detach' | 'redownload-detached';
      const result = await this.getLocalNoteService().media(target, action);
      return this.formatOk(COMMANDS.MEDIA, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.MEDIA, e, fmt);
    }
  }

  private async authorNotesHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const dryRun = parseBool(params, 'dryRun', false);
      const limit = parseNumber(params, 'limit', { integer: true, min: 0, max: 10000 });
      const result = await this.getLocalNoteService().authorNotes({
        dryRun,
        ...(typeof limit === 'number' ? { limit } : {}),
      });
      return this.formatOk(COMMANDS.AUTHOR_NOTES, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.AUTHOR_NOTES, e, fmt);
    }
  }

  private async transcribeHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const action = parseEnum(
        params,
        'action',
        ['start', 'pause', 'resume', 'cancel', 'status'] as const,
        { required: true },
      ) as 'start' | 'pause' | 'resume' | 'cancel' | 'status';
      const mode = parseEnum(
        params,
        'mode',
        ['transcribe-only', 'download-and-transcribe'] as const,
      );
      const result = await this.getLocalNoteService().transcribe({
        action,
        ...(mode ? { mode } : {}),
      });
      return this.formatOk(COMMANDS.TRANSCRIBE, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.TRANSCRIBE, e, fmt);
    }
  }

  /**
   * Lazily build an AICommentCliService. Cached per registry.
   */
  private aiCommentService?: AICommentCliService;
  private getAiCommentService(): AICommentCliService {
    if (!this.aiCommentService) {
      this.aiCommentService = new AICommentCliService(this.plugin);
    }
    return this.aiCommentService;
  }

  private aiCommentHandler(params: CliParams): string {
    const fmt = this.readFormat(params);
    try {
      const path = parseVaultPath(params, 'path', this.plugin.app, { required: true })!;
      const type = parseEnum(
        params,
        'type',
        [
          'summary',
          'factcheck',
          'critique',
          'keypoints',
          'sentiment',
          'connections',
          'translation',
          'translate-transcript',
          'glossary',
          'reformat',
          'custom',
        ] as const,
        { required: true },
      ) as AICommentType;
      const provider = parseEnum(params, 'provider', ['claude', 'gemini', 'codex'] as const) as
        | AICli
        | undefined;
      const customPrompt = parseString(params, 'prompt');
      const targetLanguage = parseString(params, 'language');
      const outputLanguageRaw = parseString(params, 'outputLanguage');
      const outputLanguage = outputLanguageRaw ? (outputLanguageRaw as AIOutputLanguage) : undefined;

      const result = this.getAiCommentService().scheduleGenerate(path, {
        type,
        ...(provider ? { provider } : {}),
        ...(customPrompt ? { customPrompt } : {}),
        ...(targetLanguage ? { targetLanguage } : {}),
        ...(outputLanguage ? { outputLanguage } : {}),
      });
      return this.formatOk(COMMANDS.AI_COMMENT, result, fmt);
    } catch (e) {
      if (e instanceof AICommentService_NotAvailableError) {
        return this.formatErr(COMMANDS.AI_COMMENT, ErrorCode.INVALID_ARGUMENT, e.message, fmt);
      }
      return this.formatP2Error(COMMANDS.AI_COMMENT, e, fmt);
    }
  }

  private async aiCommentsHandler(params: CliParams): Promise<string> {
    const fmt = this.readFormat(params);
    try {
      const path = parseVaultPath(params, 'path', this.plugin.app, { required: true })!;
      const result = await this.getAiCommentService().listComments(path);
      return this.formatOk(COMMANDS.AI_COMMENTS, result, fmt);
    } catch (e) {
      if (e instanceof AICommentService_NotAvailableError) {
        return this.formatErr(COMMANDS.AI_COMMENTS, ErrorCode.INVALID_ARGUMENT, e.message, fmt);
      }
      return this.formatP2Error(COMMANDS.AI_COMMENTS, e, fmt);
    }
  }

  private aiProvidersHandler(params: CliParams): string {
    const fmt = this.readFormat(params);
    try {
      const result = this.getAiCommentService().detectProviders();
      return this.formatOk(COMMANDS.AI_PROVIDERS, result, fmt);
    } catch (e) {
      return this.formatP2Error(COMMANDS.AI_PROVIDERS, e, fmt);
    }
  }

  /**
   * P2-specific error mapping. Validation errors get INVALID_ARGUMENT; all
   * other errors fall through to the same heuristics used for archive errors
   * (rate limit, network, service not ready) so the agent-facing surface
   * stays uniform across waves.
   */
  private formatP2Error(command: string, error: unknown, fmt: CliFormat): string {
    if (error instanceof CliValidationError) {
      return this.formatErr(command, ErrorCode.INVALID_ARGUMENT, error.message, fmt, {
        details: { field: error.field },
      });
    }
    return this.formatArchiveError(command, error, fmt);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Internal `registerCliHandler` wrapper that:
   *   - Forwards the typed `CliFlags` object to Obsidian.
   *   - Catches synchronous AND asynchronous handler errors so they cannot
   *     escape into Obsidian's runtime as unhandled rejections.
   */
  private register(
    command: CommandId,
    flags: import('../../types/obsidian-cli').CliFlags,
    handler: (params: CliParams) => Promise<string> | string,
  ): void {
    const host = this.plugin as unknown as CliCapablePlugin;
    if (typeof host.registerCliHandler !== 'function') return; // should never hit; defensive

    const wrapped: CliHandler = async (rawParams: CliData) => {
      const params = rawParams as unknown as CliParams;
      try {
        return await Promise.resolve(handler(params));
      } catch (e) {
        const fmt = this.readFormat(params);
        if (e instanceof CliValidationError) {
          return this.formatErr(command, ErrorCode.INVALID_ARGUMENT, e.message, fmt, {
            details: { field: e.field },
          });
        }
        return this.formatErr(command, ErrorCode.OPERATION_FAILED, this.errorMessage(e), fmt);
      }
    };

    host.registerCliHandler!(command, COMMAND_DESCRIPTIONS[command], flags, wrapped);
  }

  /** Read the `format` flag with safe defaults; never throws. */
  private readFormat(params: CliParams): CliFormat {
    try {
      return parseEnum(params, 'format', ['json', 'text'] as const, { default: 'json' }) ?? 'json';
    } catch {
      return 'json';
    }
  }

  private formatOk<T>(command: string, data: T, fmt: CliFormat, warnings?: string[]): string {
    const envelope = ok(command, this.plugin.manifest.version, data, { warnings });
    return format(envelope, fmt);
  }

  private formatErr(
    command: string,
    code: string,
    message: string,
    fmt: CliFormat,
    opts: { details?: Record<string, unknown>; retryable?: boolean; warnings?: string[] } = {},
  ): string {
    const envelope: CliResponse<never> = err(command, this.plugin.manifest.version, code, message, opts);
    return format(envelope, fmt);
  }

  private errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try {
      return JSON.stringify(e);
    } catch {
      return 'Unknown error';
    }
  }
}
