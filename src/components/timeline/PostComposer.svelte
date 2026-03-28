<script lang="ts">
/**
 * PostComposer - Main container for creating user posts
 *
 * Provides a Facebook-style post creation interface with:
 * - Collapsed state (60px height with placeholder)
 * - Expanded state (full editor with media upload)
 * - Smooth transitions between states
 * - Mobile-responsive design
 * - Auto-save draft functionality
 * - Draft recovery on open
 */

import { onMount, onDestroy } from 'svelte';
import { Platform as ObsidianPlatform } from 'obsidian';
import type { App, EventRef } from 'obsidian';
import { Notice } from 'obsidian';
import type { PostData, Media, Platform } from '@/types/post';
import type { SocialArchiverSettings } from '@/types/settings';
import { DraftService } from '@/services/DraftService';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import MarkdownEditor from '@/components/editor/MarkdownEditor.svelte';
import { loadMediaFiles, cleanupMediaPreviews, type MediaLoadResult } from '@/utils/media';
import { isSupportedPlatformUrl, validateAndDetectPlatform, isPinterestBoardUrl } from '@/schemas/platforms';
// ArchiveSuggestionModal import removed - now using inline banners in PostCard
import type { ArchiveOrchestrator } from '@/services/ArchiveOrchestrator';
import { CrossPostAPIClient } from '@/services/CrossPostAPIClient';
import type { CrossPostRequest } from '@/types/crosspost';
import { ContentTransformerClient } from '@/utils/ContentTransformerClient';
import type { CrossPostStatusBanner } from '@/components/timeline/CrossPostStatusBanner';
import { FEATURE_CROSSPOST_ENABLED } from '@/shared/constants';

/**
 * Attached image data
 */
interface AttachedImage {
  id: string;
  file: File;
  preview: string;
  size: number;
}

/**
 * Component props
 */
interface PostComposerProps {
  app: App;
  settings: SocialArchiverSettings;
  archiveOrchestrator?: ArchiveOrchestrator;
  onPostCreated?: (post: PostData) => Promise<string>; // Returns file path
  onCrossPostComplete?: (filePath: string, crossPostId: string, threadsResult: { postId?: string; postUrl?: string }) => Promise<void>;
  onCrossPostStart?: () => CrossPostStatusBanner;
  onCancel?: () => void;
  onSaveSettings?: (partial?: Partial<SocialArchiverSettings>) => Promise<void>; // Persist settings changes (e.g., toggle state)
  // Edit mode props
  editMode?: boolean;
  initialData?: PostData;
  filePath?: string;
}

let {
  app,
  settings,
  archiveOrchestrator,
  onPostCreated,
  onCrossPostComplete,
  onCrossPostStart,
  onCancel,
  onSaveSettings,
  editMode = false,
  initialData,
  filePath
}: PostComposerProps = $props();

/**
 * Archive state tracking
 */
interface ArchiveState {
  url: string;
  platform: Platform;
  status: 'prompt' | 'archiving' | 'completed' | 'skipped' | 'failed';
  archivedData?: PostData;
  error?: string;
  isPinterestBoard?: boolean;
}

/**
 * Component state using Svelte 5 runes
 */
let isExpanded = $state(false);
let isSubmitting = $state(false);
let error = $state<string | null>(null);
let content = $state('');
let attachedImages = $state<AttachedImage[]>([]);
let detectedUrls = $state<string[]>([]);
let shareOnPost = $state(editMode && initialData?.shareUrl ? true : false); // Share to web toggle (enabled if shareUrl exists)

/**
 * Cross-post state (inline — no separate panel component)
 */
let threadsConnected = $state(false);
let threadsUsername = $state<string | undefined>(undefined);
let threadsEnabled = $state(settings.crossPostThreadsEnabled ?? false);
let crossPostClient: CrossPostAPIClient | null = null;

// Post mode dropdown (mirrors share-web pattern)
type PostMode = 'post' | 'post+share' | 'post+share+threads';
let postMode = $state<PostMode>(
  threadsEnabled && threadsConnected ? 'post+share+threads' :
  (editMode && initialData?.shareUrl) ? 'post+share' : 'post'
);
let postModeMenuOpen = $state(false);

// Sync postMode → legacy flags
$effect(() => {
  shareOnPost = postMode === 'post+share' || postMode === 'post+share+threads';
  threadsEnabled = postMode === 'post+share+threads';
});
let threadsConnectionEventRef: EventRef | null = null;

/** Derived: thread chunk estimation using delimiter-aware splitting */
const THREADS_MAX_CHARS = 500;
const THREADS_MAX_THREAD_CHUNKS = 5;
const crossPostChunks = $derived(
  ContentTransformerClient.splitForThread(content, THREADS_MAX_CHARS, THREADS_MAX_THREAD_CHUNKS)
);
const crossPostThreadCount = $derived(crossPostChunks.length);
const crossPostOverLimit = $derived(crossPostThreadCount > 1);
const crossPostCharCount = $derived(
  ContentTransformerClient.stripMarkdown(content).length
);

/**
 * Social media URLs tracking (separate from regular URLs)
 * Map<url, ArchiveState>
 */
let socialUrls = $state<Map<string, ArchiveState>>(new Map());

/**
 * Archiving URLs (reactive array for UI updates)
 */
let archivingUrls = $state<string[]>([]);

/**
 * Track created file path for archiving updates
 */
let createdFilePath = $state<string | null>(null);

/**
 * Edit mode state
 */
let existingMedia = $state<Media[]>([]);
let deletedMediaPaths = $state<string[]>([]);
let loadedMediaResults = $state<MediaLoadResult[]>([]);

/**
 * Draft service
 */
let draftService: DraftService;
// Use unique draft ID for edit mode
const DRAFT_ID = $derived(editMode && filePath ? `edit-${filePath}` : 'post-composer-draft');

/**
 * Link preview renderer
 */
let linkPreviewRenderer: LinkPreviewRenderer;

/**
 * File input element
 */
let fileInputElement: HTMLInputElement | undefined = $state();
let composerRootElement: HTMLElement | undefined = $state();
let composerSafeAreaListener: (() => void) | null = null;
let composerVisualViewport: VisualViewport | null = null;

/**
 * Link preview container
 */
let linkPreviewContainer: HTMLElement | undefined = $state();

/**
 * Debounce timer for URL detection
 */
let urlDetectionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Editor reference
 */
let editorRef: any = $state(null);

/**
 * Load existing post for edit mode
 */
