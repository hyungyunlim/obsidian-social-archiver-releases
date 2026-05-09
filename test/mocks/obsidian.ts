/**
 * Mock Obsidian API for testing
 */

export class Notice {
  constructor(public message: string, public timeout?: number) {
    // Mock Notice - do nothing in tests
  }
}

export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: any;
  arrayBuffer: ArrayBuffer;
}

type RequestHandler = (params: RequestUrlParam) => Promise<RequestUrlResponse>;

let requestHandler: RequestHandler | null = null;

export function __setRequestUrlHandler(handler: RequestHandler | null): void {
  requestHandler = handler;
}

export async function requestUrl(params: RequestUrlParam): Promise<RequestUrlResponse> {
  if (requestHandler) {
    return requestHandler(params);
  }

  return {
    status: 200,
    headers: {},
    text: JSON.stringify({ success: true }),
    json: { success: true },
    arrayBuffer: new ArrayBuffer(0),
  };
}

// Platform detection mock
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isMacOS: true,
  isWin: false,
  isLinux: false,
  isIosApp: false,
  isAndroidApp: false,
};

// Add other Obsidian API mocks as needed
export class Plugin {
  app: any;
  manifest: any;

  async loadData(): Promise<any> {
    return {};
  }

  async saveData(data: any): Promise<void> {
    // Mock save
  }
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number };

  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.extension = (this.name.split('.').pop() || '').toLowerCase();
    this.stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
  }
}

export class TFolder {
  path: string;
  name: string;
  children: Array<TFile | TFolder>;

  constructor(path: string, children: Array<TFile | TFolder> = []) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.children = children;
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export class Vault {
  async create(path: string, content: string): Promise<TFile> {
    return new TFile(path);
  }

  async read(file: TFile): Promise<string> {
    return '';
  }

  async modify(file: TFile, content: string): Promise<void> {
    // Mock modify
  }
}

/**
 * Minimal Obsidian Modal mock used by UI-facing services in tests.
 *
 * - `onOpen` and `onClose` are hooks subclasses override.
 * - `open()` invokes `onOpen()` synchronously after constructing
 *   `contentEl`/`modalEl`. `close()` invokes `onClose()`.
 * - `contentEl` is a light DOM-like stub with the chainable helpers the
 *   plugin uses (`empty()`, `createEl()`, `createDiv()`, `addClass()`).
 *
 * `test/setup.ts` doesn't configure jsdom behavior beyond the vitest default,
 * so we rely on the real DOM for element creation.
 */
type CreateElOpts = {
  text?: string;
  cls?: string | string[];
  attr?: Record<string, string>;
  type?: string;
};

function createHtmlEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: CreateElOpts
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts?.text !== undefined) el.textContent = opts.text;
  if (opts?.cls) {
    // Obsidian accepts both arrays and space-separated single strings.
    const raw = Array.isArray(opts.cls) ? opts.cls : [opts.cls];
    const classes = raw.flatMap((c) => c.split(/\s+/).filter(Boolean));
    for (const c of classes) el.classList.add(c);
  }
  if (opts?.attr) {
    for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
  }
  if (opts?.type && 'type' in el) {
    (el as HTMLInputElement).type = opts.type;
  }
  // Enrich element with Obsidian's createEl/createDiv helpers
  enrichObsidianElement(el);
  return el;
}

function enrichObsidianElement(el: HTMLElement): void {
  const anyEl = el as unknown as {
    empty: () => void;
    createEl: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      opts?: CreateElOpts
    ) => HTMLElementTagNameMap[K];
    createDiv: (opts?: CreateElOpts) => HTMLDivElement;
    createSpan: (opts?: CreateElOpts) => HTMLSpanElement;
    addClass: (...names: string[]) => void;
    removeClass: (...names: string[]) => void;
    setText: (text: string) => void;
    setAttr: (name: string, value: string) => void;
  };
  anyEl.empty = () => {
    while (el.firstChild) el.removeChild(el.firstChild);
  };
  anyEl.createEl = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: CreateElOpts
  ) => {
    const child = createHtmlEl(tag, opts);
    el.appendChild(child);
    return child;
  };
  anyEl.createDiv = (opts?: CreateElOpts) => anyEl.createEl('div', opts);
  anyEl.createSpan = (opts?: CreateElOpts) => anyEl.createEl('span', opts);
  anyEl.setText = (text: string) => {
    el.textContent = text;
  };
  anyEl.setAttr = (name: string, value: string) => {
    el.setAttribute(name, value);
  };
  anyEl.addClass = (...names: string[]) => {
    for (const n of names) {
      // Match Obsidian's permissive behavior: split on whitespace so
      // `addClass('a b')` is equivalent to `addClass('a', 'b')`.
      for (const piece of n.split(/\s+/).filter(Boolean)) {
        el.classList.add(piece);
      }
    }
  };
  anyEl.removeClass = (...names: string[]) => {
    for (const n of names) {
      for (const piece of n.split(/\s+/).filter(Boolean)) {
        el.classList.remove(piece);
      }
    }
  };
}

export class Modal {
  app: unknown;
  contentEl: HTMLElement;
  modalEl: HTMLElement;
  // Mirrors Obsidian's `scope.register(modifiers, key, cb)` API surface.
  // Provided so subclasses that wire ESC/Enter shortcuts in `onOpen` can
  // be exercised without a real keymap.
  scope: { register: (modifiers: string[], key: string, callback: () => unknown) => void } = {
    register: () => {},
  };

  constructor(app: unknown) {
    this.app = app;
    this.contentEl = document.createElement('div');
    this.modalEl = document.createElement('div');
    enrichObsidianElement(this.contentEl);
    enrichObsidianElement(this.modalEl);
  }

  open(): void {
    // Attach modalEl so querySelector-based tests can find it.
    if (!this.modalEl.parentElement) {
      document.body.appendChild(this.modalEl);
    }
    // contentEl lives inside modalEl (mirroring Obsidian's internal layout).
    if (!this.contentEl.parentElement) {
      this.modalEl.appendChild(this.contentEl);
    }
    this.onOpen();
  }

  close(): void {
    this.onClose();
    if (this.modalEl.parentElement) {
      this.modalEl.parentElement.removeChild(this.modalEl);
    }
  }

  onOpen(): void {
    // Subclasses override
  }

  onClose(): void {
    // Subclasses override
  }
}

// Expose a minimal App type for tests that import it.
export type App = unknown;

// `setIcon` is intentionally NOT exported from the default mock. Some
// renderers (PreviewableInteractionsRenderer) rely on its absence to
// exercise their unicode fallback path. Tests that need the function
// stub it via `vi.mock('obsidian', ...)` or a per-suite spy.


type Listener = (...data: unknown[]) => void;

export class Events {
  private listeners: Map<string, Set<Listener>> = new Map();

  on(name: string, callback: Listener): void {
    const existing = this.listeners.get(name) ?? new Set();
    existing.add(callback);
    this.listeners.set(name, existing);
  }

  off(name: string, callback: Listener): void {
    const existing = this.listeners.get(name);
    existing?.delete(callback);
  }

  trigger(name: string, ...data: unknown[]): void {
    const listeners = this.listeners.get(name);
    if (!listeners) return;
    listeners.forEach((listener) => listener(...data));
  }
}
