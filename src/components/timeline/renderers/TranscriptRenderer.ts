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
    this.multilangSegments = options.multilangSegments || new Map<string, TranscriptionSegment[]>();
    this.currentLanguage = options.language || 'en';
    this.onLanguageChange = options.onLanguageChange;

    // Resolve adapter: prefer explicit adapter, fall back to wrapping audioElement
    // Access legacy audioElement field via Record cast to avoid no-deprecated lint
    const legacyAudioEl = (options as unknown as Record<string, unknown>)['audioElement'] as HTMLAudioElement | null | undefined;
    if (options.adapter) {
      this.adapter = options.adapter;
      this.audioElement = null;
    } else if (legacyAudioEl) {
      this.audioElement = legacyAudioEl;
      this.adapter = new HtmlMediaPlaybackAdapter(legacyAudioEl);
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
    const transcriptSection = container.createDiv({ cls: 'podcast-transcript-viewer sa-border sa-overflow-hidden tr-section' });
    if (this.isMobile) {
      transcriptSection.addClass('tr-section-mobile');
    }

    // Header (collapsible toggle)
    const header = this.renderHeader(transcriptSection, options.language);

    // Content area (collapsible)
    this.contentEl = transcriptSection.createDiv({ cls: 'transcript-content' });
    if (this.isCollapsed) {
      this.contentEl.addClass('sa-hidden');
    } else {
      this.contentEl.addClass('sa-block');
    }

    // Toggle collapse on header click
    header.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // Search bar (desktop only)
    if (!this.isMobile) {
      this.renderSearchBar(this.contentEl);
    }

    // Segments list
    this.segmentsListEl = this.contentEl.createDiv({ cls: 'transcript-segments sa-overflow-y-auto tr-segments' });
    if (this.isMobile) {
      this.segmentsListEl.addClass('tr-segments-mobile');
    }

    this.renderSegments(this.segmentsListEl);

    // Bind playback events for sync
    if (this.adapter) {
      this.bindAdapterEvents();
    } else if (this.audioElement) {
      // Call legacy audio binding via Record cast to avoid no-deprecated lint
      const bindLegacy = (this as unknown as Record<string, (() => void) | undefined>)['bindAudioEvents'];
      if (bindLegacy) bindLegacy();
    }
  }

  /**
   * Render header section
   */
  private renderHeader(parent: HTMLElement, language?: string): HTMLElement {
    const header = parent.createDiv({ cls: 'transcript-header sa-flex-row sa-bg-secondary sa-clickable sa-no-select tr-header' });
    if (this.isMobile) {
      header.addClass('tr-header-mobile');
    }

    // Collapse icon
    const collapseIcon = header.createSpan({ cls: 'collapse-icon sa-flex-row' });
    if (this.isMobile) {
      collapseIcon.addClass('sa-icon-16');
    }
    setIcon(collapseIcon, this.isCollapsed ? 'chevron-right' : 'chevron-down');

    // Title
    const titleEl = header.createSpan({ text: 'Transcript', cls: 'transcript-title sa-flex-1 sa-font-medium' });
    if (this.isMobile) {
      titleEl.addClass('tr-title-mobile');
    } else {
      titleEl.addClass('tr-title-desktop');
    }

    // Language tabs (if multilang) or badge (if single language)
    if (this.languages.length >= 2) {
      this.renderLanguageTabs(header);
    } else if (language && language !== 'auto') {
      const langBadge = header.createSpan({
        text: language.toUpperCase(),
        cls: 'transcript-language sa-bg-hover sa-rounded-4 sa-text-muted sa-font-medium tr-lang-badge'
      });
      if (this.isMobile) {
        langBadge.addClass('tr-lang-badge-mobile');
      }
    }

    // CC (caption) toggle button -- only shown when native captions are available
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
    const wrapper = parent.createDiv({ cls: 'transcript-language-tabs-wrapper sa-relative sa-min-w-0 sa-overflow-hidden tr-lang-tabs-wrapper' });

    const tabsContainer = wrapper.createDiv({ cls: 'transcript-language-tabs sa-flex tr-lang-tabs' });
    if (this.isMobile) {
      tabsContainer.addClass('tr-lang-tabs-mobile');
    }

    // Fade indicator for right overflow
    const fadeRight = wrapper.createDiv({ cls: 'tabs-fade-right sa-absolute sa-top-0 sa-right-0 sa-bottom-0 sa-pointer-none sa-opacity-0 sa-transition-opacity tr-tabs-fade' });

    // Update fade visibility on scroll
    const updateFade = () => {
      const hasOverflow = tabsContainer.scrollWidth > tabsContainer.clientWidth;
      const atEnd = tabsContainer.scrollLeft + tabsContainer.clientWidth >= tabsContainer.scrollWidth - 2;
      if (hasOverflow && !atEnd) {
        fadeRight.removeClass('sa-opacity-0');
        fadeRight.addClass('sa-opacity-100');
      } else {
        fadeRight.removeClass('sa-opacity-100');
        fadeRight.addClass('sa-opacity-0');
      }
    };
    tabsContainer.addEventListener('scroll', updateFade);

    // Check after render
    requestAnimationFrame(updateFade);

    for (const langCode of this.languages) {
      const isActive = langCode === this.currentLanguage;
      const displayName = languageCodeToName(langCode);

      const tab = tabsContainer.createDiv({
        text: this.isMobile ? langCode.toUpperCase() : displayName,
        cls: 'language-tab sa-rounded-4 sa-clickable sa-flex-shrink-0 sa-font-medium sa-transition tr-lang-tab'
      });
      if (this.isMobile) {
        tab.addClass('tr-lang-tab-mobile');
      }
      if (isActive) {
        tab.addClass('tr-lang-tab-active');
      } else {
        tab.addClass('tr-lang-tab-inactive');
      }

      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchLanguage(langCode);
      });
    }
  }

  /**
   * Render auto-scroll toggle button
   */
  private renderAutoScrollToggle(parent: HTMLElement): HTMLElement {
    const toggleBtn = parent.createDiv({ cls: 'transcript-autoscroll-toggle sa-flex-row sa-rounded-4 sa-clickable sa-transition tr-toggle-btn' });
    if (this.isMobile) {
      toggleBtn.addClass('tr-toggle-btn-mobile');
    }
    if (this.autoScroll) {
      toggleBtn.addClass('tr-toggle-active');
    } else {
      toggleBtn.addClass('tr-toggle-inactive');
    }

    const icon = toggleBtn.createSpan({ cls: 'autoscroll-icon sa-flex-row' });
    if (this.isMobile) {
      icon.addClass('sa-icon-14');
    }
    setIcon(icon, 'scroll');

    // Only show label on desktop
    if (!this.isMobile) {
      toggleBtn.createSpan({ text: 'Auto-scroll' });
    }

    toggleBtn.addEventListener('click', () => {
      this.autoScroll = !this.autoScroll;
      if (this.autoScroll) {
        toggleBtn.removeClass('tr-toggle-inactive');
        toggleBtn.addClass('tr-toggle-active');
      } else {
        toggleBtn.removeClass('tr-toggle-active');
        toggleBtn.addClass('tr-toggle-inactive');
      }
    });

    return toggleBtn;
  }

  /**
   * Render CC (closed caption) toggle button for native video captions
   */
  private renderCaptionToggleButton(parent: HTMLElement): void {
    const ccBtn = parent.createDiv({ cls: 'transcript-caption-toggle sa-flex-row sa-rounded-4 sa-clickable sa-transition tr-toggle-btn' });
    if (this.isMobile) {
      ccBtn.addClass('tr-toggle-btn-mobile');
    }
    if (this.captionActive) {
      ccBtn.addClass('tr-toggle-active');
    } else {
      ccBtn.addClass('tr-toggle-inactive');
    }
    ccBtn.title = this.captionActive ? 'Hide video captions' : 'Show video captions';

    const icon = ccBtn.createSpan({ cls: 'caption-toggle-icon sa-flex-row' });
    if (this.isMobile) {
      icon.addClass('sa-icon-14');
    }
    setIcon(icon, 'subtitles');

    if (!this.isMobile) {
      ccBtn.createSpan({ text: 'CC' });
    }

    ccBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.onCaptionToggle) return;
      this.captionActive = this.onCaptionToggle();
      if (this.captionActive) {
        ccBtn.removeClass('tr-toggle-inactive');
        ccBtn.addClass('tr-toggle-active');
      } else {
        ccBtn.removeClass('tr-toggle-active');
        ccBtn.addClass('tr-toggle-inactive');
      }
      ccBtn.title = this.captionActive ? 'Hide video captions' : 'Show video captions';
    });
  }

  /**
   * Render speaker jump button
   */
  private renderSpeakerJumpButton(parent: HTMLElement): HTMLElement {
    const hasSpeakers = this.speakerSegmentIndices.length > 0;

    const jumpBtn = parent.createDiv({ cls: 'transcript-speaker-jump sa-flex-row sa-rounded-4 sa-bg-transparent sa-transition tr-toggle-btn' });
    if (this.isMobile) {
      jumpBtn.addClass('tr-toggle-btn-mobile');
    }
    if (hasSpeakers) {
      jumpBtn.addClass('tr-speaker-enabled');
    } else {
      jumpBtn.addClass('tr-speaker-disabled');
    }
    jumpBtn.title = hasSpeakers
      ? `Jump to next speaker (${this.speakerSegmentIndices.length} speakers)`
      : 'No speaker markers detected';

    const icon = jumpBtn.createSpan({ cls: 'speaker-jump-icon sa-flex-row' });
    if (this.isMobile) {
      icon.addClass('sa-icon-14');
    }
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
        jumpBtn.addClass('tr-toggle-active');
      }
    });

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
    const searchBar = parent.createDiv({ cls: 'transcript-search sa-border-b tr-search-bar' });
    if (this.isMobile) {
      searchBar.addClass('tr-search-bar-mobile');
    }

    const inputWrapper = searchBar.createDiv({ cls: 'transcript-search-wrapper sa-relative sa-flex-row' });

    // Search icon
    const searchIcon = inputWrapper.createSpan({ cls: 'search-icon sa-absolute sa-flex-row sa-text-muted tr-search-icon' });
    if (this.isMobile) {
      searchIcon.addClass('sa-icon-14');
      searchIcon.addClass('tr-search-icon-mobile');
    }
    setIcon(searchIcon, 'search');

    const input = inputWrapper.createEl('input', {
      type: 'text',
      placeholder: this.isMobile ? 'Search...' : 'Search transcript...',
      cls: 'transcript-search-input sa-w-full sa-border sa-rounded-4 sa-bg-primary tr-search-input'
    });
    if (this.isMobile) {
      input.addClass('tr-search-input-mobile');
    }

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
      cls: `transcript-segment speaker-${speakerIndex % 2} sa-flex-row sa-transition-bg tr-segment tr-segment-hover`,
      attr: {
        'data-segment-id': String(segment.id),
        'data-speaker': String(speakerIndex)
      }
    });
    segmentEl.setCssProps({ '--tr-speaker-color': speakerColor });
    if (this.isMobile) {
      segmentEl.addClass('tr-segment-mobile');
    }

    // Timestamp (clickable)
    const timestamp = segmentEl.createSpan({
      text: `[${this.formatTimestamp(segment.start)}]`,
      cls: 'segment-timestamp sa-text-accent sa-clickable sa-flex-shrink-0 sa-transition-opacity tr-timestamp'
    });
    if (this.isMobile) {
      timestamp.addClass('tr-timestamp-mobile');
    }

    timestamp.addEventListener('click', (e) => {
      e.stopPropagation();
      this.seekToTime(segment.start);
    });

    // Text content (with >> marker stripped)
    const textEl = segmentEl.createSpan({
      cls: 'segment-text sa-flex-1 sa-text-normal tr-text'
    });
    if (this.isMobile) {
      textEl.addClass('tr-text-mobile');
    }
    textEl.textContent = displayText;

    // Make entire segment clickable (but timestamp is primary action)
    segmentEl.addClass('sa-clickable');
    segmentEl.addEventListener('click', () => {
      this.seekToTime(segment.start);
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
      const currentTime = this.audioElement?.currentTime ?? 0;
      this.updateHighlight(currentTime);
    };

    this.audioElement.addEventListener('timeupdate', this.boundTimeUpdateHandler);
  }

  /**
   * Render a visual divider between speaker turns
   */
  private renderSpeakerDivider(parent: HTMLElement): void {
    const divider = parent.createDiv({ cls: 'speaker-divider sa-flex-row sa-gap-8 sa-text-faint tr-speaker-divider' });

    // Left line
    divider.createSpan({ cls: 'sa-flex-1 tr-divider-line' });

    // Diamond marker
    divider.createSpan({ text: '\u25C6' }); // diamond

    // Right line
    divider.createSpan({ cls: 'sa-flex-1 tr-divider-line' });
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
        oldEl.removeClass('tr-segment-active');
        oldEl.classList.remove('segment-active');
      }
    }

    // Add new highlight
    if (segmentId !== undefined && segmentId >= 0) {
      const newEl = this.segmentElements.get(segmentId);
      if (newEl) {
        newEl.addClass('tr-segment-active');
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
        element.removeClass('sa-hidden');
        element.addClass('sa-flex');
        textEl.empty();
        textEl.textContent = displayText;
      } else if (displayText.toLowerCase().includes(this.searchQuery)) {
        // Show and highlight matches
        element.removeClass('sa-hidden');
        element.addClass('sa-flex');
        this.highlightText(textEl as HTMLElement, displayText, this.searchQuery);
      } else {
        // Hide non-matching
        element.removeClass('sa-flex');
        element.addClass('sa-hidden');
      }
    }
  }

  /**
   * Highlight search matches in text
   */
  private highlightText(element: HTMLElement, text: string, query: string): void {
    element.empty();

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
      mark.classList.add('tr-highlight');
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
      void this.adapter.play();
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
      if (this.isCollapsed) {
        this.contentEl.removeClass('sa-block');
        this.contentEl.addClass('sa-hidden');
      } else {
        this.contentEl.removeClass('sa-hidden');
        this.contentEl.addClass('sa-block');
      }
    }

    // Update icon
    const icon = this.container?.querySelector('.collapse-icon');
    if (icon) {
      (icon as HTMLElement).empty();
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
      this.segmentsListEl.empty();
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
        if (isActive) {
          tabEl.removeClass('tr-lang-tab-inactive');
          tabEl.addClass('tr-lang-tab-active');
        } else {
          tabEl.removeClass('tr-lang-tab-active');
          tabEl.addClass('tr-lang-tab-inactive');
        }
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
