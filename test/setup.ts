/**
 * Vitest test setup
 */

Object.defineProperty(globalThis, 'activeDocument', {
  configurable: true,
  get: () => document,
});

Object.defineProperty(globalThis, 'activeWindow', {
  configurable: true,
  get: () => window,
});

if (!('setCssStyles' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'setCssStyles', {
    configurable: true,
    value(this: HTMLElement, styles: Record<string, string>) {
      Object.assign(this.style, styles);
    },
  });
}

if (!('setCssProps' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'setCssProps', {
    configurable: true,
    value(this: HTMLElement, props: Record<string, string>) {
      for (const [key, value] of Object.entries(props)) {
        this.style.setProperty(key, value);
      }
    },
  });
}

if (!('toggleClass' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'toggleClass', {
    configurable: true,
    value(this: HTMLElement, className: string, enabled: boolean) {
      this.classList.toggle(className, enabled);
    },
  });
}

if (!('instanceOf' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'instanceOf', {
    configurable: true,
    value(this: Element, constructor: typeof Element) {
      return this instanceof constructor;
    },
  });
}