async function loadExistingPost(): Promise<void> {
  if (!editMode || !initialData) {
    return;
  }

  try {
    // Load content
    content = initialData.content.text || '';

    // Load existing media
    existingMedia = initialData.media || [];

    // Load detected URLs (these will show as link preview cards)
    detectedUrls = initialData.linkPreviews || [];

    // Load already processed URLs from YAML frontmatter
    // @ts-ignore - processedUrls is custom field to track URLs that user has seen modal for
    const processedUrlsFromYaml: string[] = initialData.processedUrls || [];

    // Mark all processed URLs to skip re-archiving prompt
    for (const url of processedUrlsFromYaml) {
      const validation = validateAndDetectPlatform(url);
      if (validation.isValid && validation.platform) {
        socialUrls.set(url, {
          url: url,
          platform: validation.platform,
          status: 'skipped'
        });
      }
    }

    // Convert vault media files to preview URLs
    if (existingMedia.length > 0) {
      const mediaPaths = existingMedia.map(m => m.url);
      loadedMediaResults = await loadMediaFiles(app.vault, mediaPaths);

      // Convert to attachedImages format for preview
      const convertedImages: AttachedImage[] = [];
      for (const result of loadedMediaResults) {
        if (result.file && result.previewUrl) {
          convertedImages.push({
            id: `existing-${result.path}`,
            file: result.file,
            preview: result.previewUrl,
            size: result.file.size
          });
        }
      }

      attachedImages = convertedImages;
    }
  } catch (err) {
    error = `Failed to load post: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

/**
 * Expand the composer to show full editor
 */
async function expand(): Promise<void> {
  isExpanded = true;
  error = null;

  // Load existing post in edit mode
  if (editMode) {
    await loadExistingPost();
  } else {
    // Auto-recover draft without notification (only in create mode)
    try {
      const recovery = await draftService.recoverDrafts(DRAFT_ID);
      if (recovery.hasDraft && recovery.draft) {
        content = recovery.draft.content;
      }
    } catch {
      // Draft recovery failed silently
    }
  }

  // Start auto-save
  draftService.startAutoSave(DRAFT_ID, () => content);

  // Re-check Threads connection (toggle state preserved via local $state)
  console.debug('[PostComposer] expand() threadsEnabled =', threadsEnabled);
  checkThreadsConnection();

  // Focus editor after DOM update (Windows compatibility fix)
  // Wait for Svelte to render the expanded editor before focusing
  window.setTimeout(() => {
    editorRef?.focus();
    applyComposerTopOverlapSafeArea();
  }, 100);
}

/**
 * Ensure composer is not overlapped by status bar/notch on mobile.
 * Calculates actual overlap against visual viewport top inset and
 * applies only the additional offset needed.
 */
function applyComposerTopOverlapSafeArea(): void {
  if (!composerRootElement) return;

  const viewport = window.visualViewport;
  const viewportTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
  const isPortrait = window.innerHeight >= window.innerWidth;
  const isIPhone = ObsidianPlatform.isIosApp && ObsidianPlatform.isPhone;
  const screenLongestEdge = Math.round(
    Math.max(window.screen.width || 0, window.screen.height || 0)
  );
  const isDynamicIslandIPhone = isIPhone && [852, 874, 932, 956].includes(screenLongestEdge);
  const iosMinTopInset = ObsidianPlatform.isIosApp && isPortrait
    ? (isIPhone ? (isDynamicIslandIPhone ? 59 : 44) : 24)
    : 0;
  // Android status bars on modern devices with camera cutouts are 28-48px.
  // Use 32px minimum (24px status bar + 8px breathing room) to match
  // the timeline container's --timeline-safe-area-top-extra offset.
  const androidMinTopInset = ObsidianPlatform.isAndroidApp ? 32 : 0;
  const expectedTopInset = Math.max(viewportTop, iosMinTopInset, androidMinTopInset);
  const composerTop = Math.round(composerRootElement.getBoundingClientRect().top);
  const overlap = Math.max(0, expectedTopInset - composerTop);

  composerRootElement.style.setProperty('--post-composer-safe-area-adjust-top', `${overlap}px`);
}

/**
 * Collapse the composer to show only placeholder
 */
function collapse(): void {
  closePostModeMenu();
  isExpanded = false;
  error = null;
  content = ''; // Clear content on collapse
  attachedImages = [];
  detectedUrls = [];
  socialUrls = new Map();

  // Clear editor content
  if (editorRef) {
    editorRef.clear();
  }

  // Clear link previews
  if (linkPreviewContainer) {
    linkPreviewContainer.innerHTML = '';
  }

  // Stop auto-save and delete draft
  draftService.stopAutoSave();
  draftService.deleteDraft(DRAFT_ID);
}

/**
 * Handle content change with debounced save
 */
function handleContentChange(): void {
  if (content.trim()) {
    draftService.saveDraft(DRAFT_ID, content, { debounce: true });
  }
}

/**
 * Initialize CrossPostAPIClient and check Threads connection status
 */
async function checkThreadsConnection(): Promise<void> {
  if (!settings.workerUrl || !settings.authToken) return;

  try {
    if (!crossPostClient) {
      crossPostClient = new CrossPostAPIClient({
        endpoint: settings.workerUrl,
        authToken: settings.authToken,
      });
      await crossPostClient.initialize();
    }

    const status = await crossPostClient.getConnectionStatus();
    threadsConnected = status.connected;
    threadsUsername = status.username;
  } catch {
    // Silently fail — cross-posting is optional
    threadsConnected = false;
  }
}

/**
 * Handle Threads toggle change (bind:checked updates threadsEnabled first).
 */
async function handleThreadsToggle(): Promise<void> {
  if (!threadsConnected) {
    // Revert — bind:checked already flipped threadsEnabled
    threadsEnabled = false;
    new Notice('Connect your Threads account in Settings → Cross-Post');
    return;
  }

  console.debug('[PostComposer] Threads toggle →', threadsEnabled);

  // Persist toggle state — pass partial directly to avoid stale reference issue
  await onSaveSettings?.({ crossPostThreadsEnabled: threadsEnabled });
}

/**
 * Handle post submission
 */
async function handleSubmit(): Promise<void> {
  if (isSubmitting || !content.trim()) return;

  // Inform user about thread splitting when Threads cross-post exceeds 500 chars
  if (threadsEnabled && threadsConnected && crossPostOverLimit) {
    const ok = window.confirm(
      `Your text will be split into ${crossPostThreadCount} connected thread posts on Threads. Continue?`
    );
    if (!ok) return;
  }

  try {
    isSubmitting = true;
    error = null;

    // Archive suggestions will be shown inline in the post card after saving
    // No longer showing modals during post creation

    // Convert attached images to media array
    // In edit mode: separate existing images (no file) from new images (with file)
    // In create mode: all images are new (with file)
    const media = attachedImages.map((img) => {
      // Check if this is an existing image (ID starts with "existing-")
      const isExisting = editMode && img.id.startsWith('existing-');

      if (isExisting) {
        // Existing image: don't include file, use original vault path
        const originalPath = img.id.replace('existing-', '');
        return {
          type: 'image' as const,
          url: originalPath, // Original vault path (not preview)
          width: 0,
          height: 0,
          // NO file property for existing images
        };
      } else {
        // New image: include file for upload
        return {
          type: 'image' as const,
          url: img.preview, // Temporary preview URL
          width: 0,
          height: 0,
          file: img.file, // Include file for upload
        };
      }
    });

    // Collect processed URLs (URLs that user has seen modal for)
    const processedUrlsToSave = new Set<string>();

    // Add existing processed URLs from YAML
    if (editMode && initialData) {
      // @ts-ignore
      const existing = initialData.processedUrls || [];
      existing.forEach((url: string) => processedUrlsToSave.add(url));
    }

    // Add newly processed URLs from this session
    for (const [url, state] of socialUrls) {
      // Any URL that went through modal (accepted, declined, or skipped)
      if (state.status === 'completed' || state.status === 'skipped' || state.status === 'failed') {
        processedUrlsToSave.add(url);
      }
    }


    // Create complete PostData
    let postData: Partial<PostData>;

    // IMPORTANT: Extract actual URLs from content (not from detectedUrls state)
    // detectedUrls may contain stale URLs from edit mode initialization
    const actualUrlsInContent = extractUrlsFromText(content);

    // Simple linkPreviews - just regular URLs (no archiving status)
    // Archiving URLs will be removed from linkPreviews when archiving completes
    postData = {
      platform: 'post',
      author: {
        name: settings.username || 'You',
        url: `https://social-archive.org/${settings.username}`,
        avatar: settings.userAvatar,
        handle: `@${settings.username}`,
      },
      content: {
        text: content,
      },
      media,
      metadata: {
        timestamp: new Date(),
      },
      linkPreviews: actualUrlsInContent,
      // Filter embedded archives - only keep those whose URLs still exist in content
      // Set to undefined if no embedded archives (not empty array, for Handlebars template)
      embeddedArchives: (() => {
        if (editMode && initialData?.embeddedArchives && initialData.embeddedArchives.length > 0) {
          const filtered = initialData.embeddedArchives.filter(archive => actualUrlsInContent.includes(archive.url));
          return filtered.length > 0 ? filtered : undefined;
        }
        return undefined;
      })(),
      // @ts-ignore - processedUrls tracks URLs that user has seen modal for
      // Also filter processedUrls - remove entries for URLs no longer in content
      processedUrls: Array.from(processedUrlsToSave).filter(url => {
        // Keep if it's a plain URL that's in actualUrlsInContent
        if (actualUrlsInContent.includes(url)) return true;
        // Keep if it's a declined URL whose base URL is in actualUrlsInContent
        if (url.startsWith('declined:')) {
          const baseUrl = url.replace('declined:', '');
          return actualUrlsInContent.includes(baseUrl);
        }
        return false;
      }),
    };

    // Add share-on-post flag if enabled OR if post was previously shared
    // In edit mode, if post was shared before, maintain share status
    const wasShared = editMode && initialData?.shareUrl;
    if (shareOnPost || wasShared) {
      // @ts-ignore - temporary property for share-on-post
      postData.shareOnPost = true;
    }

    // In edit mode, attach deletedMediaPaths as extra property
    // TimelineContainer will extract and use it for cleanup
    if (editMode && deletedMediaPaths.length > 0) {
      // @ts-ignore - temporary property for edit mode
      postData.deletedMediaPaths = deletedMediaPaths;
    }


    // Notify parent component and WAIT for save to complete
    if (onPostCreated) {
      const savedPath = await onPostCreated(postData as PostData);
      createdFilePath = savedPath; // Store file path for archiving updates
    }

    // Capture cross-post refs BEFORE collapse resets component state
    const shouldCrossPost = threadsEnabled && threadsConnected && !!crossPostClient;
    const capturedClient = crossPostClient;
    const capturedContent = content;
    const capturedFilePath = createdFilePath;
    const capturedOnCrossPostComplete = onCrossPostComplete;
    const capturedCrossPostOverLimit = crossPostOverLimit;
    const capturedThreadCount = crossPostThreadCount;
    const capturedOnCrossPostStart = onCrossPostStart;

    // Capture media File objects before collapse resets them
    const ALLOWED_CROSSPOST_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const capturedMediaFiles: File[] = attachedImages
      .filter(img => img.file && !img.id.startsWith('existing-'))
      .map(img => img.file!)
      .filter(file =>
        ALLOWED_CROSSPOST_MIMES.includes(file.type) && file.size <= 8 * 1024 * 1024
      );

    // Delete draft after successful post
    draftService.deleteDraft(DRAFT_ID);

    // Collapse composer IMMEDIATELY — UI unblocks here
    collapse();
    isSubmitting = false;

    // Fire-and-forget cross-post (runs after UI is already collapsed)
    if (shouldCrossPost && capturedClient) {
      const banner = capturedOnCrossPostStart?.();

      void (async () => {
        try {
          banner?.show();

          const plainText = ContentTransformerClient.stripMarkdown(capturedContent);

          // Upload media files if present
          let mediaR2Keys: string[] | undefined;
          if (capturedMediaFiles.length > 0) {
            const uploadResults = await Promise.allSettled(
              capturedMediaFiles.map(file => capturedClient.uploadMedia(file))
            );

            const successKeys = uploadResults
              .filter((r): r is PromiseFulfilledResult<{ r2Key: string }> => r.status === 'fulfilled')
              .map(r => r.value.r2Key);

            const failCount = uploadResults.filter(r => r.status === 'rejected').length;

            if (successKeys.length > 0) {
              mediaR2Keys = successKeys;
              if (failCount > 0) {
                console.warn(`[PostComposer] ${failCount} image(s) failed to upload — posting with ${successKeys.length} image(s)`);
              }
            } else if (failCount > 0) {
              console.warn('[PostComposer] All image uploads failed — posting text only');
            }
          }

          const crossPostRequest: CrossPostRequest = {
            content: {
              text: capturedContent,
              plainText,
              ...(mediaR2Keys && { mediaR2Keys }),
            },
            platforms: {
              threads: { enabled: true },
            },
            noteRef: capturedFilePath ? { vaultPath: capturedFilePath } : undefined,
          };

          const response = await capturedClient.crossPost(crossPostRequest);

          const threadsResult = response.results?.threads;
          if (threadsResult?.status === 'posted') {
            const msg = capturedCrossPostOverLimit
              ? `Cross-posted to Threads (${capturedThreadCount} thread posts)`
              : 'Cross-posted to Threads!';
            banner?.complete(msg);

            // Save cross-post metadata to frontmatter
            if (capturedFilePath && capturedOnCrossPostComplete) {
              try {
                await capturedOnCrossPostComplete(capturedFilePath, response.crossPostId, {
                  postId: threadsResult.postId,
                  postUrl: threadsResult.postUrl,
                });
              } catch {
                // Metadata save failure should not affect user experience
              }
            }
          } else if (threadsResult?.status === 'failed') {
            banner?.fail(threadsResult.error ?? 'Unknown error');
          } else {
            banner?.fail('Cross-post response missing Threads result');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          banner?.fail(msg);
        }
      })();
    }

    return; // Early return — isSubmitting already set to false above

  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to create post';
    isSubmitting = false;
  }
}

