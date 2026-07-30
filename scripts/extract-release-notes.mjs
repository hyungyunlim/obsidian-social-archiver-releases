#!/usr/bin/env node
/**
 * Print the release notes for a version, read from `src/release-notes.ts`.
 *
 * The release workflow used to create the GitHub release with `--draft` and no
 * `--notes`, so every release was published with an empty body unless somebody
 * remembered to paste one in by hand. That also meant the in-app notes and the
 * GitHub notes were written separately and could disagree. This makes
 * `src/release-notes.ts` — which is synced from the private repo and ships in
 * the plugin — the single source for both.
 *
 * Usage:  node scripts/extract-release-notes.mjs 4.5.0 [--footer]
 * Exits 1 when the version has no entry, which is normal: patches without
 * notable changes deliberately have none, and the caller falls back to
 * GitHub's generated notes.
 *
 * Parsed rather than imported because the file is TypeScript and this has to
 * run under plain node in CI with no build step. The shape it depends on is
 * narrow — a quoted version key, then a `notes:` template literal — and
 * `--check` verifies every entry still parses so a format change fails loudly
 * instead of silently emitting nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', 'src', 'release-notes.ts');
const FOOTER = '\n---\n\nFull release notes: https://social-archive.org/release-notes\n';

/** Read a template literal starting at `open` (the index of its backtick). */
function readTemplateLiteral(source, open) {
  let out = '';
  for (let i = open + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      // Template-literal escape: keep the escaped character verbatim. This is
      // what turns \` back into a real backtick — release notes use inline code.
      const next = source[i + 1];
      if (next === undefined) break;
      out += next === '`' || next === '\\' || next === '$' ? next : `\\${next}`;
      i += 1;
      continue;
    }
    if (ch === '`') return { value: out, end: i };
    out += ch;
  }
  throw new Error('unterminated template literal in release-notes.ts');
}

export function extractNotes(source, version) {
  // Located by plain search rather than a built regex: the version is
  // interpolated, and a mis-escaped character class here fails by finding
  // nothing, which looks exactly like "this version has no notes".
  const keyAt = [`'${version}':`, `"${version}":`]
    .map((key) => source.indexOf(key))
    .filter((at) => at >= 0)
    .sort((a, b) => a - b)[0];
  if (keyAt === undefined) return null;

  const entryAt = source.indexOf('{', keyAt);
  if (entryAt < 0) return null;

  const notesAt = source.indexOf('notes:', entryAt);
  if (notesAt < 0) return null;

  const backtick = source.indexOf('`', notesAt);
  if (backtick < 0) return null;

  // Guard against running past this entry into the next one's notes.
  const between = source.slice(notesAt + 'notes:'.length, backtick);
  if (between.trim() !== '') return null;

  return readTemplateLiteral(source, backtick).value.trim();
}

/** Every version key present, in file order. */
export function listVersions(source) {
  return [...source.matchAll(/^ {2}(['"])(\d+\.\d+\.\d+)\1\s*:\s*\{/gm)].map((m) => m[2]);
}

function main() {
  const args = process.argv.slice(2);
  const source = readFileSync(SOURCE, 'utf8');

  if (args.includes('--check')) {
    const versions = listVersions(source);
    if (versions.length === 0) {
      console.error('[extract-release-notes] no version entries found — format changed?');
      process.exit(1);
    }
    const broken = versions.filter((v) => !extractNotes(source, v));
    if (broken.length > 0) {
      console.error(`[extract-release-notes] failed to parse: ${broken.join(', ')}`);
      process.exit(1);
    }
    console.log(`[extract-release-notes] OK — ${versions.length} entries parse (${versions[0]} … ${versions[versions.length - 1]})`);
    return;
  }

  const version = args.find((a) => !a.startsWith('-'));
  if (!version) {
    console.error('Usage: node scripts/extract-release-notes.mjs <version> [--footer]');
    process.exit(2);
  }

  const notes = extractNotes(source, version);
  if (!notes) {
    console.error(`[extract-release-notes] no entry for ${version}`);
    process.exit(1);
  }

  process.stdout.write(args.includes('--footer') ? `${notes}\n${FOOTER}` : `${notes}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
