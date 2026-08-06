import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The plugin ships a hand-copied subset of leaflet.css rather than importing it,
 * because the controls and attribution are deliberately restyled. That subset
 * drifted: `.leaflet-marker-icon` and `.leaflet-tile-container` were left out of
 * upstream's "required styles" group, so markers were statically positioned.
 *
 * Leaflet places everything with `transform: translate3d(x, y, 0)`, and on a
 * static element a transform translates from that element's flow position — so
 * markers stacked down the pane and then took their geographic offset from
 * there. It read as a zoom bug: invisible at street zoom where places are
 * thousands of pixels apart, and at country zoom it drew Seoul and Gyeonggi as
 * vertical columns in the East China Sea.
 *
 * This pins the group against the real leaflet.css, so the next selector
 * upstream adds cannot go missing the same way.
 */

const OURS = readFileSync(`${process.cwd()}/src/styles/components/post-card.css`, 'utf8');
const UPSTREAM = readFileSync(`${process.cwd()}/node_modules/leaflet/dist/leaflet.css`, 'utf8');

/** Selectors upstream groups under `position: absolute; left: 0; top: 0`. */
function upstreamPositionedSelectors(): string[] {
  const block = /((?:[^{}]+,\s*)+[^{}]+)\{\s*position:\s*absolute;\s*left:\s*0;\s*top:\s*0;\s*\}/
    .exec(UPSTREAM);
  return (block?.[1] ?? '')
    .split(',')
    .map((selector) => selector.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter(Boolean);
}

describe('Leaflet required styles', () => {
  it('finds the positioned group upstream, so this test cannot silently pass', () => {
    expect(upstreamPositionedSelectors().length).toBeGreaterThan(5);
  });

  it('carries every selector upstream positions absolutely', () => {
    const missing = upstreamPositionedSelectors().filter(
      (selector) => !OURS.includes(selector),
    );
    expect(missing).toEqual([]);
  });

  it('positions markers, the omission that caused the misplaced pins', () => {
    // Named on its own so a regression points straight at the symptom rather
    // than at a list diff.
    const group = /\.leaflet-marker-icon,[\s\S]*?\{([\s\S]*?)\}/.exec(OURS)?.[1] ?? '';
    expect(group).toMatch(/position:\s*absolute/);
  });

  it('clips the map container, so panes cannot spill past it', () => {
    const container = /\.leaflet-container\s*\{([\s\S]*?)\}/.exec(OURS)?.[1] ?? '';
    expect(container).toMatch(/overflow:\s*hidden/);
  });
});