/**
 * Open file picker
 */
function openFilePicker(): void {
  fileInputElement?.click();
}

/**
 * Handle file selection
 */
async function handleFileSelect(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);

  if (files.length === 0) return;

  // Validate and process files
  for (const file of files) {
    // Check file type (MIME type or extension for HEIC)
    const extension = file.name.split('.').pop()?.toLowerCase();
    const validExtensions = ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif', 'bmp'];
    const isValidType = file.type.startsWith('image/') || (extension && validExtensions.includes(extension));

    if (!isValidType) {
      error = `Invalid file type: ${file.name}`;
      continue;
    }

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      error = `File too large: ${file.name} (max 10MB)`;
      continue;
    }

    // Check max images limit
    if (attachedImages.length >= 10) {
      error = 'Maximum 10 images allowed';
      break;
    }

    // Create preview and convert HEIC if needed
    try {
      let processedFile = file;

      // Convert HEIC to JPEG
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (extension === 'heic' || extension === 'heif') {
        try {
          const { detectAndConvertHEIC } = await import('../../utils/heic');
          const arrayBuffer = await file.arrayBuffer();
          const result = await detectAndConvertHEIC(arrayBuffer, extension, 0.95);

          // Create a new File object from converted data
          processedFile = new File([result.data], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
            type: 'image/jpeg'
          });
        } catch {
          error = `HEIC conversion failed: ${file.name}. Try converting to JPEG first.`;
          continue;
        }
      }

      const preview = await createPreview(processedFile);
      const image: AttachedImage = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        file: processedFile,
        preview,
        size: processedFile.size
      };
      attachedImages = [...attachedImages, image];
    } catch (err) {
      error = `Failed to process: ${file.name}`;
    }
  }

  // Reset input
  input.value = '';
}

