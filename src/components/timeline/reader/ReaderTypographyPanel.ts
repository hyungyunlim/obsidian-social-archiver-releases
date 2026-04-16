/**
 * ReaderTypographyPanel - DOM-based typography control panel for the plugin reader.
 *
 * Owned by ReaderModeOverlay (survives post navigation).
 * Renders controls for font size, content width, line height, letter spacing,
 * and font family — matching the desktop app's ReaderTypographyPanel.svelte.
 *
 * Panel is positioned absolutely relative to an anchor wrapper element.
 * Escape closes the panel (stops propagation so reader does not close).
 * Arrow keys on range inputs stop propagation (prevent post navigation).
 * Click-outside closes the panel.
 */

// ── Typography constants (match desktop source of truth) ──

export const CONTENT_WIDTH_PRESETS = [480, 560, 680, 760, 880, 1040, 1280, 1600] as const;
export const WIDTH_LABELS = ['Compact', 'Narrow', 'Default', 'Medium', 'Wide', 'Full', 'Ultra', 'Max'] as const;

export const FONT_SIZE: { readonly min: number; readonly max: number; readonly default: number; readonly step: number } = { min: 12, max: 40, default: 19, step: 1 };
export const LINE_HEIGHT: { readonly min: number; readonly max: number; readonly default: number; readonly step: number } = { min: 1.0, max: 3.0, default: 1.75, step: 0.05 };
export const LETTER_SPACING: { readonly min: number; readonly max: number; readonly default: number; readonly step: number } = { min: -0.05, max: 0.15, default: 0, step: 0.01 };
export const CONTENT_WIDTH_DEFAULT = 680;
export const FONT_FAMILY_DEFAULT: ReaderFontFamilyKey = 'system';

