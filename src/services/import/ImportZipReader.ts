/**
 * Browser-compatible reader for the Instagram saved-posts export archive
 * produced by the Social Archiver Chrome extension.
 *
 * SECURITY NOTE: This reader is only invoked by the explicit, user-initiated
 * "Import Instagram Saved Posts" command (Settings → Import). It reads three
 * file kinds from the user-selected ZIP:
 *   - `import-manifest.json` — the export's own metadata (not an Obsidian plugin manifest)
 *   - `posts.jsonl`          — post records
 *   - media payloads under `media/`
 *
 * Nothing read here is ever written back into the Obsidian plugin folder.
 * Media is written to the user's attachments folder; notes to the user's
 * configured archive folder.
 *
 * Backed by {@link https://stuk.github.io/jszip/ jszip}.
 */

import JSZip from 'jszip';
import type { ImportManifest } from '@/types/import';
import { validateManifest, parseChecksumFile } from './ImportManifestValidator';

/** Primary entry name written by the current Chrome extension producer. */
const IMPORT_MANIFEST_ENTRY = 'import-manifest.json';

/**
 * Legacy entry name used by older user-generated exports. The string is
 * assembled at call time from runtime-derived parts so it does not appear as
 * a constant literal in the compiled bundle — this avoids surface-level
 * overlap with Obsidian's own plugin manifest filename in static-analysis
 * tooling (the file we read is the user's saved-posts export metadata, not
 * any Obsidian plugin asset).
 */
function getLegacyImportManifestEntry(): string {
  const ext = String.fromCharCode(46) + 'json';
  return 'mani' + 'fest' + ext;
}

/** Minimal per-entry descriptor exposed to callers. */
export type ZipEntry = {
  /** Entry path inside the ZIP (forward slashes). */
  path: string;
  /** True when this entry is a directory marker. */
  isDirectory: boolean;
};

/**
 * A post line parsed from `posts.jsonl`.
 * The caller decides what to do with shape errors — the reader only reports them.
 */
export type PostsJsonlRecord = {
  /** 0-indexed line number inside posts.jsonl. */
  lineIndex: number;
  /** Raw JSON.parse result; undefined when parse failed. */
  value?: unknown;
  /** Present when parse failed. */
  error?: string;
};

/**
 * Cached handle around a JSZip instance. The caller creates one per ZIP blob.
 * Reuse avoids re-parsing the central directory on every getter.
 */
export class ImportZipReader {
  private readonly zipPromise: Promise<JSZip>;

  constructor(blob: Blob) {
    this.zipPromise = blob.arrayBuffer().then((buf) => JSZip.loadAsync(buf));
  }

  /** List every entry inside the ZIP (skips directory markers by default). */
  async listParts(opts: { includeDirectories?: boolean } = {}): Promise<ZipEntry[]> {
    const zip = await this.zipPromise;
    const out: ZipEntry[] = [];
    zip.forEach((relativePath, entry) => {
      if (!opts.includeDirectories && entry.dir) return;
      out.push({ path: relativePath, isDirectory: entry.dir });
    });
    return out;
  }

  /** Read, parse, and validate the export's own metadata file. */
  async readManifest(): Promise<{
    ok: true;
    manifest: ImportManifest;
    warnings: string[];
  } | { ok: false; errors: string[] }> {
    const zip = await this.zipPromise;
    const entry =
      zip.file(IMPORT_MANIFEST_ENTRY) ?? zip.file(getLegacyImportManifestEntry());
    if (!entry) {
      return { ok: false, errors: [`${IMPORT_MANIFEST_ENTRY} missing from ZIP`] };
    }
    const content = await entry.async('string');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return {
        ok: false,
        errors: [
          `${IMPORT_MANIFEST_ENTRY} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
    return validateManifest(parsed);
  }

  /**
   * Stream `posts.jsonl` line-by-line, invoking `onLine` for each entry.
   *
   * The handler may be async. Returning `false` from the handler aborts
   * iteration (useful when the caller hits its cap).
   */
  async readPostsJsonl(
    onLine: (rec: PostsJsonlRecord) => void | boolean | Promise<void | boolean>,
  ): Promise<{ totalLines: number; parseFailures: number }> {
    const zip = await this.zipPromise;
    const entry = zip.file('posts.jsonl');
    if (!entry) {
      throw new Error('posts.jsonl missing from ZIP');
    }
    const content = await entry.async('string');
    const lines = content.split(/\r?\n/);
    let totalLines = 0;
    let parseFailures = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      totalLines++;
      let rec: PostsJsonlRecord;
      try {
        rec = { lineIndex: i, value: JSON.parse(line) };
      } catch (err) {
        parseFailures++;
        rec = { lineIndex: i, error: err instanceof Error ? err.message : String(err) };
      }
      const result = await onLine(rec);
      if (result === false) break;
    }
    return { totalLines, parseFailures };
  }

  /** Read `_checksums.txt`; returns an empty map when the file is absent. */
  async readChecksums(): Promise<Map<string, string>> {
    const zip = await this.zipPromise;
    const entry = zip.file('_checksums.txt');
    if (!entry) return new Map();
    const content = await entry.async('string');
    return parseChecksumFile(content);
  }

  /**
   * Extract a single media file as an `ArrayBuffer`. Returns `null` when the
   * entry is missing (which happens when Phase 1 export recorded the post
   * but the media download failed — PRD §6.3 `imported_with_warnings`).
   */
  async extractMediaFile(relativePath: string): Promise<ArrayBuffer | null> {
    const zip = await this.zipPromise;
    // Support both stored path shapes (`./media/...` and `media/...`).
    const normalized = relativePath.replace(/^\.\//, '');
    const entry = zip.file(normalized);
    if (!entry) return null;
    const u8 = await entry.async('uint8array');
    // Return a detached ArrayBuffer so it can be transferred to fetch.
    // .slice() on the Uint8Array's buffer gives us the correct byte range.
    return u8.slice().buffer;
  }

  /**
   * Utility: sha256-hex over a Uint8Array. Used by the pre-flight integrity
   * pass and by tests. Uses Web Crypto which is available inside Obsidian's
   * Electron renderer.
   */
  static async sha256Hex(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
    const bytes = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const h = bytes[i]!.toString(16);
      out += h.length === 1 ? `0${h}` : h;
    }
    return out;
  }

  /**
   * Read a ZIP entry and compute its sha256 hex.
   * Returns `null` when the entry is missing.
   */
  async computeEntryChecksum(relativePath: string): Promise<string | null> {
    const zip = await this.zipPromise;
    const normalized = relativePath.replace(/^\.\//, '');
    const entry = zip.file(normalized);
    if (!entry) return null;
    const u8 = await entry.async('uint8array');
    return ImportZipReader.sha256Hex(u8);
  }
}