/**
 * Create preview URL from file
 * Converts HEIC to JPEG for browser compatibility
 */
async function createPreview(file: File): Promise<string> {
  let previewFile = file;

  // Check if HEIC file (by extension)
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'heic' || extension === 'heif') {
    try {
      // Convert HEIC to JPEG for preview
      const { detectAndConvertHEIC } = await import('../../utils/heic');
      const arrayBuffer = await file.arrayBuffer();
      const result = await detectAndConvertHEIC(arrayBuffer, extension, 0.95);

      // Create a new File object from converted data
      previewFile = new File([result.data], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
        type: 'image/jpeg'
      });
    } catch {
      // Fall through to try original file
    }
  }

  // Create data URL for preview
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(previewFile);
  });
}

/**
 * Remove image
 * In edit mode, tracks deleted existing images for vault cleanup
 */
function removeImage(imageId: string): void {
  // In edit mode, if this is an existing image (ID starts with "existing-"),
  // add its path to deletedMediaPaths for cleanup
  if (editMode && imageId.startsWith('existing-')) {
    const path = imageId.replace('existing-', '');
    if (!deletedMediaPaths.includes(path)) {
      deletedMediaPaths = [...deletedMediaPaths, path];
    }
  }

  attachedImages = attachedImages.filter(img => img.id !== imageId);
}

/**
 * Detect URLs in content and separate into social media vs regular URLs
 * Only matches complete URLs with valid domains
 * Auto-cleans detectedUrls to remove URLs no longer in content
 * Auto-detects social media posting URLs and triggers archive suggestion
 */
function detectUrls(text: string): string[] {

  const urls: string[] = [];

  // Pattern 1: Markdown links [text](url)
  // More robust pattern that handles URLs with special characters
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = markdownLinkPattern.exec(text)) !== null) {
    let url = match[2];
    // Clean up common trailing punctuation and brackets that might be captured
    url = url.replace(/[.,;:!?)\]]+$/, '');
    urls.push(url);
  }

  // Pattern 2: Plain URLs (not in markdown)
  // Remove markdown links AND any trailing punctuation/brackets to avoid double-matching
  const textWithoutMarkdown = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)[)\].,;:!?]*/g, '');

  // Match plain URLs
  const plainUrlPattern = /(?:^|[^(])(https?:\/\/[^\s<>)\]]+)/g;
  let plainMatch;
  while ((plainMatch = plainUrlPattern.exec(textWithoutMarkdown)) !== null) {
    let url = plainMatch[1];
    // Clean up trailing punctuation and brackets
    url = url.replace(/[.,;:!?)\]]+$/, '');
    urls.push(url);
  }


  // Clean and filter URLs
  const validUrls = urls
    .map(url => {
      // Trim whitespace
      let cleaned = url.trim();

      // Remove any remaining leading/trailing special characters
      cleaned = cleaned.replace(/^[<([]+/, '');
      cleaned = cleaned.replace(/[>)\]]+$/, '');

      return cleaned;
    })
    .filter(url => {
      try {
        const parsed = new URL(url);
        // Must have valid hostname with at least one dot
        return parsed.hostname.includes('.');
      } catch {
        return false;
      }
    });

  const currentUrls = [...new Set(validUrls)]; // Remove duplicates

  // Separate URLs into social media posting URLs vs regular URLs
  const socialMediaUrls: string[] = [];
  const regularUrls: string[] = [];

  for (const url of currentUrls) {
    if (isSupportedPlatformUrl(url)) {
      // Validate that it's a POSTING URL (not just a profile URL)
      const validationResult = validateAndDetectPlatform(url);
      if (validationResult.valid && validationResult.platform) {
        socialMediaUrls.push(url);

        // Check if URL was already processed (from YAML)
        // @ts-ignore
        const processedUrls = initialData?.processedUrls || [];
        const alreadyProcessed = processedUrls.includes(url);

        const isPinterestBoardLink =
          validationResult.platform === 'pinterest' && isPinterestBoardUrl(url);

        if (alreadyProcessed) {
          // Skip already processed URLs
          if (!socialUrls.has(url)) {
            socialUrls.set(url, {
              url,
              platform: validationResult.platform,
              status: 'skipped',
              isPinterestBoard: isPinterestBoardLink
            });
          }
        } else if (!socialUrls.has(url)) {
          // Add to socialUrls Map with 'prompt' status
          const newState: ArchiveState = {
            url,
            platform: validationResult.platform,
            status: 'prompt',
            isPinterestBoard: isPinterestBoardLink
          };
          socialUrls.set(url, newState);
        }
      } else {
        // Platform URL but not a posting URL (e.g., profile page)
        regularUrls.push(url);
      }
    } else {
      regularUrls.push(url);
    }
  }


  // Auto-cleanup: Remove URLs from detectedUrls that are no longer in content
  const urlsToRemove: string[] = [];
  for (const existingUrl of detectedUrls) {
    if (!currentUrls.includes(existingUrl)) {
      urlsToRemove.push(existingUrl);
    }
  }

  if (urlsToRemove.length > 0) {
    detectedUrls = detectedUrls.filter(url => !urlsToRemove.includes(url));
  }

  // Auto-cleanup: Remove social URLs that are no longer in content
  const socialUrlsToRemove: string[] = [];
  for (const [existingSocialUrl] of socialUrls) {
    if (!currentUrls.includes(existingSocialUrl)) {
      socialUrlsToRemove.push(existingSocialUrl);
    }
  }

  if (socialUrlsToRemove.length > 0) {
    for (const urlToRemove of socialUrlsToRemove) {
      socialUrls.delete(urlToRemove);
    }
  }

  // Add new regular URLs to detectedUrls
  for (const url of regularUrls) {
    if (!detectedUrls.includes(url)) {
      detectedUrls = [...detectedUrls, url];
    }
  }

  // Also add social media URLs to detectedUrls so they appear in linkPreviews
  // This allows PostCard to show inline suggestion banners
  for (const url of socialMediaUrls) {
    if (!detectedUrls.includes(url)) {
      detectedUrls = [...detectedUrls, url];
    }
  }


  return currentUrls;
}

