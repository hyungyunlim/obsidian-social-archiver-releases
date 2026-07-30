// eslint-disable-next-line import/no-nodejs-modules -- Source-contract test inspects stylesheets, which are not importable modules.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Obsidian defines BOTH of these as `var(--color-green)` — verified in
 * obsidian.asar:
 *
 *   --background-modifier-success: var(--color-green)
 *   --text-success:               var(--color-green)
 *
 * So a rule that uses one as `background` and the other as `color` paints text
 * in exactly the colour of its own fill. It is invisible, in every theme that
 * does not override one of them, and it type-checks and renders without error —
 * which is how it shipped twice: the product "In stock" badge and the webtoon
 * read badge were both blank pills.
 *
 * The readable pairing on that solid green is `--text-on-accent`.
 */

const STYLES_ROOT = join(process.cwd(), 'src/styles');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return entry.endsWith('.css') ? [full] : [];
  });
}

/**
 * Split a stylesheet into `selector { body }` pairs. Good enough for flat rules.
 *
 * Comments are stripped first: they would otherwise be captured as part of the
 * following selector, and a commented-out declaration would be read as a live
 * one.
 */
function rules(css: string): Array<{ selector: string; body: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }));
}

describe('success badges stay readable', () => {
  it('never pairs --background-modifier-success with --text-success', () => {
    const offenders: string[] = [];

    for (const file of cssFiles(STYLES_ROOT)) {
      for (const rule of rules(readFileSync(file, 'utf8'))) {
        const hasSuccessBackground = /background(?:-color)?\s*:[^;]*--background-modifier-success/.test(rule.body);
        const hasSuccessText = /(?:^|[;{\s])color\s*:[^;]*--text-success/.test(rule.body);
        if (hasSuccessBackground && hasSuccessText) {
          offenders.push(`${file.replace(process.cwd(), '.')} — ${rule.selector}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the product availability badge on an accent-safe foreground', () => {
    const css = readFileSync(join(STYLES_ROOT, 'components/post-card.css'), 'utf8');
    const badge = rules(css).find((rule) => rule.selector === '.pcr-product-badge');

    expect(badge).toBeDefined();
    expect(badge?.body).toMatch(/color\s*:\s*var\(--text-on-accent\)/);
  });
});