export const FONT_FAMILIES = [
  { key: 'system' as const, label: 'System Default', stack: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif' },
  { key: 'serif' as const, label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { key: 'sans' as const, label: 'Sans-serif', stack: '"Helvetica Neue", Arial, sans-serif' },
  { key: 'mono' as const, label: 'Monospace', stack: '"SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace' },
] as const;

export type ReaderFontFamilyKey = 'system' | 'serif' | 'sans' | 'mono';

export interface ReaderTypographyState {
  fontSize: number;
  contentWidth: number;
  lineHeight: number;
  letterSpacing: number;
  fontFamily: ReaderFontFamilyKey;
}

export interface ReaderTypographyPanelOptions {
  anchorEl: HTMLElement;
  containerEl: HTMLElement;
  state: ReaderTypographyState;
  onChange: (patch: Partial<ReaderTypographyState>) => void;
  onReset: () => void;
  onClose: () => void;
}

export class ReaderTypographyPanel {
  private anchorEl: HTMLElement;
  private containerEl: HTMLElement;
  private state: ReaderTypographyState;
  private onChange: (patch: Partial<ReaderTypographyState>) => void;
  private onReset: () => void;
  private onClose: () => void;

  private panelEl: HTMLElement | null = null;
  private wrapperEl: HTMLElement | null = null;
  private isOpen = false;

  // Bound listener refs for cleanup
  private boundOutsideClick: ((e: MouseEvent) => void) | null = null;
  private boundKeydown: ((e: KeyboardEvent) => void) | null = null;

  // References for updating displayed values without rebuilding DOM
  private fontSizeValueEl: HTMLElement | null = null;
  private fontSizeRange: HTMLInputElement | null = null;
  private fontSizeDecBtn: HTMLButtonElement | null = null;
  private fontSizeIncBtn: HTMLButtonElement | null = null;

  private widthValueEl: HTMLElement | null = null;
  private widthRange: HTMLInputElement | null = null;
  private widthDecBtn: HTMLButtonElement | null = null;
  private widthIncBtn: HTMLButtonElement | null = null;

  private lineHeightValueEl: HTMLElement | null = null;
  private lineHeightRange: HTMLInputElement | null = null;
  private lineHeightDecBtn: HTMLButtonElement | null = null;
  private lineHeightIncBtn: HTMLButtonElement | null = null;

  private letterSpacingValueEl: HTMLElement | null = null;
  private letterSpacingRange: HTMLInputElement | null = null;
  private letterSpacingDecBtn: HTMLButtonElement | null = null;
  private letterSpacingIncBtn: HTMLButtonElement | null = null;

  private fontButtons: Map<ReaderFontFamilyKey, HTMLButtonElement> = new Map();

  constructor(options: ReaderTypographyPanelOptions) {
    this.anchorEl = options.anchorEl;
    this.containerEl = options.containerEl;
    this.state = { ...options.state };
    this.onChange = options.onChange;
    this.onReset = options.onReset;
    this.onClose = options.onClose;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.buildDOM();
    this.addListeners();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.removeListeners();
    this.wrapperEl?.remove();
    this.wrapperEl = null;
    this.panelEl = null;
    this.clearRefs();
  }

  updateState(state: ReaderTypographyState): void {
    this.state = { ...state };
    if (!this.isOpen) return;
    this.syncUI();
  }

  destroy(): void {
    this.close();
  }

  // ── DOM Construction ──

  private buildDOM(): void {
    // Wrapper for positioning (positioned relative to anchorEl parent)
    this.wrapperEl = document.createElement('div');
    this.wrapperEl.className = 'sa-reader-typography-anchor';

    // Panel
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'sa-reader-typography-panel';
    this.panelEl.setAttribute('role', 'dialog');
    this.panelEl.setAttribute('aria-label', 'Typography');

    // Stop click propagation inside panel
    this.panelEl.addEventListener('click', (e) => e.stopPropagation());

    // Font Size row
    const fsRow = this.buildRow('Size', String(this.state.fontSize));
    this.fontSizeValueEl = fsRow.valueEl;
    const fsCtrl = this.buildRangeControl({
      min: FONT_SIZE.min,
      max: FONT_SIZE.max,
      step: FONT_SIZE.step,
      value: this.state.fontSize,
      decLabel: 'Smaller',
      incLabel: 'Larger',
      onDec: () => this.onChange({ fontSize: this.state.fontSize - FONT_SIZE.step }),
      onInc: () => this.onChange({ fontSize: this.state.fontSize + FONT_SIZE.step }),
      onInput: (v) => this.onChange({ fontSize: Math.round(v) }),
      isMinDisabled: () => this.state.fontSize <= FONT_SIZE.min,
      isMaxDisabled: () => this.state.fontSize >= FONT_SIZE.max,
    });
    this.fontSizeRange = fsCtrl.range;
    this.fontSizeDecBtn = fsCtrl.decBtn;
    this.fontSizeIncBtn = fsCtrl.incBtn;
    fsRow.rowEl.appendChild(fsCtrl.ctrlEl);
    this.panelEl.appendChild(fsRow.rowEl);

    // Content Width row
    const widthIdx = this.getWidthIndex();
    const cwRow = this.buildRow('Width', WIDTH_LABELS[widthIdx] ?? 'Default');
    this.widthValueEl = cwRow.valueEl;
    const cwCtrl = this.buildRangeControl({
      min: 0,
      max: CONTENT_WIDTH_PRESETS.length - 1,
      step: 1,
      value: widthIdx,
      decLabel: 'Narrower',
      incLabel: 'Wider',
      onDec: () => {
        const idx = this.getWidthIndex();
        if (idx > 0) this.onChange({ contentWidth: CONTENT_WIDTH_PRESETS[idx - 1] });
      },
      onInc: () => {
        const idx = this.getWidthIndex();
        if (idx < CONTENT_WIDTH_PRESETS.length - 1) this.onChange({ contentWidth: CONTENT_WIDTH_PRESETS[idx + 1] });
      },
      onInput: (v) => {
        const i = Math.round(v);
        if (i >= 0 && i < CONTENT_WIDTH_PRESETS.length) {
          this.onChange({ contentWidth: CONTENT_WIDTH_PRESETS[i] });
        }
      },
      isMinDisabled: () => this.getWidthIndex() <= 0,
      isMaxDisabled: () => this.getWidthIndex() >= CONTENT_WIDTH_PRESETS.length - 1,
    });
    this.widthRange = cwCtrl.range;
    this.widthDecBtn = cwCtrl.decBtn;
    this.widthIncBtn = cwCtrl.incBtn;
    cwRow.rowEl.appendChild(cwCtrl.ctrlEl);
    this.panelEl.appendChild(cwRow.rowEl);

    // Line Height row
    const lhRow = this.buildRow('Spacing', this.state.lineHeight.toFixed(2));
    this.lineHeightValueEl = lhRow.valueEl;
    const lhCtrl = this.buildRangeControl({
      min: LINE_HEIGHT.min,
      max: LINE_HEIGHT.max,
      step: LINE_HEIGHT.step,
      value: this.state.lineHeight,
      decLabel: 'Tighter',
      incLabel: 'Looser',
      onDec: () => this.onChange({ lineHeight: this.roundStep(this.state.lineHeight - LINE_HEIGHT.step, LINE_HEIGHT.step) }),
      onInc: () => this.onChange({ lineHeight: this.roundStep(this.state.lineHeight + LINE_HEIGHT.step, LINE_HEIGHT.step) }),
      onInput: (v) => this.onChange({ lineHeight: this.roundStep(v, LINE_HEIGHT.step) }),
      isMinDisabled: () => this.state.lineHeight <= LINE_HEIGHT.min,
      isMaxDisabled: () => this.state.lineHeight >= LINE_HEIGHT.max,
    });
    this.lineHeightRange = lhCtrl.range;
    this.lineHeightDecBtn = lhCtrl.decBtn;
    this.lineHeightIncBtn = lhCtrl.incBtn;
    lhRow.rowEl.appendChild(lhCtrl.ctrlEl);
    this.panelEl.appendChild(lhRow.rowEl);

    // Letter Spacing row
    const lsRow = this.buildRow('Tracking', this.state.letterSpacing.toFixed(2));
    this.letterSpacingValueEl = lsRow.valueEl;
    const lsCtrl = this.buildRangeControl({
      min: LETTER_SPACING.min,
      max: LETTER_SPACING.max,
      step: LETTER_SPACING.step,
      value: this.state.letterSpacing,
      decLabel: 'Tighter',
      incLabel: 'Wider',
      onDec: () => this.onChange({ letterSpacing: this.roundStep(this.state.letterSpacing - LETTER_SPACING.step, LETTER_SPACING.step) }),
      onInc: () => this.onChange({ letterSpacing: this.roundStep(this.state.letterSpacing + LETTER_SPACING.step, LETTER_SPACING.step) }),
      onInput: (v) => this.onChange({ letterSpacing: this.roundStep(v, LETTER_SPACING.step) }),
      isMinDisabled: () => this.state.letterSpacing <= LETTER_SPACING.min,
      isMaxDisabled: () => this.state.letterSpacing >= LETTER_SPACING.max,
    });
    this.letterSpacingRange = lsCtrl.range;
    this.letterSpacingDecBtn = lsCtrl.decBtn;
    this.letterSpacingIncBtn = lsCtrl.incBtn;
    lsRow.rowEl.appendChild(lsCtrl.ctrlEl);
    this.panelEl.appendChild(lsRow.rowEl);

    // Separator
    this.panelEl.appendChild(this.buildSeparator());

    // Font Family grid
    const fontsGrid = document.createElement('div');
    fontsGrid.className = 'sa-reader-typography-fonts';
    for (const ff of FONT_FAMILIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sa-reader-typography-font-button';
      if (this.state.fontFamily === ff.key) {
        btn.classList.add('sa-reader-typography-font-button-active');
      }
      btn.textContent = ff.label;
      btn.style.fontFamily = ff.stack;
      btn.setAttribute('aria-label', `Font: ${ff.label}`);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onChange({ fontFamily: ff.key });
      });
      fontsGrid.appendChild(btn);
      this.fontButtons.set(ff.key, btn);
    }
    this.panelEl.appendChild(fontsGrid);

    // Separator
    this.panelEl.appendChild(this.buildSeparator());

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'sa-reader-typography-reset';
    resetBtn.textContent = 'Reset';
    resetBtn.setAttribute('aria-label', 'Reset typography to defaults');
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onReset();
    });
    this.panelEl.appendChild(resetBtn);

    this.wrapperEl.appendChild(this.panelEl);

    // Insert wrapper next to the anchor button (inside the header right group)
    this.anchorEl.parentElement?.insertBefore(this.wrapperEl, this.anchorEl.nextSibling);
  }

  private buildRow(label: string, value: string): { rowEl: HTMLElement; valueEl: HTMLElement } {
    const rowEl = document.createElement('div');
    rowEl.className = 'sa-reader-typography-row';

    const topEl = document.createElement('div');
    topEl.className = 'sa-reader-typography-row-top';

    const labelEl = document.createElement('span');
    labelEl.className = 'sa-reader-typography-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'sa-reader-typography-value';
    valueEl.textContent = value;

    topEl.appendChild(labelEl);
    topEl.appendChild(valueEl);
    rowEl.appendChild(topEl);

    return { rowEl, valueEl };
  }

  private buildRangeControl(opts: {
    min: number;
    max: number;
    step: number;
    value: number;
    decLabel: string;
    incLabel: string;
    onDec: () => void;
    onInc: () => void;
    onInput: (value: number) => void;
    isMinDisabled: () => boolean;
    isMaxDisabled: () => boolean;
  }): { ctrlEl: HTMLElement; range: HTMLInputElement; decBtn: HTMLButtonElement; incBtn: HTMLButtonElement } {
    const ctrlEl = document.createElement('div');
    ctrlEl.className = 'sa-reader-typography-row-control';

    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = 'sa-reader-typography-step-button';
    decBtn.textContent = '\u2212'; // minus sign
    decBtn.setAttribute('aria-label', opts.decLabel);
    decBtn.disabled = opts.isMinDisabled();
    decBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onDec();
    });

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'sa-reader-typography-range';
    range.min = String(opts.min);
    range.max = String(opts.max);
    range.step = String(opts.step);
    range.value = String(opts.value);
    range.addEventListener('input', (e) => {
      e.stopPropagation();
      opts.onInput(Number((e.currentTarget as HTMLInputElement).value));
    });
    // Prevent arrow keys from navigating posts
    range.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
      }
    });

    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'sa-reader-typography-step-button';
    incBtn.textContent = '+';
    incBtn.setAttribute('aria-label', opts.incLabel);
    incBtn.disabled = opts.isMaxDisabled();
    incBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onInc();
    });

    ctrlEl.appendChild(decBtn);
    ctrlEl.appendChild(range);
    ctrlEl.appendChild(incBtn);

    return { ctrlEl, range, decBtn, incBtn };
  }

  private buildSeparator(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'sa-reader-typography-separator';
    return sep;
  }

  // ── Listeners ──

  private addListeners(): void {
    // Outside click (deferred one tick to avoid catching the opening click)
    setTimeout(() => {
      this.boundOutsideClick = (e: MouseEvent) => {
        if (!this.isOpen || !this.panelEl) return;
        const target = e.target as Node;
        // Click inside panel or on the anchor button — ignore
        if (this.panelEl.contains(target) || this.anchorEl.contains(target)) return;
        this.onClose();
      };
      document.addEventListener('click', this.boundOutsideClick, true);
    }, 0);

    this.boundKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.onClose();
      }
    };
    document.addEventListener('keydown', this.boundKeydown, true);
  }

  private removeListeners(): void {
    if (this.boundOutsideClick) {
      document.removeEventListener('click', this.boundOutsideClick, true);
      this.boundOutsideClick = null;
    }
    if (this.boundKeydown) {
      document.removeEventListener('keydown', this.boundKeydown, true);
      this.boundKeydown = null;
    }
  }

  // ── UI Sync (update values without rebuilding) ──

  private syncUI(): void {
    // Font size
    if (this.fontSizeValueEl) this.fontSizeValueEl.textContent = String(this.state.fontSize);
    if (this.fontSizeRange) this.fontSizeRange.value = String(this.state.fontSize);
    if (this.fontSizeDecBtn) this.fontSizeDecBtn.disabled = this.state.fontSize <= FONT_SIZE.min;
    if (this.fontSizeIncBtn) this.fontSizeIncBtn.disabled = this.state.fontSize >= FONT_SIZE.max;

    // Content width
    const widthIdx = this.getWidthIndex();
    if (this.widthValueEl) this.widthValueEl.textContent = WIDTH_LABELS[widthIdx] ?? 'Default';
    if (this.widthRange) this.widthRange.value = String(widthIdx);
    if (this.widthDecBtn) this.widthDecBtn.disabled = widthIdx <= 0;
    if (this.widthIncBtn) this.widthIncBtn.disabled = widthIdx >= CONTENT_WIDTH_PRESETS.length - 1;

    // Line height
    if (this.lineHeightValueEl) this.lineHeightValueEl.textContent = this.state.lineHeight.toFixed(2);
    if (this.lineHeightRange) this.lineHeightRange.value = String(this.state.lineHeight);
    if (this.lineHeightDecBtn) this.lineHeightDecBtn.disabled = this.state.lineHeight <= LINE_HEIGHT.min;
    if (this.lineHeightIncBtn) this.lineHeightIncBtn.disabled = this.state.lineHeight >= LINE_HEIGHT.max;

    // Letter spacing
    if (this.letterSpacingValueEl) this.letterSpacingValueEl.textContent = this.state.letterSpacing.toFixed(2);
    if (this.letterSpacingRange) this.letterSpacingRange.value = String(this.state.letterSpacing);
    if (this.letterSpacingDecBtn) this.letterSpacingDecBtn.disabled = this.state.letterSpacing <= LETTER_SPACING.min;
    if (this.letterSpacingIncBtn) this.letterSpacingIncBtn.disabled = this.state.letterSpacing >= LETTER_SPACING.max;

    // Font family buttons
    for (const [key, btn] of this.fontButtons) {
      if (key === this.state.fontFamily) {
        btn.classList.add('sa-reader-typography-font-button-active');
      } else {
        btn.classList.remove('sa-reader-typography-font-button-active');
      }
    }
  }

  // ── Helpers ──

  private getWidthIndex(): number {
    const idx = (CONTENT_WIDTH_PRESETS as readonly number[]).indexOf(this.state.contentWidth);
    return Math.max(0, idx);
  }

  private roundStep(value: number, step: number): number {
    return Math.round(value / step) * step;
  }

  private clearRefs(): void {
    this.fontSizeValueEl = null;
    this.fontSizeRange = null;
    this.fontSizeDecBtn = null;
    this.fontSizeIncBtn = null;
    this.widthValueEl = null;
    this.widthRange = null;
    this.widthDecBtn = null;
    this.widthIncBtn = null;
    this.lineHeightValueEl = null;
    this.lineHeightRange = null;
    this.lineHeightDecBtn = null;
    this.lineHeightIncBtn = null;
    this.letterSpacingValueEl = null;
    this.letterSpacingRange = null;
    this.letterSpacingDecBtn = null;
    this.letterSpacingIncBtn = null;
    this.fontButtons.clear();
  }
}