/**
 * Extract URLs from text (simpler version without state updates)
 * Used for getting actual URLs in content during submit
 */
function extractUrlsFromText(text: string): string[] {
  const urls: string[] = [];

  // Pattern 1: Markdown links [text](url)
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = markdownLinkPattern.exec(text)) !== null) {
    let url = match[2];
    url = url.replace(/[.,;:!?)\]]+$/, '');
    urls.push(url);
  }

  // Pattern 2: Plain URLs (not in markdown)
  const textWithoutMarkdown = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)[)\].,;:!?]*/g, '');
  const plainUrlPattern = /(?:^|[^(])(https?:\/\/[^\s<>)\]]+)/g;
  let plainMatch;
  while ((plainMatch = plainUrlPattern.exec(textWithoutMarkdown)) !== null) {
    let url = plainMatch[1];
    url = url.replace(/[.,;:!?)\]]+$/, '');
    urls.push(url);
  }

  // Clean and filter URLs
  const validUrls = urls
    .map(url => {
      let cleaned = url.trim();
      cleaned = cleaned.replace(/^[<([]+/, '');
      cleaned = cleaned.replace(/[>)\]]+$/, '');
      return cleaned;
    })
    .filter(url => {
      try {
        const parsed = new URL(url);
        return parsed.hostname.includes('.');
      } catch {
        return false;
      }
    });

  // Remove duplicates
  return Array.from(new Set(validUrls));
}

/**
 * Remove a detected URL from preview
 */
function removeUrlPreview(url: string): void {
  detectedUrls = detectedUrls.filter(u => u !== url);
}

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Close post mode dropdown on outside click
 */
function handleDocumentClick(e: MouseEvent): void {
  if (postModeMenuOpen && !(e.target as HTMLElement)?.closest('.post-mode-group') && !(e.target as HTMLElement)?.closest('.pm-portal')) {
    postModeMenuOpen = false;
  }
}

/** Caret button ref for positioning the portal dropdown */
let caretBtnEl: HTMLButtonElement | undefined;
let portalMenuEl: HTMLDivElement | null = null;

