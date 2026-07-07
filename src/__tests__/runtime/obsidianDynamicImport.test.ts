import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');
const PRODUCTION_SOURCE_PATTERN = /\.(?:ts|tsx|svelte)$/;

function collectProductionSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...collectProductionSourceFiles(path));
      continue;
    }

    if (
      PRODUCTION_SOURCE_PATTERN.test(entry)
      && !entry.endsWith('.test.ts')
      && !entry.endsWith('.test.tsx')
      && !entry.endsWith('.spec.ts')
      && !entry.endsWith('.spec.tsx')
    ) {
      files.push(path);
    }
  }

  return files;
}

describe('Obsidian runtime imports', () => {
  it('does not use runtime dynamic imports for the Obsidian module', () => {
    const offenders = collectProductionSourceFiles(SOURCE_ROOT)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes("await import('obsidian')")
          || source.includes('await import("obsidian")');
      })
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
