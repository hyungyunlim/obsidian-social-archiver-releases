import { setIcon } from 'obsidian';
import type { TranscriptionSegment } from '../../../types/transcription';
import type { PlaybackAdapter } from '../controllers/PlaybackAdapter';
import { HtmlMediaPlaybackAdapter } from '../controllers/PlaybackAdapter';
import { languageCodeToName } from '../../../constants/languages';

/**
 * Options for TranscriptRenderer
 */
export interface TranscriptRendererOptions {
  /** Transcription segments to display */
  segments: TranscriptionSegment[];
  /** Language code of the transcript */
  language?: string;
  /** Unified playback adapter for audio/video/iframe sync */
  adapter?: PlaybackAdapter | null;
  /** @deprecated Use adapter instead. Kept for backward compatibility with podcast flow. */
  audioElement?: HTMLAudioElement | null;
  /** Callback when a timestamp is clicked */
  onTimestampClick?: (time: number) => void;
  /** Start collapsed (default: true) */
  startCollapsed?: boolean;
  /** Show visual dividers between speaker turns (default: false) */
  showSpeakerDividers?: boolean;
  /** Callback to toggle native TextTrack captions on the video. If provided, a CC button is shown. */
  onCaptionToggle?: () => boolean;
  /** Initial state of native captions (default: false) */
  captionActive?: boolean;
  /** Available languages (ISO codes) when multilang transcript exists */
  languages?: string[];
  /** All segments by language for tab switching */
  multilangSegments?: Map<string, TranscriptionSegment[]>;
  /** Callback when language tab is selected */
  onLanguageChange?: (languageCode: string) => void;
}

/**
 * TranscriptRenderer - Renders interactive transcript with timestamps
 * Single Responsibility: Display transcription segments with audio sync
 *
 * Features:
 * - Collapsible transcript section
 * - Clickable timestamps that seek audio
 * - Auto-scroll to current segment during playback
 * - Search/filter functionality
 * - Highlight current segment
 */
export class TranscriptRenderer {
  private container: HTMLElement | null = null;
  private segments: TranscriptionSegment[] = [];
  private audioElement: HTMLAudioElement | null = null;
  private adapter: PlaybackAdapter | null = null;
  private unsubscribeAdapter: (() => void) | null = null;
  private segmentElements: Map<number, HTMLElement> = new Map();
  private currentSegmentIndex: number = -1;
  private autoScroll: boolean = true;
  private isCollapsed: boolean = true;
  private searchQuery: string = '';
  private onTimestampClick?: (time: number) => void;
  private contentEl: HTMLElement | null = null;
  private segmentsListEl: HTMLElement | null = null;
  private isMobile: boolean = false;
  private showSpeakerDividers: boolean = false;
  private onCaptionToggle?: () => boolean;
  private captionActive: boolean = false;
  // Multilang support
  private languages: string[] = [];
  private multilangSegments: Map<string, TranscriptionSegment[]> = new Map();
  private currentLanguage: string = '';
  private onLanguageChange?: (languageCode: string) => void;

  // Speaker jump feature
  private speakerSegmentIndices: number[] = []; // Indices of segments with speaker markers
  private currentSpeakerJumpIndex: number = -1; // Current position in speaker jump sequence

  // Bound event handler references for cleanup (legacy audio path)
  private boundTimeUpdateHandler: (() => void) | null = null;