function openPostModeMenu(e: MouseEvent): void {
  e.stopPropagation();
  if (postModeMenuOpen) { closePostModeMenu(); return; }
  postModeMenuOpen = true;
  requestAnimationFrame(() => {
    if (!caretBtnEl || portalMenuEl) return;
    const rect = caretBtnEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'pm-portal';
    menu.style.cssText = `
      position:fixed; top:${rect.bottom + 4}px; right:${window.innerWidth - rect.right}px;
      width:220px; background:#1e1e1e; border:1px solid #444; border-radius:8px;
      box-shadow:0 8px 28px rgba(0,0,0,0.6); z-index:99999; overflow:hidden;
      font-family:var(--font-interface,-apple-system,BlinkMacSystemFont,sans-serif);
    `;
    menu.addEventListener('click', (ev) => ev.stopPropagation());

    const modes: Array<{ id: PostMode; label: string; desc: string }> = [
      { id: 'post', label: 'Post', desc: 'Save to vault only' },
      { id: 'post+share', label: 'Post & Share', desc: 'Save + public share link' },
    ];
    if (FEATURE_CROSSPOST_ENABLED) {
      modes.push({ id: 'post+share+threads', label: 'Post & Threads',
        desc: threadsConnected ? 'Save + share + crosspost' : 'Connect in Settings' });
    }

    for (let i = 0; i < modes.length; i++) {
      const m = modes[i]!;
      const isActive = postMode === m.id;
      const bgDefault = isActive ? '#252535' : '#1e1e1e';
      const btn = document.createElement('button');
      btn.style.cssText = `
        display:flex; align-items:center; width:100%; padding:11px 12px;
        border:none; background:${bgDefault}; cursor:pointer;
        text-align:left; font-family:inherit;
        ${i > 0 ? 'border-top:1px solid #333;' : ''}
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#2a2a2a'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = bgDefault; });

      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'flex:1; min-width:0;';

      const labelSpan = document.createElement('span');
      labelSpan.style.cssText = `display:block; font-size:13px; font-weight:500; color:${isActive ? '#7c85f5' : '#e0e0e0'}; line-height:1.2;`;
      labelSpan.textContent = m.label;

      const descSpan = document.createElement('span');
      descSpan.style.cssText = 'display:block; font-size:10px; color:#666; line-height:1.2; margin-top:1px;';
      descSpan.textContent = m.desc;

      textDiv.appendChild(labelSpan);
      textDiv.appendChild(descSpan);
      btn.appendChild(textDiv);

      const checkSpan = document.createElement('span');
      checkSpan.style.cssText = 'flex-shrink:0; width:16px; text-align:center; font-size:13px; font-weight:700; color:#7c85f5; margin-left:6px;';
      checkSpan.textContent = isActive ? '✓' : '';
      btn.appendChild(checkSpan);

      btn.addEventListener('click', () => {
        if (m.id === 'post+share+threads' && !threadsConnected) {
          new (Notice as any)('Connect Threads in Settings → Cross-Post');
        } else { postMode = m.id; }
        closePostModeMenu();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    portalMenuEl = menu;
  });
}

function closePostModeMenu(): void {
  postModeMenuOpen = false;
  if (portalMenuEl) {
    portalMenuEl.remove();
    portalMenuEl = null;
  }
}

/**
 * Handle cancel action
 */
function handleCancel(): void {

  // Delete draft on cancel
  if (content.trim()) {
    draftService.deleteDraft(DRAFT_ID);
  }

  // Clear content
  content = '';

  if (onCancel) {
    onCancel();
  }
  collapse();
}

/**
 * Handle escape key to collapse
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isExpanded) {
    handleCancel();
  }
}

/**
 * Handle keyboard events on close button
 */
function handleCloseKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    handleCancel();
  }
}

/**
 * Reactive effect for content changes with debouncing
 */
$effect(() => {
  if (content && isExpanded) {
    handleContentChange();

    // Clear existing timer
    if (urlDetectionTimer) {
      window.clearTimeout(urlDetectionTimer);
    }

    // Debounce URL detection (wait 2 seconds after user stops typing)
    // This prevents API calls while actively typing
    urlDetectionTimer = window.setTimeout(() => {
      urlDetectionTimer = null;
      // detectUrls now modifies detectedUrls internally
      detectUrls(content);
      renderLinkPreviews(detectedUrls);
    }, 2000); // 2 second delay - ensures user finished typing
  }

  // Cleanup timer when effect re-runs or component destroys
  return () => {
    if (urlDetectionTimer) {
      window.clearTimeout(urlDetectionTimer);
      urlDetectionTimer = null;
    }
  };
});

/**
 * Render link previews for detected URLs
 */
async function renderLinkPreviews(urls: string[]): Promise<void> {
  if (urls.length === 0) {
    return;
  }

  // Wait for DOM to be ready with multiple attempts
  let attempts = 0;
  const maxAttempts = 10;

  while (!linkPreviewContainer && attempts < maxAttempts) {
    await new Promise(resolve => window.setTimeout(resolve, 50));
    attempts++;
  }

  if (!linkPreviewContainer) {
    // Silent return - container will be available on next render cycle
    return;
  }

  // Clear existing previews
  linkPreviewContainer.empty();

  // Render new previews (simple, no special archiving state)
  if (linkPreviewRenderer) {
    await linkPreviewRenderer.renderPreviews(linkPreviewContainer, urls);
  }
}

/**
 * Trigger URL detection immediately (when user leaves editor)
 */
function triggerUrlDetection(): void {

  // Clear any pending timer
  if (urlDetectionTimer) {
    window.clearTimeout(urlDetectionTimer);
    urlDetectionTimer = null;
  }

  // Detect URLs immediately (detectUrls now modifies detectedUrls internally)
  detectUrls(content);

  // Render link previews for current detected URLs
  renderLinkPreviews(detectedUrls);
}

onMount(async () => {
  // Close post mode dropdown on outside click
  document.addEventListener('click', handleDocumentClick);

  // Initialize draft service
  draftService = new DraftService(app);
  await draftService.initialize();

  // Initialize link preview renderer
  linkPreviewRenderer = new LinkPreviewRenderer(settings.workerUrl);

  // Add global keydown listener
  window.addEventListener('keydown', handleKeydown);

  // Check Threads connection status (non-blocking, gated by feature flag)
  if (FEATURE_CROSSPOST_ENABLED) {
    checkThreadsConnection();

    // Listen for connection changes from Settings (connect/disconnect)
    threadsConnectionEventRef = app.workspace.on(
      'social-archiver:threads-connection-changed' as any,
      async () => {
        await checkThreadsConnection();
        // Disable toggle when disconnected (don't rely on settings prop which may be stale)
        if (!threadsConnected) {
          threadsEnabled = false;
        }
      }
    );
  }

  // Auto-expand in edit mode
  if (editMode) {
    await expand();
  }

  if (ObsidianPlatform.isMobile) {
    const apply = () => applyComposerTopOverlapSafeArea();
    composerSafeAreaListener = apply;
    composerVisualViewport = window.visualViewport ?? null;

    requestAnimationFrame(() => {
      apply();
      window.setTimeout(apply, 120);
    });

    composerVisualViewport?.addEventListener('resize', apply);
    composerVisualViewport?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
  }
});

onDestroy(() => {
  // Cleanup
  closePostModeMenu();
  document.removeEventListener('click', handleDocumentClick);
  window.removeEventListener('keydown', handleKeydown);

  // Clear URL detection timer
  if (urlDetectionTimer) {
    window.clearTimeout(urlDetectionTimer);
  }

  // Cleanup media preview URLs to prevent memory leaks
  if (loadedMediaResults.length > 0) {
    cleanupMediaPreviews(loadedMediaResults);
  }

  if (draftService) {
    draftService.cleanup();
  }

  // Cleanup cross-post client
  if (crossPostClient) {
    crossPostClient.dispose();
    crossPostClient = null;
  }

  // Cleanup workspace event listener
  if (threadsConnectionEventRef) {
    app.workspace.offref(threadsConnectionEventRef);
    threadsConnectionEventRef = null;
  }

  if (composerSafeAreaListener) {
    composerVisualViewport?.removeEventListener('resize', composerSafeAreaListener);
    composerVisualViewport?.removeEventListener('scroll', composerSafeAreaListener);
    window.removeEventListener('resize', composerSafeAreaListener);
    composerSafeAreaListener = null;
    composerVisualViewport = null;
  }
});
</script>

<div
  bind:this={composerRootElement}
  class="post-composer"
  class:expanded={isExpanded}
  role="region"
  aria-label="Create a post"
>
  {#if !isExpanded}
    <!-- Collapsed State -->
    <button
      type="button"
      class="composer-collapsed"
      onclick={expand}
      aria-label="Click to create a post"
    >
      <div class="avatar-placeholder">
        {#if settings.userAvatar}
          <img src={settings.userAvatar} alt={settings.username || 'You'} class="avatar-image" />
        {:else}
          <div class="avatar-initials">
            {(settings.username || 'You').charAt(0).toUpperCase()}
          </div>
        {/if}
      </div>

      <span class="placeholder-text">
        What's on your mind?
      </span>
    </button>
  {:else}
    <!-- Expanded State -->
    <div class="composer-expanded">
      <div class="composer-header">
        <h3 class="composer-title">{editMode ? 'Edit Post' : 'Create Post'}</h3>
        <span
          class="close-button"
          onclick={handleCancel}
          onkeydown={handleCloseKeydown}
          role="button"
          tabindex="0"
          aria-label="Close composer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/>
            <path d="m6 6 12 12"/>
          </svg>
        </span>
      </div>

      <div class="composer-body">
        {#if error}
          <div class="error-message" role="alert">
            {error}
          </div>
        {/if}


        <!-- Editor Toolbar -->
        <div class="editor-toolbar">
          <!-- Hidden file input -->
          <input
            type="file"
            bind:this={fileInputElement}
            onchange={handleFileSelect}
            accept="image/*"
            multiple
            style="display: none;"
          />

          <!-- Image button -->
          <button
            type="button"
            class="toolbar-btn"
            onclick={openFilePicker}
            disabled={isSubmitting || attachedImages.length >= 10}
            aria-label="Add images"
            title="Add images (max 10)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
              <circle cx="9" cy="9" r="2"/>
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
            {#if attachedImages.length > 0}
              <span class="image-count-badge">{attachedImages.length}</span>
            {/if}
          </button>

          <div class="toolbar-divider"></div>

          <!-- Bold -->
          <button
            type="button"
            class="toolbar-btn"
            onclick={() => editorRef?.getEditor()?.chain().focus().toggleBold().run()}
            class:is-active={editorRef?.getEditor()?.isActive('bold')}
            aria-label="Bold"
            title="Bold (Ctrl+B)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            onclick={() => editorRef?.getEditor()?.chain().focus().toggleItalic().run()}
            class:is-active={editorRef?.getEditor()?.isActive('italic')}
            aria-label="Italic"
            title="Italic (Ctrl+I)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" x2="10" y1="4" y2="4"/>
              <line x1="14" x2="5" y1="20" y2="20"/>
              <line x1="15" x2="9" y1="4" y2="20"/>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            onclick={() => editorRef?.getEditor()?.chain().focus().toggleStrike().run()}
            class:is-active={editorRef?.getEditor()?.isActive('strike')}
            aria-label="Strikethrough"
            title="Strikethrough"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 4H9a3 3 0 0 0-2.83 4"/>
              <path d="M14 12a4 4 0 0 1 0 8H6"/>
              <line x1="4" x2="20" y1="12" y2="12"/>
            </svg>
          </button>

          <div class="toolbar-divider"></div>

          <!-- Bullet List -->
          <button
            type="button"
            class="toolbar-btn"
            onclick={() => editorRef?.getEditor()?.chain().focus().toggleBulletList().run()}
            class:is-active={editorRef?.getEditor()?.isActive('bulletList')}
            aria-label="Bullet List"
            title="Bullet List"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" x2="21" y1="6" y2="6"/>
              <line x1="8" x2="21" y1="12" y2="12"/>
              <line x1="8" x2="21" y1="18" y2="18"/>
              <line x1="3" x2="3.01" y1="6" y2="6"/>
              <line x1="3" x2="3.01" y1="12" y2="12"/>
              <line x1="3" x2="3.01" y1="18" y2="18"/>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            onclick={() => editorRef?.getEditor()?.chain().focus().toggleOrderedList().run()}
            class:is-active={editorRef?.getEditor()?.isActive('orderedList')}
            aria-label="Numbered List"
            title="Numbered List"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="10" x2="21" y1="6" y2="6"/>
              <line x1="10" x2="21" y1="12" y2="12"/>
              <line x1="10" x2="21" y1="18" y2="18"/>
              <path d="M4 6h1v4"/>
              <path d="M4 10h2"/>
              <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
            </svg>
          </button>
          <div class="toolbar-divider"></div>
          <button
            type="button"
            class="toolbar-btn"
            onclick={() => editorRef?.getEditor()?.chain().focus().toggleCodeBlock().run()}
            class:is-active={editorRef?.getEditor()?.isActive('codeBlock')}
            aria-label="Code Block"
            title="Code Block"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
          </button>
        </div>

        <!-- Markdown Editor with TipTap -->
        <MarkdownEditor
          bind:this={editorRef}
          content={content}
          placeholder="What's on your mind?"
          maxLength={10000}
          onUpdate={(markdown) => {
            content = markdown;
          }}
          onBlur={triggerUrlDetection}
          onPaste={triggerUrlDetection}
        />

        <!-- Link Previews -->
        {#if detectedUrls.length > 0}
          <div bind:this={linkPreviewContainer} class="link-previews-section"></div>
        {/if}

        <!-- Archiving Status -->
        {#each archivingUrls as url (url)}
          <div class="archiving-status">
            <span class="archiving-icon">⏳</span>
            <span class="archiving-text">Archiving: {new URL(url).hostname}{new URL(url).pathname.substring(0, 30)}...</span>
          </div>
        {/each}

        <!-- Image Previews -->
        {#if attachedImages.length > 0}
          <div
            class="image-previews"
            onwheel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {#each attachedImages as image (image.id)}
              <div class="image-preview-item">
                <img src={image.preview} alt="Preview" class="preview-image" />
                <button
                  type="button"
                  class="remove-image-btn"
                  onclick={() => removeImage(image.id)}
                  aria-label="Remove image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18"/>
                    <path d="m6 6 12 12"/>
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="composer-footer">
        <!-- Left side: Threads char badge (when applicable) -->
        <div class="footer-left-info">
          {#if !editMode && postMode === 'post+share+threads' && threadsConnected && content.trim()}
            <span class="crosspost-char-badge" class:will-thread={crossPostOverLimit}>
              {#if crossPostOverLimit}
                {crossPostCharCount} chars · {crossPostThreadCount} posts
              {:else}
                {crossPostCharCount}/{THREADS_MAX_CHARS}
              {/if}
            </span>
          {/if}
        </div>

        <!-- Right side: Cancel + split post button -->
        <div class="action-buttons">
          <button
            type="button"
            class="btn-secondary"
            onclick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>

          {#if editMode}
            <button type="button" class="btn-primary" onclick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          {:else}
            <!-- Split post button with mode dropdown -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="post-mode-group" role="group">
              <button
                type="button"
                class="btn-post-main"
                onclick={handleSubmit}
                disabled={isSubmitting}
              >
                {#if isSubmitting}
                  Posting...
                {:else if postMode === 'post+share+threads'}
                  Post & Threads
                {:else if postMode === 'post+share'}
                  Post & Share
                {:else}
                  Post
                {/if}
              </button>
              <button
                type="button"
                class="btn-post-caret"
                bind:this={caretBtnEl}
                onclick={openPostModeMenu}
                disabled={isSubmitting}
                aria-label="Post options"
              >
                <svg viewBox="0 0 10 6" width="8" height="5"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Main container */
  .post-composer {
    width: 100%;
    margin-bottom: 1rem;
    --post-composer-safe-area-adjust-top: 0px;
  }

  /* Collapsed state */
  .composer-collapsed {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 10px 12px;
    background: var(--background-primary);
    border: 0.5px solid var(--background-modifier-border);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: none;
  }

  .composer-collapsed:hover {
    background: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover);
  }

  .avatar-placeholder {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--background-modifier-border);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-initials {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .placeholder-text {
    flex: 1;
    font-size: 0.875rem;
    color: var(--text-muted);
    text-align: left;
  }

  /* Expanded state */
  .composer-expanded {
    background: var(--background-primary);
    border: none;
    border-radius: var(--radius-s);
    animation: expand 0.2s ease-out;
  }

  @keyframes expand {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .composer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 8px 16px;
    border-bottom: none;
  }

  .composer-title {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
    color: var(--text-normal);
  }

  .close-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-muted);
    transition: color 0.2s ease;
    line-height: 0;
  }

  .close-button:hover {
    color: var(--text-normal);
  }

  .composer-body {
    padding: 16px;
    min-height: 200px;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 0;
    margin-bottom: 12px;
  }

  .toolbar-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    outline: none;
    background: none;
    box-shadow: none;
    cursor: pointer;
    color: var(--text-muted);
    transition: color 0.15s ease;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }

  .toolbar-btn:hover:not(:disabled) {
    color: var(--text-normal);
  }

  .toolbar-btn:focus {
    outline: none;
    box-shadow: none;
  }

  .toolbar-btn:active {
    outline: none;
    box-shadow: none;
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar-btn.is-active {
    color: var(--interactive-accent);
  }

  .image-count-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 9px;
    font-weight: 600;
    border-radius: 50%;
    padding: 0 3px;
  }

  .toolbar-divider {
    width: 1px;
    height: 16px;
    background: var(--background-modifier-border);
    margin: 0 6px;
  }

  .link-previews-section {
    margin-top: 12px;
  }

  .archiving-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    margin-top: 8px;
    background: var(--background-secondary);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .archiving-icon {
    font-size: 14px;
  }

  .archiving-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .image-previews {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--background-modifier-border) transparent;
  }

  /* Webkit scrollbar styling */
  .image-previews::-webkit-scrollbar {
    height: 6px;
  }

  .image-previews::-webkit-scrollbar-track {
    background: transparent;
  }

  .image-previews::-webkit-scrollbar-thumb {
    background: var(--background-modifier-border);
    border-radius: 3px;
  }

  .image-previews::-webkit-scrollbar-thumb:hover {
    background: var(--background-modifier-border-hover);
  }

  .image-preview-item {
    position: relative;
    width: 80px;
    height: 80px;
    flex-shrink: 0;
    border-radius: 6px;
    overflow: hidden;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
  }

  .preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .remove-image-btn {
    position: absolute;
    top: 0;
    right: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0;
    cursor: pointer;
    color: var(--background-modifier-border);
    opacity: 1;
    transition: color 0.2s ease;
    padding: 0;
    box-shadow: none;
  }

  .remove-image-btn:hover {
    color: var(--text-error);
    background: transparent;
    transform: none;
  }

  .remove-image-btn svg {
    width: 14px;
    height: 14px;
  }

  .error-message {
    padding: 0.75rem;
    margin-bottom: 1rem;
    background: var(--background-modifier-error);
    border-left: 3px solid var(--text-error);
    border-radius: 6px;
    color: var(--text-error);
    font-size: 0.875rem;
  }

  .composer-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 16px 16px 16px;
    border-top: none;
  }

  .footer-left-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .crosspost-char-badge {
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .crosspost-char-badge.will-thread {
    color: var(--text-accent);
    font-weight: 600;
  }

  /* Split post button group */
  .post-mode-group {
    position: relative;
    display: inline-flex;
  }

  .btn-post-main {
    padding: 8px 14px;
    border: none;
    border-radius: var(--radius-s) 0 0 var(--radius-s);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    min-height: 32px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .btn-post-main:hover:not(:disabled) {
    opacity: 0.88;
  }

  .btn-post-main:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-post-caret {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    padding: 0;
    border: none;
    border-left: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0 var(--radius-s) var(--radius-s) 0;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    cursor: pointer;
    min-height: 32px;
    transition: opacity 0.15s;
  }

  .btn-post-caret:hover:not(:disabled) {
    opacity: 0.88;
  }

  .btn-post-caret:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Post mode dropdown menu — NO css variables, NO pseudo-elements */
  .post-mode-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: 220px;
    background-color: #1e1e1e !important;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
    z-index: 9999;
    overflow: hidden;
    opacity: 1 !important;
  }

  .pm-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 10px 12px;
    border: none;
    background-color: #1e1e1e !important;
    cursor: pointer;
    text-align: left;
    opacity: 1 !important;
  }

  .pm-item:hover {
    background-color: #2a2a2a !important;
  }

  .pm-item.active {
    background-color: #252535 !important;
  }

  .pm-item + .pm-item {
    border-top: 1px solid #333;
  }

  .pm-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .pm-label {
    font-size: 13px;
    font-weight: 500;
    color: #e0e0e0;
    line-height: 1.3;
  }

  .pm-item.active .pm-label {
    color: var(--interactive-accent, #7c85f5);
  }

  .pm-desc {
    font-size: 11px;
    color: #777;
    line-height: 1.3;
    margin-top: 2px;
  }

  .pm-check {
    flex-shrink: 0;
    width: 20px;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
    color: var(--interactive-accent, #7c85f5);
    margin-left: 8px;
  }

  .action-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-secondary,
  .btn-primary {
    padding: 8px 16px;
    border: none;
    border-radius: var(--radius-s);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    min-height: 32px;
  }

  .btn-secondary {
    background: var(--background-secondary);
    color: var(--text-normal);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--background-modifier-hover);
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .btn-secondary:disabled,
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Mobile responsiveness */
  @media (max-width: 640px) {
    .post-composer {
      padding-top: var(--post-composer-safe-area-adjust-top, 0px);
    }

    .composer-collapsed {
      min-height: 44px;
      padding: 8px 10px;
    }

    .avatar-placeholder {
      width: 24px;
      height: 24px;
    }

    .placeholder-text {
      font-size: 0.813rem;
    }

    .composer-expanded {
      border-radius: 0;
      margin: 0 -0.5rem;
    }

    .composer-body {
      min-height: 150px;
    }

    .composer-footer {
      flex-direction: column;
      gap: 0.75rem;
      align-items: stretch;
      padding: 12px 16px;
    }

    .footer-toggles {
      order: 2;
    }

    .action-buttons {
      order: 1;
      flex-direction: row;
      justify-content: space-between;
      gap: 12px;
    }

    /* iOS HIG 최소 터치 타겟 44px 적용 */
    .btn-secondary,
    .btn-primary {
      flex: 1;
      min-height: 44px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
    }

    /* 버튼 텍스트가 작아 보이지 않도록 조정 */
    .btn-primary {
      font-size: 15px;
    }

    .footer-toggles {
      padding: 8px 0;
    }

    .share-toggle-label {
      font-size: 14px;
    }

    .share-toggle-text {
      display: inline;
      font-size: 14px;
    }

    /* 에디터 툴바 버튼 모바일 최적화 */
    .editor-toolbar {
      gap: 4px;
      flex-wrap: wrap;
      padding: 10px 0;
    }

    .toolbar-btn {
      width: 36px;
      height: 36px;
      border-radius: 6px;
    }

    .toolbar-btn:active {
      background: var(--background-modifier-active-hover);
    }

    .toolbar-btn svg {
      width: 16px;
      height: 16px;
    }

    .toolbar-divider {
      margin: 0 4px;
    }

    /* 닫기 버튼도 크게 */
    .close-button {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: -8px;
    }

    .close-button svg {
      width: 20px;
      height: 20px;
    }

    /* 이미지 프리뷰 아이템 크기 증가 */
    .image-preview-item {
      width: 90px;
      height: 90px;
    }

    .remove-image-btn {
      width: 24px;
      height: 24px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 50%;
    }
  }
</style>
