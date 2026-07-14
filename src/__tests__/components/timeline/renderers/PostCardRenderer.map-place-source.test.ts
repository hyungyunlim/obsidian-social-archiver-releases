// eslint-disable-next-line import/no-nodejs-modules -- Source-contract tests inspect renderer assets that are not importable modules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  `${process.cwd()}/src/components/timeline/renderers/PostCardRenderer.ts`,
  'utf8',
);
const styles = readFileSync(
  `${process.cwd()}/src/styles/components/post-card.css`,
  'utf8',
);
const pickerModel = readFileSync(
  `${process.cwd()}/src/components/timeline/modals/archivePlacePickerModel.ts`,
  'utf8',
);

function cssRule(selector: string): string | undefined {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<rule>[\\s\\S]*?)\\}`))?.groups?.rule;
}

describe('PostCardRenderer map-place provider routing', () => {
  it('routes specialized place-card rendering through the provider-neutral eligibility contract', () => {
    expect(source).toContain("isMapPlaceCardEligible(post.platform)");
    expect(source).not.toContain("post.platform === 'googlemaps'");
    expect(source).toContain('buildExactMapPlaceUrl');
  });

  it('uses semantic links with visible keyboard focus for place actions', () => {
    expect(source).toContain("nameRow.createEl('a'");
    expect(source).toContain("container.createEl('a', {\n        cls: 'gmaps-address pcr-gmaps-address-row'");
    expect(source).toContain("container.createEl('a', {\n        cls: 'gmaps-website pcr-gmaps-website-row'");
    expect(source).toContain("mapWrapper.createEl('a', {\n        cls: 'pcr-gmaps-map-touch-overlay'");
    expect(source).not.toContain("touchOverlay.addEventListener('click'");
    expect(styles).toContain('.pcr-gmaps-name:focus-visible');
    expect(styles).toContain('.pcr-gmaps-address-row:focus-visible');
    expect(styles).toContain('.pcr-gmaps-website-row:focus-visible');
    expect(styles).toContain('.pcr-gmaps-map-touch-overlay:focus-visible');
  });

  it('keeps verified, price, hours, and directions copy Google-only', () => {
    expect(source).toContain("provider?.source === 'googlemaps' && data.isVerified");
    expect(source).toContain("provider?.source === 'googlemaps' && data.priceLevel");
    expect(source).toContain("provider?.source === 'googlemaps' && data.hours");
    expect(source).toContain('`Open on ${provider?.displayLabel ?? \'map\'}`');
  });

  it('renders a canonical provider icon action without original-url shortcuts', () => {
    // Given: the Obsidian map-card renderer source and centralized icon service
    // When: the provider action path is inspected
    const headerRenderer = source.slice(
      source.indexOf('private renderGoogleMapsHeader'),
      source.indexOf('private renderGoogleMapsBusinessInfo'),
    );
    const providerRule = cssRule('.pcr-gmaps-provider-link');
    const hoverRule = cssRule('.pcr-gmaps-provider-link:hover');

    // Then: it uses the exact shared provider helper, a real icon, and click isolation
    expect(headerRenderer).toContain('getMapProviderWebLink(provider.source');
    expect(headerRenderer).toContain("createEl('a', { cls: 'pcr-gmaps-provider-link' })");
    expect(headerRenderer).toContain('getPlatformSimpleIcon(provider.source)');
    expect(headerRenderer).toContain("providerLink.kind === 'exact'");
    expect(headerRenderer).toContain("addEventListener('click', (event): void => event.stopPropagation())");
    expect(headerRenderer).not.toContain('originalUrl');
    expect(styles).toContain('.pcr-gmaps-provider-link:focus-visible');
    expect(headerRenderer).toContain("width: '18px'");
    expect(headerRenderer).toContain("height: '18px'");
    expect(providerRule).toContain('width: 28px');
    expect(providerRule).toContain('height: 28px');
    expect(providerRule).toContain('border: 0');
    expect(providerRule).toContain('background: transparent');
    expect(providerRule).toContain('color: var(--text-muted)');
    expect(hoverRule).toContain('background: transparent');
    expect(hoverRule).toContain('color: var(--text-normal)');
    expect(styles).toMatch(/\.pcr-gmaps-provider-link:focus-visible\s*{[^}]*outline-offset: -2px;/s);
  });

  it('prevents Space scrolling before opening the map chooser', () => {
    // Given: the Obsidian map chooser keyboard handler.
    const handlerStart = source.indexOf("dirBtn.addEventListener('keydown'");
    const handler = source.slice(handlerStart, source.indexOf("if (provider && providerLink)", handlerStart));

    // When: the Space activation branch is inspected.
    const preventDefaultIndex = handler.indexOf('event.preventDefault()');
    const openChooserIndex = handler.indexOf('openChooser(event)');

    // Then: the browser default is cancelled before the chooser opens.
    expect(preventDefaultIndex).toBeGreaterThanOrEqual(0);
    expect(openChooserIndex).toBeGreaterThan(preventDefaultIndex);
  });

  it('uses external identity only when both source and external id are present', () => {
    expect(pickerModel).toContain('identity: `${provider.source}:${externalId}`');
    expect(pickerModel).not.toContain('toLocaleLowerCase');
  });

  it('opens the dedicated existing-or-search picker without name-based identity fallback', () => {
    expect(source).toContain('new ArchivePlacePickerModal');
    expect(source).toContain("createEl('button', { cls: 'pcr-action-btn' })");
    expect(source).not.toContain('name.toLocaleLowerCase()');
    expect(source).not.toContain("`name:${name.toLocaleLowerCase()}`");
  });

  it('keeps the search submit target aligned with the compact picker controls', () => {
    expect(styles).toMatch(/\.sa-place-picker-search-row button\s*{[^}]*min-height: 36px;/s);
  });
});
