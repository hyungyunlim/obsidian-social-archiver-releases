/**
 * Validates a parsed `manifest.json` object against the Phase 1 export
 * schema v2 (PRD §7.3).
 *
 * Pure: no I/O, no Obsidian dependencies. The result is either a typed
 * {@link ImportManifest} or a list of human-readable error strings.
 */

import {
  SUPPORTED_MANIFEST_SCHEMA_VERSION,
  type ImportManifest,
  type ImportManifestCounts,
} from '@/types/import';

export type ManifestValidationResult =
  | { ok: true; manifest: ImportManifest; warnings: string[] }
  | { ok: false; errors: string[] };

const COUNT_FIELDS: Array<keyof ImportManifestCounts> = [
  'postsInPart',
  'postsInExport',
  'readyToImport',
  'partialMedia',
  'failedPosts',
  'mediaDownloaded',
  'mediaFailed',
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v;
}

/**
 * Validate a parsed JSON value as a schema-v2 manifest.
 *
 * Unknown extra keys are allowed (forward-compat), but structural mismatches
 * and missing required fields are errors.
 */
export function validateManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: ['manifest.json must be a JSON object'] };
  }

  // schemaVersion — hard gate
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== SUPPORTED_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `unsupported schemaVersion: expected ${SUPPORTED_MANIFEST_SCHEMA_VERSION}, got ${String(schemaVersion)}`,
    );
  }

  if (!isNonEmptyString(raw.exportId)) errors.push('exportId missing or not a string');
  if (!isNonNegativeInt(raw.partNumber) || raw.partNumber < 1) {
    errors.push('partNumber must be an integer >= 1');
  }
  if (!isNonNegativeInt(raw.totalParts) || raw.totalParts < 1) {
    errors.push('totalParts must be an integer >= 1');
  } else if (
    isNonNegativeInt(raw.partNumber) &&
    typeof raw.partNumber === 'number' &&
    raw.partNumber > raw.totalParts
  ) {
    errors.push(`partNumber (${raw.partNumber}) exceeds totalParts (${raw.totalParts})`);
  }

  if (!isNonEmptyString(raw.exportedAt)) errors.push('exportedAt missing');
  if (raw.platform !== 'instagram') errors.push(`platform must be "instagram", got ${String(raw.platform)}`);
  if (raw.source !== 'saved-posts') errors.push(`source must be "saved-posts", got ${String(raw.source)}`);

  if (!isNonEmptyString(raw.instagramUserId)) errors.push('instagramUserId missing');
  if (!isNonEmptyString(raw.instagramUsername)) errors.push('instagramUsername missing');

  // collection
  const collection = raw.collection;
  if (!isObject(collection)) {
    errors.push('collection block missing or not an object');
  } else {
    if (!isNonEmptyString(collection.id)) errors.push('collection.id missing');
    if (!isNonEmptyString(collection.name)) errors.push('collection.name missing');
    if (collection.scope !== 'named' && collection.scope !== 'all_saved_posts') {
      errors.push(`collection.scope must be "named" or "all_saved_posts", got ${String(collection.scope)}`);
    }
  }

  // app
  const app = raw.app;
  if (!isObject(app)) {
    errors.push('app block missing');
  } else {
    if (!isNonEmptyString(app.name)) errors.push('app.name missing');
    if (!isNonEmptyString(app.version)) errors.push('app.version missing');
  }

  // filters (present but may be empty per PRD §7.3)
  const filters = raw.filters;
  if (!isObject(filters)) {
    errors.push('filters block missing');
  } else {
    if (!Array.isArray(filters.collectionIds)) errors.push('filters.collectionIds must be an array');
    // dateFrom / dateTo may be null
    if (filters.dateFrom !== null && typeof filters.dateFrom !== 'string') {
      errors.push('filters.dateFrom must be string or null');
    }
    if (filters.dateTo !== null && typeof filters.dateTo !== 'string') {
      errors.push('filters.dateTo must be string or null');
    }
  }

  // counts
  const counts = raw.counts;
  if (!isObject(counts)) {
    errors.push('counts block missing');
  } else {
    for (const field of COUNT_FIELDS) {
      if (!isNonNegativeInt(counts[field])) {
        errors.push(`counts.${field} must be a non-negative integer`);
      }
    }
    // Soft-warn on suspicious values but do not fail the part.
    if (isNonNegativeInt(counts.readyToImport) && isNonNegativeInt(counts.postsInPart)) {
      if (counts.readyToImport > counts.postsInPart) {
        warnings.push(
          `counts.readyToImport (${counts.readyToImport}) exceeds counts.postsInPart (${counts.postsInPart})`,
        );
      }
    }
  }

  // integrity
  const integrity = raw.integrity;
  if (!isObject(integrity)) {
    errors.push('integrity block missing');
  } else {
    if (integrity.algorithm !== 'sha256') errors.push('integrity.algorithm must be "sha256"');
    if (!isNonEmptyString(integrity.checksumsFile)) errors.push('integrity.checksumsFile missing');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Safe cast — we've checked every field above.
  const manifest = raw as unknown as ImportManifest;
  return { ok: true, manifest, warnings };
}

/**
 * Parse `_checksums.txt` content.
 *
 * Format (matches the export side): one entry per line, `<sha256-hex><two-spaces><relative-path>`.
 * Blank lines tolerated.
 */
export function parseChecksumFile(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Split on the first run of 2+ spaces (compatible with exporter output).
    const match = trimmed.match(/^([0-9a-fA-F]{64})\s{2,}(.+)$/);
    if (!match) continue;
    const [, hash, path] = match;
    // path may have been written with forward slashes; normalize.
    out.set(path!.replace(/\\/g, '/'), hash!.toLowerCase());
  }
  return out;
}