  /**
   * Render transcript component
   */
  render(container: HTMLElement, options: TranscriptRendererOptions): void {
    this.container = container;
    this.segments = options.segments;
    this.onTimestampClick = options.onTimestampClick;
    this.isCollapsed = options.startCollapsed ?? true;
    this.isMobile = document.body.classList.contains('is-mobile');
    this.showSpeakerDividers = options.showSpeakerDividers ?? false;
    this.onCaptionToggle = options.onCaptionToggle;
    this.captionActive = options.captionActive ?? false;
    // Initialize multilang fields
    this.languages = options.languages || [];
    this.multilangSegments = options.multilangSegments || new Map();
    this.currentLanguage = options.language || 'en';
    this.onLanguageChange = options.onLanguageChange;

    // Resolve adapter: prefer explicit adapter, fall back to wrapping audioElement
    if (options.adapter) {
      this.adapter = options.adapter;
      this.audioElement = null;
    } else if (options.audioElement) {
      this.audioElement = options.audioElement;
      this.adapter = new HtmlMediaPlaybackAdapter(options.audioElement);
    } else {
      this.adapter = null;
      this.audioElement = null;
    }

    if (this.segments.length === 0) {
      return; // Nothing to render
    }

    // Pre-calculate speaker segment indices for the speaker jump button
    this.speakerSegmentIndices = [];
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg && this.hasSpeakerMarker(seg.text)) {
        this.speakerSegmentIndices.push(i);
      }
    }

    // Main container
    const transcriptSection = container.createDiv({ cls: 'podcast-transcript-viewer' });
    transcriptSection.style.cssText = `
      margin: ${this.isMobile ? '12px 0' : '16px 0'};
      border: 1px solid var(--background-modifier-border);
      border-radius: ${this.isMobile ? '6px' : '8px'};
      overflow: hidden;
    `;

    // Header (collapsible toggle)
    const header = this.renderHeader(transcriptSection, options.language);

    // Content area (collapsible)
    this.contentEl = transcriptSection.createDiv({ cls: 'transcript-content' });
    this.contentEl.style.cssText = `
      display: ${this.isCollapsed ? 'none' : 'block'};
    `;

    // Toggle collapse on header click
    header.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // Search bar (desktop only)
    if (!this.isMobile) {
      this.renderSearchBar(this.contentEl);
    }

    // Segments list
    this.segmentsListEl = this.contentEl.createDiv({ cls: 'transcript-segments' });
    this.segmentsListEl.style.cssText = `
      padding: 0 ${this.isMobile ? '10px 10px' : '12px 12px'};
      max-height: ${this.isMobile ? '300px' : '400px'};
      overflow-y: auto;
    `;

    this.renderSegments(this.segmentsListEl);

    // Bind playback events for sync
    if (this.adapter) {
      this.bindAdapterEvents();
    } else if (this.audioElement) {
      this.bindAudioEvents();
    }
  }

  /**
   * Render header section
   */
  private renderHeader(parent: HTMLElement, language?: string): HTMLElement {
    const header = parent.createDiv({ cls: 'transcript-header' });
    header.style.cssText = `
      padding: ${this.isMobile ? '10px 12px' : '12px 16px'};
      background: var(--background-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: ${this.isMobile ? '6px' : '8px'};
      user-select: none;
    `;

    // Collapse icon
    const collapseIcon = header.createSpan({ cls: 'collapse-icon' });
    collapseIcon.style.cssText = `display: flex; align-items: center;${this.isMobile ? ' width: 16px; height: 16px;' : ''}`;
    setIcon(collapseIcon, this.isCollapsed ? 'chevron-right' : 'chevron-down');

    // Title
    const titleEl = header.createSpan({ text: 'Transcript', cls: 'transcript-title' });
    titleEl.style.cssText = `
      font-weight: 500;
      font-size: ${this.isMobile ? '13px' : '14px'};
      flex: 1;
    `;

    // Language tabs (if multilang) or badge (if single language)
    if (this.languages.length >= 2) {
      this.renderLanguageTabs(header);
    } else if (language && language !== 'auto') {
      const langBadge = header.createSpan({
        text: language.toUpperCase(),
        cls: 'transcript-language'
      });
      langBadge.style.cssText = `
        font-size: ${this.isMobile ? '9px' : '10px'};
        padding: 2px ${this.isMobile ? '4px' : '6px'};
        background: var(--background-modifier-hover);
        border-radius: 4px;
        color: var(--text-muted);
        font-weight: 500;
      `;
    }

    // CC (caption) toggle button — only shown when native captions are available
    if (this.onCaptionToggle) {
      this.renderCaptionToggleButton(header);
    }

    // Speaker jump button (stopPropagation is handled inside renderSpeakerJumpButton)
    this.renderSpeakerJumpButton(header);

    // Auto-scroll toggle (stop propagation to prevent collapse toggle)
    const autoScrollBtn = this.renderAutoScrollToggle(header);
    autoScrollBtn.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    return header;
  }

  /**
   * Render language tabs for multilang transcripts
   */
  private renderLanguageTabs(parent: HTMLElement): void {
    // Wrapper with fade indicators for overflow
    const wrapper = parent.createDiv({ cls: 'transcript-language-tabs-wrapper' });
    wrapper.style.cssText = `
      position: relative;
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
    `;

    const tabsContainer = wrapper.createDiv({ cls: 'transcript-language-tabs' });
    tabsContainer.style.cssText = `
      display: flex;
      gap: ${this.isMobile ? '4px' : '6px'};
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    `;

    // Fade indicator for right overflow
    const fadeRight = wrapper.createDiv({ cls: 'tabs-fade-right' });
    fadeRight.style.cssText = `
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 20px;
      background: linear-gradient(to right, transparent, var(--background-secondary));
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    `;

    // Update fade visibility on scroll
    const updateFade = () => {
      const hasOverflow = tabsContainer.scrollWidth > tabsContainer.clientWidth;
      const atEnd = tabsContainer.scrollLeft + tabsContainer.clientWidth >= tabsContainer.scrollWidth - 2;
      fadeRight.style.opacity = (hasOverflow && !atEnd) ? '1' : '0';
    };
    tabsContainer.addEventListener('scroll', updateFade);

    // Check after render
    requestAnimationFrame(updateFade);

    for (const langCode of this.languages) {
      const isActive = langCode === this.currentLanguage;
      const displayName = languageCodeToName(langCode);

      const tab = tabsContainer.createDiv({
        text: this.isMobile ? langCode.toUpperCase() : displayName,
        cls: 'language-tab'
      });
      tab.style.cssText = `
        font-size: ${this.isMobile ? '9px' : '10px'};
        padding: ${this.isMobile ? '2px 6px' : '3px 8px'};
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        font-weight: 500;
        transition: all 0.2s;
        color: ${isActive ? 'var(--text-accent)' : 'var(--text-muted)'};
        background: ${isActive ? 'var(--background-modifier-active-hover)' : 'var(--background-modifier-hover)'};
      `;

      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchLanguage(langCode);
      });

      // Hover effect for inactive tabs
      if (!isActive) {
        tab.addEventListener('mouseenter', () => {
          tab.style.background = 'var(--background-modifier-active-hover)';
        });
        tab.addEventListener('mouseleave', () => {
          if (langCode !== this.currentLanguage) {
            tab.style.background = 'var(--background-modifier-hover)';
          }
        });
      }
    }
  }

  /**
   * Render auto-scroll toggle button
   */
  private renderAutoScrollToggle(parent: HTMLElement): HTMLElement {
    const toggleBtn = parent.createDiv({ cls: 'transcript-autoscroll-toggle' });
    toggleBtn.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${this.isMobile ? '0' : '4px'};
      padding: ${this.isMobile ? '4px 6px' : '4px 8px'};
      border-radius: 4px;
      cursor: pointer;
      font-size: ${this.isMobile ? '10px' : '11px'};
      color: ${this.autoScroll ? 'var(--text-accent)' : 'var(--text-muted)'};
      background: ${this.autoScroll ? 'var(--background-modifier-hover)' : 'transparent'};
      transition: all 0.2s;
    `;

    const icon = toggleBtn.createSpan({ cls: 'autoscroll-icon' });
    icon.style.cssText = `display: flex; align-items: center;${this.isMobile ? ' width: 14px; height: 14px;' : ''}`;
    setIcon(icon, 'scroll');

    // Only show label on desktop
    if (!this.isMobile) {
      toggleBtn.createSpan({ text: 'Auto-scroll' });
    }

    toggleBtn.addEventListener('click', () => {
      this.autoScroll = !this.autoScroll;
      toggleBtn.style.color = this.autoScroll ? 'var(--text-accent)' : 'var(--text-muted)';
      toggleBtn.style.background = this.autoScroll ? 'var(--background-modifier-hover)' : 'transparent';
    });

    // Hover effect
    toggleBtn.addEventListener('mouseenter', () => {
      if (!this.autoScroll) {
        toggleBtn.style.background = 'var(--background-modifier-hover)';
      }
    });
    toggleBtn.addEventListener('mouseleave', () => {
      if (!this.autoScroll) {
        toggleBtn.style.background = 'transparent';
      }
    });

    return toggleBtn;
  }

  /**
   * Render CC (closed caption) toggle button for native video captions
   */
  private renderCaptionToggleButton(parent: HTMLElement): void {
    const ccBtn = parent.createDiv({ cls: 'transcript-caption-toggle' });
    ccBtn.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${this.isMobile ? '0' : '4px'};
      padding: ${this.isMobile ? '4px 6px' : '4px 8px'};
      border-radius: 4px;
      cursor: pointer;
      font-size: ${this.isMobile ? '10px' : '11px'};
      color: ${this.captionActive ? 'var(--text-accent)' : 'var(--text-muted)'};
      background: ${this.captionActive ? 'var(--background-modifier-hover)' : 'transparent'};
      transition: all 0.2s;
    `;
    ccBtn.title = this.captionActive ? 'Hide video captions' : 'Show video captions';

    const icon = ccBtn.createSpan({ cls: 'caption-toggle-icon' });
    icon.style.cssText = `display: flex; align-items: center;${this.isMobile ? ' width: 14px; height: 14px;' : ''}`;
    setIcon(icon, 'subtitles');

    if (!this.isMobile) {
      ccBtn.createSpan({ text: 'CC' });
    }

    ccBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.onCaptionToggle) return;
      this.captionActive = this.onCaptionToggle();
      ccBtn.style.color = this.captionActive ? 'var(--text-accent)' : 'var(--text-muted)';
      ccBtn.style.background = this.captionActive ? 'var(--background-modifier-hover)' : 'transparent';
      ccBtn.title = this.captionActive ? 'Hide video captions' : 'Show video captions';
    });

    // Hover effect
    ccBtn.addEventListener('mouseenter', () => {
      if (!this.captionActive) {
        ccBtn.style.background = 'var(--background-modifier-hover)';
      }
    });
    ccBtn.addEventListener('mouseleave', () => {
      if (!this.captionActive) {
        ccBtn.style.background = 'transparent';
      }
    });
  }

  /**
   * Render speaker jump button
   */
  private renderSpeakerJumpButton(parent: HTMLElement): HTMLElement {
    const hasSpeakers = this.speakerSegmentIndices.length > 0;

    const jumpBtn = parent.createDiv({ cls: 'transcript-speaker-jump' });
    jumpBtn.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${this.isMobile ? '0' : '4px'};
      padding: ${this.isMobile ? '4px 6px' : '4px 8px'};
      border-radius: 4px;
      cursor: ${hasSpeakers ? 'pointer' : 'not-allowed'};
      font-size: ${this.isMobile ? '10px' : '11px'};
      color: ${hasSpeakers ? 'var(--text-muted)' : 'var(--text-faint)'};
      background: transparent;
      transition: all 0.2s;
      opacity: ${hasSpeakers ? '1' : '0.5'};
    `;
    jumpBtn.title = hasSpeakers
      ? `Jump to next speaker (${this.speakerSegmentIndices.length} speakers)`
      : 'No speaker markers detected';

    const icon = jumpBtn.createSpan({ cls: 'speaker-jump-icon' });
    icon.style.cssText = `display: flex; align-items: center;${this.isMobile ? ' width: 14px; height: 14px;' : ''}`;
    setIcon(icon, 'user');

    // Only show label on desktop
    if (!this.isMobile) {
      jumpBtn.createSpan({ text: 'Speaker' });
    }

    // Always stop propagation to prevent header collapse
    jumpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasSpeakers) {
        this.jumpToNextSpeaker();
        // Update button style to show it's active
        jumpBtn.style.color = 'var(--text-accent)';
        jumpBtn.style.background = 'var(--background-modifier-hover)';
      }
    });

    if (hasSpeakers) {
      // Hover effect
      jumpBtn.addEventListener('mouseenter', () => {
        jumpBtn.style.background = 'var(--background-modifier-hover)';
      });
      jumpBtn.addEventListener('mouseleave', () => {
        if (this.currentSpeakerJumpIndex < 0) {
          jumpBtn.style.background = 'transparent';
          jumpBtn.style.color = 'var(--text-muted)';
        }
      });
    }

    return jumpBtn;
  }

  /**
   * Jump to next speaker segment after current playback position
   */
  private jumpToNextSpeaker(): void {
    if (this.speakerSegmentIndices.length === 0) return;

    // Get current playback time (prefer adapter, fall back to audioElement)
    const currentTime = this.adapter?.getCurrentTime() ?? this.audioElement?.currentTime ?? 0;

    // Find the first speaker segment after current playback time
    let foundIndex = -1;
    for (let i = 0; i < this.speakerSegmentIndices.length; i++) {
      const segmentIndex = this.speakerSegmentIndices[i];
      if (segmentIndex === undefined) continue;

      const segment = this.segments[segmentIndex];
      if (segment && segment.start > currentTime) {
        foundIndex = i;
        break;
      }
    }

    // If no speaker found after current time, wrap around to the first speaker
    if (foundIndex === -1) {
      foundIndex = 0;
    }

    this.currentSpeakerJumpIndex = foundIndex;
    const segmentIndex = this.speakerSegmentIndices[this.currentSpeakerJumpIndex];
    if (segmentIndex === undefined) return;

    const segment = this.segments[segmentIndex];

    if (segment) {
      // Expand transcript if collapsed
      if (this.isCollapsed) {
        this.toggleCollapse();
      }

      // Seek to speaker segment
      this.seekToTime(segment.start);

      // Scroll to the segment in the list
      const segmentEl = this.segmentElements.get(segment.id);
      if (segmentEl && this.segmentsListEl) {
        const containerRect = this.segmentsListEl.getBoundingClientRect();
        const elementRect = segmentEl.getBoundingClientRect();
        const scrollTop = this.segmentsListEl.scrollTop;

        const elementCenter = elementRect.top - containerRect.top + scrollTop + (elementRect.height / 2);
        const containerCenter = containerRect.height / 2;
        const targetScroll = elementCenter - containerCenter;

        this.segmentsListEl.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth'
        });
      }
    }
  }

  /**
   * Check if text has speaker marker (>> for OpenAI Whisper, - for whisper.cpp)
   */
  private hasSpeakerMarker(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.startsWith('>>') || trimmed.startsWith('-');
  }

  /**
   * Render search bar
   */
  private renderSearchBar(parent: HTMLElement): void {
    const searchBar = parent.createDiv({ cls: 'transcript-search' });
    searchBar.style.cssText = `
      padding: ${this.isMobile ? '6px 10px' : '8px 12px'};
      border-bottom: 1px solid var(--background-modifier-border);
    `;

    const inputWrapper = searchBar.createDiv({ cls: 'transcript-search-wrapper' });
    inputWrapper.style.cssText = `
      position: relative;
      display: flex;
      align-items: center;
    `;

    // Search icon
    const searchIcon = inputWrapper.createSpan({ cls: 'search-icon' });
    searchIcon.style.cssText = `
      position: absolute;
      left: ${this.isMobile ? '8px' : '10px'};
      color: var(--text-muted);
      display: flex;
      align-items: center;
      ${this.isMobile ? 'width: 14px; height: 14px;' : ''}
    `;
    setIcon(searchIcon, 'search');

    const input = inputWrapper.createEl('input', {
      type: 'text',
      placeholder: this.isMobile ? 'Search...' : 'Search transcript...',
      cls: 'transcript-search-input'
    }) as HTMLInputElement;
    input.style.cssText = `
      width: 100%;
      padding: ${this.isMobile ? '5px 8px 5px 28px' : '6px 10px 6px 34px'};
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      background: var(--background-primary);
      font-size: ${this.isMobile ? '12px' : '13px'};
      outline: none;
    `;

    // Focus style
    input.addEventListener('focus', () => {
      input.style.borderColor = 'var(--interactive-accent)';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = 'var(--background-modifier-border)';
    });

    // Search functionality
    input.addEventListener('input', () => {
      this.searchQuery = input.value.toLowerCase().trim();
      this.filterSegments();
    });

    // Clear on Escape
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        this.searchQuery = '';
        this.filterSegments();
        input.blur();
      }
    });
  }

  /**
   * Render all segments
   */
  private renderSegments(parent: HTMLElement): void {
    this.segmentElements.clear();
    // Note: speakerSegmentIndices is pre-calculated in render() for the speaker jump button

    // Track speaker turns - alternate between speakers when >> or - is encountered
    // OpenAI Whisper uses >> for speaker changes, whisper.cpp uses -
    let currentSpeakerIndex = 0;

    let prevSpeakerIndex = 0;

    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      if (!segment) continue;

      // Check if this segment starts a new speaker turn
      const rawText = segment.text.trim();
      if (this.hasSpeakerMarker(rawText)) {
        currentSpeakerIndex++;
      }

      // Insert speaker divider when speaker changes
      if (this.showSpeakerDividers && i > 0 && currentSpeakerIndex !== prevSpeakerIndex) {
        this.renderSpeakerDivider(parent);
      }
      prevSpeakerIndex = currentSpeakerIndex;

      const segmentEl = this.renderSegment(parent, segment, currentSpeakerIndex);
      this.segmentElements.set(segment.id, segmentEl);
    }
  }

  /**
   * Render a single segment
   */
  private renderSegment(parent: HTMLElement, segment: TranscriptionSegment, speakerIndex: number = 0): HTMLElement {
    // Check for speaker turn marker (>> for OpenAI Whisper, - for whisper.cpp)
    const rawText = segment.text.trim();
    const hasSpeakerMarker = rawText.startsWith('>>') || rawText.startsWith('-');
    const displayText = hasSpeakerMarker ? rawText.replace(/^(>>|-)\s*/, '') : rawText;

    // Alternate colors for different speakers (using subtle, theme-friendly colors)
    const isEvenSpeaker = speakerIndex % 2 === 0;
    const speakerColor = isEvenSpeaker ? 'var(--text-accent)' : 'var(--text-faint)';

    const segmentEl = parent.createDiv({
      cls: `transcript-segment speaker-${speakerIndex % 2}`,
      attr: {
        'data-segment-id': String(segment.id),
        'data-speaker': String(speakerIndex)
      }
    });
    segmentEl.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${this.isMobile ? '8px' : '12px'};
      padding: ${this.isMobile ? '8px 0' : '10px 0'};
      border-bottom: 1px solid var(--background-modifier-border-hover);
      transition: background 0.15s ease;
      border-left: 2px solid ${speakerColor};
      padding-left: ${this.isMobile ? '8px' : '10px'};
      margin-left: -${this.isMobile ? '10px' : '12px'};
    `;

    // Timestamp (clickable)
    const timestamp = segmentEl.createSpan({
      text: `[${this.formatTimestamp(segment.start)}]`,
      cls: 'segment-timestamp'
    });
    timestamp.style.cssText = `
      color: var(--text-accent);
      cursor: pointer;
      font-family: var(--font-monospace);
      font-size: ${this.isMobile ? '10px' : '12px'};
      flex-shrink: 0;
      min-width: ${this.isMobile ? '42px' : '55px'};
      transition: opacity 0.15s;
    `;

    timestamp.addEventListener('click', (e) => {
      e.stopPropagation();
      this.seekToTime(segment.start);
    });

    timestamp.addEventListener('mouseenter', () => {
      timestamp.style.opacity = '0.7';
    });
    timestamp.addEventListener('mouseleave', () => {
      timestamp.style.opacity = '1';
    });

    // Text content (with >> marker stripped)
    const textEl = segmentEl.createSpan({
      cls: 'segment-text'
    });
    textEl.style.cssText = `
      flex: 1;
      line-height: ${this.isMobile ? '1.5' : '1.6'};
      font-size: ${this.isMobile ? '13px' : '14px'};
      color: var(--text-normal);
    `;
    textEl.textContent = displayText;

    // Make entire segment clickable (but timestamp is primary action)
    segmentEl.addEventListener('click', () => {
      this.seekToTime(segment.start);
    });
    segmentEl.style.cursor = 'pointer';

    // Hover effect
    segmentEl.addEventListener('mouseenter', () => {
      if (this.currentSegmentIndex !== segment.id) {
        segmentEl.style.background = 'var(--background-modifier-hover)';
      }
    });
    segmentEl.addEventListener('mouseleave', () => {
      if (this.currentSegmentIndex !== segment.id) {
        segmentEl.style.background = '';
      }
    });

    return segmentEl;
  }

  /**
   * Bind adapter events for playback sync (unified path for audio/video/iframe)
   */
  private bindAdapterEvents(): void {
    if (!this.adapter) return;

    // Cleanup previous subscription
    this.unsubscribeAdapter?.();

    this.unsubscribeAdapter = this.adapter.onTimeUpdate((currentTime) => {
      this.updateHighlight(currentTime);
    });
  }

  /**
   * @deprecated Legacy audio binding. Use bindAdapterEvents() for new code.
   */
  private bindAudioEvents(): void {
    if (!this.audioElement) return;

    this.boundTimeUpdateHandler = () => {
      const currentTime = this.audioElement!.currentTime;
      this.updateHighlight(currentTime);
    };

    this.audioElement.addEventListener('timeupdate', this.boundTimeUpdateHandler);
  }

  /**
   * Render a visual divider between speaker turns
   */
  private renderSpeakerDivider(parent: HTMLElement): void {
    const divider = parent.createDiv({ cls: 'speaker-divider' });
    divider.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 10px;
      color: var(--text-faint);
      font-size: 10px;
    `;

    // Left line
    const leftLine = divider.createSpan();
    leftLine.style.cssText = 'flex: 1; border-top: 1px dashed var(--background-modifier-border);';

    // Diamond marker
    divider.createSpan({ text: '\u25C6' }); // ◆

    // Right line
    const rightLine = divider.createSpan();
    rightLine.style.cssText = 'flex: 1; border-top: 1px dashed var(--background-modifier-border);';
  }

  /**
   * Update highlight based on current playback time
   */
  private updateHighlight(currentTime: number): void {
    // Find current segment
    const segmentIndex = this.segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.end
    );

    const segmentId = segmentIndex >= 0 ? this.segments[segmentIndex]?.id : undefined;

    if (segmentId === this.currentSegmentIndex) return;

    // Remove old highlight
    if (this.currentSegmentIndex >= 0) {
      const oldEl = this.segmentElements.get(this.currentSegmentIndex);
      if (oldEl) {
        oldEl.style.background = '';
        oldEl.classList.remove('segment-active');
      }
    }

    // Add new highlight
    if (segmentId !== undefined && segmentId >= 0) {
      const newEl = this.segmentElements.get(segmentId);
      if (newEl) {
        newEl.style.background = 'var(--background-modifier-active-hover)';
        newEl.classList.add('segment-active');

        // Auto-scroll if enabled (scroll within container only, not the whole page)
        if (this.autoScroll && !this.isCollapsed && this.segmentsListEl) {
          const containerRect = this.segmentsListEl.getBoundingClientRect();
          const elementRect = newEl.getBoundingClientRect();
          const scrollTop = this.segmentsListEl.scrollTop;

          // Calculate position to center the element within the container
          const elementCenter = elementRect.top - containerRect.top + scrollTop + (elementRect.height / 2);
          const containerCenter = containerRect.height / 2;
          const targetScroll = elementCenter - containerCenter;

          this.segmentsListEl.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'smooth'
          });
        }
      }
    }

    this.currentSegmentIndex = segmentId ?? -1;
  }

  /**
   * Filter segments based on search query
   */
  private filterSegments(): void {
    for (const [id, element] of this.segmentElements) {
      const segment = this.segments.find((s) => s.id === id);
      if (!segment) continue;

      const textEl = element.querySelector('.segment-text');
      if (!textEl) continue;

      // Strip >> or - marker for display (OpenAI Whisper uses >>, whisper.cpp uses -)
      const rawText = segment.text.trim();
      const displayText = (rawText.startsWith('>>') || rawText.startsWith('-'))
        ? rawText.replace(/^(>>|-)\s*/, '')
        : rawText;

      if (this.searchQuery === '') {
        // Show all, remove highlighting
        element.style.display = 'flex';
        textEl.innerHTML = '';
        textEl.textContent = displayText;
      } else if (displayText.toLowerCase().includes(this.searchQuery)) {
        // Show and highlight matches
        element.style.display = 'flex';
        this.highlightText(textEl as HTMLElement, displayText, this.searchQuery);
      } else {
        // Hide non-matching
        element.style.display = 'none';
      }
    }
  }

  /**
   * Highlight search matches in text
   */
  private highlightText(element: HTMLElement, text: string, query: string): void {
    element.innerHTML = '';

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let lastIndex = 0;

    let index = lowerText.indexOf(lowerQuery);
    while (index !== -1) {
      // Add text before match
      if (index > lastIndex) {
        element.appendChild(document.createTextNode(text.substring(lastIndex, index)));
      }

      // Add highlighted match
      const mark = document.createElement('mark');
      mark.style.cssText = `
        background: var(--text-highlight-bg);
        color: var(--text-normal);
        padding: 0 2px;
        border-radius: 2px;
      `;
      mark.textContent = text.substring(index, index + query.length);
      element.appendChild(mark);

      lastIndex = index + query.length;
      index = lowerText.indexOf(lowerQuery, lastIndex);
    }

    // Add remaining text
    if (lastIndex < text.length) {
      element.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
  }

  /**
   * Seek media to specific time (works with adapter or legacy audioElement)
   */
  private seekToTime(seconds: number): void {
    if (this.adapter) {
      this.adapter.seekTo(seconds);
      this.adapter.play();
    } else if (this.audioElement) {
      this.audioElement.currentTime = seconds;
      this.audioElement.play().catch(() => {
        // Ignore autoplay errors
      });
    }
    this.onTimestampClick?.(seconds);
  }

  /**
   * Toggle collapsed state
   */
  private toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;

    if (this.contentEl) {
      this.contentEl.style.display = this.isCollapsed ? 'none' : 'block';
    }

    // Update icon
    const icon = this.container?.querySelector('.collapse-icon');
    if (icon) {
      icon.innerHTML = '';
      setIcon(icon as HTMLElement, this.isCollapsed ? 'chevron-right' : 'chevron-down');
    }
  }

  /**
   * Format seconds to timestamp string
   */
  private formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Expand the transcript section
   */
  expand(): void {
    if (this.isCollapsed) {
      this.toggleCollapse();
    }
  }

  /**
   * Collapse the transcript section
   */
  collapse(): void {
    if (!this.isCollapsed) {
      this.toggleCollapse();
    }
  }

  /**
   * Jump to a specific segment by ID
   */
  jumpToSegment(segmentId: number): void {
    const segment = this.segments.find((s) => s.id === segmentId);
    if (segment) {
      this.expand();
      this.seekToTime(segment.start);
    }
  }

  /**
   * Set playback adapter after render (e.g., when video loads async or after fallback)
   */
  setAdapter(adapter: PlaybackAdapter | null): void {
    // Cleanup previous adapter subscription
    this.unsubscribeAdapter?.();
    this.unsubscribeAdapter = null;

    // Cleanup legacy audio listener
    if (this.audioElement && this.boundTimeUpdateHandler) {
      this.audioElement.removeEventListener('timeupdate', this.boundTimeUpdateHandler);
      this.boundTimeUpdateHandler = null;
    }

    this.adapter = adapter;
    this.audioElement = null;

    if (adapter) {
      this.bindAdapterEvents();
    }
  }

  /**
   * @deprecated Use setAdapter() instead. Kept for backward compatibility.
   * Set audio element after render (useful when audio loads async)
   */
  setAudioElement(audioElement: HTMLAudioElement): void {
    this.setAdapter(new HtmlMediaPlaybackAdapter(audioElement));
  }

  /**
   * Switch to a different language transcript.
   * Updates segments, re-renders, and notifies parent.
   */
  switchLanguage(languageCode: string): void {
    if (languageCode === this.currentLanguage) return;

    // Get segments for the new language
    const newSegments = this.multilangSegments.get(languageCode);
    if (!newSegments || newSegments.length === 0) return;

    // Update current language
    this.currentLanguage = languageCode;
    this.segments = newSegments;

    // Re-render segments list
    if (this.segmentsListEl) {
      this.segmentsListEl.innerHTML = '';
      this.renderSegments(this.segmentsListEl);
    }

    // Update tab active state in the header
    if (this.container) {
      const tabs = this.container.querySelectorAll('.language-tab');
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        if (!tab) continue;
        const isActive = this.languages[i] === languageCode;
        const tabEl = tab as HTMLElement;
        tabEl.style.color = isActive ? 'var(--text-accent)' : 'var(--text-muted)';
        tabEl.style.background = isActive
          ? 'var(--background-modifier-active-hover)'
          : 'var(--background-modifier-hover)';
      }
    }

    // Re-evaluate highlight based on current playback time
    const currentTime = this.adapter?.getCurrentTime() ?? this.audioElement?.currentTime ?? 0;
    if (currentTime > 0) {
      this.updateHighlight(currentTime);
    }

    // Notify parent (VideoTranscriptPlayer will update caption overlay)
    this.onLanguageChange?.(languageCode);
  }

  /**
   * Cleanup - remove event listeners
   */
  destroy(): void {
    // Cleanup adapter subscription
    this.unsubscribeAdapter?.();
    this.unsubscribeAdapter = null;
    this.adapter = null;

    // Cleanup legacy audio listener
    if (this.audioElement && this.boundTimeUpdateHandler) {
      this.audioElement.removeEventListener('timeupdate', this.boundTimeUpdateHandler);
    }
    this.boundTimeUpdateHandler = null;
    this.audioElement = null;

    this.segmentElements.clear();
    this.container = null;
    this.contentEl = null;
    this.segmentsListEl = null;
  }
}
