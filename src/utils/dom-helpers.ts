/**
 * DOM Helper Utilities
 *
 * Single Responsibility: Provide safe DOM manipulation methods
 * - SVG element creation
 * - Safe alternatives to innerHTML
 */

import type { PlatformIcon } from '@/services/IconService';

/**
 * Create an SVG element with a path
 *
 * @param icon - Platform icon data
 * @param styles - Optional CSS styles object
 * @param viewBox - Optional viewBox override (defaults to "0 0 24 24"). Used by
 *   publisher icons whose source SVG was authored in a different coordinate
 *   space (e.g. BBC's "0 0 512 256").
 * @returns SVGSVGElement
 *
 * @example
 * const svg = createSVGElement(siFacebook, { fill: 'var(--text-muted)', width: '14px', height: '14px' });
 * container.appendChild(svg);
 */
export function createSVGElement(
  icon: PlatformIcon,
  styles?: Partial<CSSStyleDeclaration>,
  viewBox?: string
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('viewBox', viewBox ?? '0 0 24 24');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Apply styles
  if (styles) {
    Object.assign(svg.style, styles);
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', icon.path);

  svg.appendChild(path);
  return svg;
}

/**
 * Create an SVG element with custom viewBox and path
 *
 * @param viewBox - SVG viewBox attribute
 * @param pathData - SVG path d attribute
 * @param styles - Optional CSS styles object
 * @returns SVGSVGElement
 */
export function createCustomSVG(
  viewBox: string,
  pathData: string,
  styles?: Partial<CSSStyleDeclaration>
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);

  if (styles) {
    Object.assign(svg.style, styles);
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);

  svg.appendChild(path);
  return svg;
}
