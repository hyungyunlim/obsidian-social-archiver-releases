/**
 * Obsidian injects its DOM helpers (`createEl`, `createDiv`, `createSpan`,
 * `createSvg`, `createFragment`) onto every window it owns, including popout
 * windows — that is why the plugin guidelines want `activeWindow.createDiv()`
 * over `activeDocument.createElement('div')`. `obsidian.d.ts` declares them
 * only as globals and on `Node` (checked against 1.13.1), so calling them
 * through `activeWindow` does not typecheck without this augmentation.
 *
 * Drop this file once the official typings declare them on `Window`.
 */
export {};

declare global {
  interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void,
    ): HTMLElementTagNameMap[K];
    createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
    createSpan(
      o?: DomElementInfo | string,
      callback?: (el: HTMLSpanElement) => void,
    ): HTMLSpanElement;
    createSvg<K extends keyof SVGElementTagNameMap>(
      tag: K,
      o?: SvgElementInfo | string,
      callback?: (el: SVGElementTagNameMap[K]) => void,
    ): SVGElementTagNameMap[K];
    createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
  }
}
