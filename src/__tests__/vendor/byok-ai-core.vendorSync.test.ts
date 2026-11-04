/**
 * Drift guard for the vendored byok-ai-core: a copy of
 * `packages/byok-ai-core/src` made by `scripts/sync-byok-ai-core.sh`.
 * Fix a failure with the script, never by editing the copy.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const PACKAGE_SRC = resolve(testDir, '../../../packages/byok-ai-core/src');
const VENDORED = resolve(testDir, '../../vendor/byok-ai-core');

const files = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.ts')).sort();
const asVendored = (source: string): string => source.replace(/(from '\.{1,2}\/[^']+)\.js'/g, "$1'");

describe('vendored byok-ai-core', () => {
  it('matches packages/byok-ai-core/src (run scripts/sync-byok-ai-core.sh if not)', () => {
    expect(files(VENDORED)).toEqual(files(PACKAGE_SRC));
    for (const file of files(PACKAGE_SRC)) {
      expect([file, readFileSync(join(VENDORED, file), 'utf8')]).toEqual([
        file,
        asVendored(readFileSync(join(PACKAGE_SRC, file), 'utf8')),
      ]);
    }
  });
});
