/**
 * ImportAPIClientAdapter
 *
 * Bridges the abstract `ImportAPIClient` contract (owned by
 * `src/types/import.ts`) to the concrete plugin HTTP stack (WorkersAPIClient
 * and Obsidian's `requestUrl`). The adapter exists so the import core stays
 * HTTP-stack-agnostic and testable against fakes.
 *
 * For the JSON endpoints we piggyback on `WorkersAPIClient`'s private
 * request path via a small public surface we add here. For multipart media
 * upload (PRD §10.3) we build the body manually and call `requestUrl`
 * directly, because WorkersAPIClient's internal `request` helper is JSON-only.
 */

import { requestUrl } from 'obsidian';
import type { Platform, PostData } from '@/types/post';
import type { ImportAPIClient } from '@/types/import';

/** Narrow WorkersAPIClient surface the adapter depends on. */
export interface AdapterHttp {
  /** Configured API base URL. */
  getEndpoint(): string;
  /** Current auth token (if any). */
  getAuthToken(): string | null;
  /** Plugin/client identity headers (X-Client etc.) already baked in. */
  getClientHeaders(): Record<string, string>;
}

type PreflightItem = { platform: Platform; postId: string };

type ImportContext = {
  source: 'instagram-saved-import';
  jobId: string;
  exportId: string;
  partNumber: number;
};

type CreateArchiveArgs = {
  url: string;
  clientPostData: PostData;
  importContext: ImportContext;
  sourceClientId?: string;
};

type UploadMediaFile = {
  filename: string;
  relativePath: string;
  contentType: string;
  data: ArrayBuffer;
};

type UploadMediaArgs = {
  archiveId: string;
  files: UploadMediaFile[];
};

type FinalizeArgs = {
  jobId: string;
  archiveIds: string[];
  totalCount: number;
  partialMediaCount: number;
  failedCount: number;
  sourceClientId?: string;
};

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Factory for the adapter. Keeping it a factory (not a class constructor)
 * keeps the UI-layer callers decoupled from internal typing.
 */
export function createImportAPIClientAdapter(http: AdapterHttp): ImportAPIClient {
  return new ImportAPIClientAdapter(http);
}

class ImportAPIClientAdapter implements ImportAPIClient {
  constructor(private readonly http: AdapterHttp) {}

  async preflight(
    items: PreflightItem[],
  ): Promise<{ duplicates: string[]; accepted: number }> {
    const data = await this.postJson<{ duplicates: string[]; accepted: number }>(
      '/api/import/preflight',
      { items },
    );
    return data;
  }

  async createArchiveFromImport(
    args: CreateArchiveArgs,
  ): Promise<{ archiveId: string; skippedDuplicate: boolean }> {
    // The server has two paths for duplicates:
    //   1. D1 dedup hit (checked BEFORE the import branch): reply has
    //      `result.cached === true`.
    //   2. Import branch, post was already archived when we reach it:
    //      reply has `result.skippedDuplicate === true`.
    // Both live inside `data.result` — after `postJson` unwraps `envelope.data`
    // we read off `raw.result`.
    const raw = await this.postJson<{
      jobId?: string;
      archiveId?: string;
      status?: string;
      result?: {
        archiveId?: string;
        cached?: boolean;
        skippedDuplicate?: boolean;
      };
    }>('/api/archive', {
      url: args.url,
      clientPostData: args.clientPostData,
      importContext: args.importContext,
      sourceClientId: args.sourceClientId,
    });

    const archiveId =
      raw.result?.archiveId ?? raw.archiveId ?? raw.jobId ?? '';
    if (!archiveId) {
      throw new Error('Server response missing archiveId.');
    }
    const skippedDuplicate =
      raw.result?.cached === true || raw.result?.skippedDuplicate === true;
    return { archiveId, skippedDuplicate };
  }

  async uploadArchiveMedia(
    args: UploadMediaArgs,
  ): Promise<{ uploaded: number; failed: Array<{ relativePath: string; reason: string }> }> {
    if (args.files.length === 0) {
      return { uploaded: 0, failed: [] };
    }

    const endpoint = `${this.http.getEndpoint()}/api/archive/${encodeURIComponent(args.archiveId)}/media`;
    const boundary = `----socialArchiverImport${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    const body = buildMultipartBody(args.files, boundary);

    const headers: Record<string, string> = {
      ...this.http.getClientHeaders(),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };
    const token = this.http.getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await requestUrl({
      url: endpoint,
      method: 'POST',
      headers,
      body,
      throw: false,
    });

    if (response.status >= 400) {
      const msg = extractErrorMessage(response.json) ?? `HTTP ${response.status}`;
      throw new Error(`uploadArchiveMedia failed: ${msg}`);
    }

    const parsed = response.json as ApiEnvelope<{
      uploaded: Array<{ filename: string; r2Url?: string }>;
      failed: Array<{ filename: string; error: string }>;
    }>;
    if (!parsed.success || !parsed.data) {
      throw new Error(parsed.error?.message ?? 'uploadArchiveMedia returned unsuccessful response');
    }

    const filenameToRelative = new Map<string, string>();
    for (const f of args.files) filenameToRelative.set(f.filename, f.relativePath);

    return {
      uploaded: parsed.data.uploaded.length,
      failed: parsed.data.failed.map((f) => ({
        relativePath: filenameToRelative.get(f.filename) ?? f.filename,
        reason: f.error,
      })),
    };
  }

  async finalizeImportJob(args: FinalizeArgs): Promise<void> {
    await this.postJson<{ batchesEmitted?: number; totalArchives?: number }>(
      `/api/import/jobs/${encodeURIComponent(args.jobId)}/finalize`,
      {
        archiveIds: args.archiveIds,
        totalCount: args.totalCount,
        partialMediaCount: args.partialMediaCount,
        failedCount: args.failedCount,
        sourceClientId: args.sourceClientId,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // JSON plumbing
  // ---------------------------------------------------------------------------

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.http.getEndpoint()}${path}`;
    const headers: Record<string, string> = {
      ...this.http.getClientHeaders(),
      'Content-Type': 'application/json',
    };
    const token = this.http.getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await requestUrl({
      url,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      throw: false,
    });

    if (response.status >= 400) {
      const msg = extractErrorMessage(response.json) ?? `HTTP ${response.status}`;
      throw new Error(`POST ${path} failed: ${msg}`);
    }

    const envelope = response.json as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === undefined) {
      throw new Error(envelope.error?.message ?? `POST ${path} returned unsuccessful response`);
    }
    return envelope.data;
  }
}

// ---------------------------------------------------------------------------
// Multipart body builder
// ---------------------------------------------------------------------------

function buildMultipartBody(files: UploadMediaFile[], boundary: string): ArrayBuffer {
  // Build each part's header + body into a Uint8Array, then concat.
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const f of files) {
    const partHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${escapeHeaderValue(f.filename)}"\r\n` +
      `Content-Type: ${f.contentType}\r\n\r\n`;
    chunks.push(encoder.encode(partHeader));
    chunks.push(new Uint8Array(f.data));
    chunks.push(encoder.encode('\r\n'));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

function escapeHeaderValue(v: string): string {
  // Filenames in our ZIP are always `NN-{type}.{ext}`. Still guard against
  // injection just in case a shortcode ever leaks in.
  return v.replace(/[\r\n"]/g, '_');
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const maybe = body as { error?: { message?: string } };
  return maybe.error?.message ?? null;
}
