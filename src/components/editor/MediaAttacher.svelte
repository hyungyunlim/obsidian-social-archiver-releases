<script lang="ts">
/**
 * MediaAttacher - Image attachment component
 *
 * A reusable component for attaching images with:
 * - Drag and drop support (HTML5 API)
 * - File picker with mobile support
 * - Clipboard paste functionality
 * - 10-image limit with visual feedback
 * - File validation (type, size)
 * - Error handling and retry
 */

import { onMount, onDestroy } from 'svelte';

/**
 * Attached image data
 */
export interface AttachedImage {
  id: string;
  file: File;
  preview: string; // Data URL for preview
  size: number; // File size in bytes
  error?: string;
}

/**
 * Component props
 */
interface MediaAttacherProps {
  maxImages?: number;
  maxFileSize?: number; // In bytes (default: 10MB)
  acceptedTypes?: string[]; // MIME types
  onAttach?: (images: AttachedImage[]) => void;
  onRemove?: (imageId: string) => void;
  onError?: (error: string) => void;
}

let {
  maxImages = 10,
  maxFileSize = 10 * 1024 * 1024, // 10MB
  acceptedTypes = ['image/*'], // Accept all image types, validate in JavaScript
  onAttach,
  onRemove,
  onError
}: MediaAttacherProps = $props();

/**
 * Component state
 */
let attachedImages = $state<AttachedImage[]>([]);
let isDragOver = $state(false);
let isUploading = $state(false);
let errorMessage = $state<string | null>(null);
let fileInputElement: HTMLInputElement;
let dropZoneElement: HTMLDivElement;

/**
 * Derived state
 */
let imageCount = $derived(attachedImages.length);
let isLimitReached = $derived(imageCount >= maxImages);
let canAddMore = $derived(!isLimitReached && !isUploading);

/**
 * Generate unique ID for images
 */
function generateId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate file type
 * Supports wildcards like 'image/*' and specific MIME types
 * Also validates by file extension for formats like HEIC that may have missing MIME types
 */
function isValidFileType(file: File): boolean {
  // Check MIME type (if available)
  if (file.type) {
    const isValidMime = acceptedTypes.some(type => {
      if (type === 'image/*') {
        return file.type.startsWith('image/');
      }
      return file.type === type;
    });
    if (isValidMime) return true;
  }

  // Fallback: Check file extension for formats like HEIC
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension) {
    const imageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif', 'bmp'];
    return imageExtensions.includes(extension);
  }

  return false;
}

/**
 * Validate file size
 */
function isValidFileSize(file: File): boolean {
  return file.size <= maxFileSize;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Create preview URL from file
 */
function createPreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        resolve(e.target.result as string);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Validate and process files
 */
async function processFiles(files: File[]): Promise<void> {
  if (!canAddMore) {
    setError(`Maximum ${maxImages} images allowed`);
    return;
  }

  // Clear previous error
  errorMessage = null;
  isUploading = true;

  try {
    // Filter and validate files
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      // Check if we've reached the limit
      if (attachedImages.length + validFiles.length >= maxImages) {
        errors.push(`Maximum ${maxImages} images reached`);
        break;
      }

      // Validate file type
      if (!isValidFileType(file)) {
        errors.push(`${file.name}: Invalid file type. Only PNG, JPG, WebP allowed.`);
        continue;
      }

      // Validate file size
      if (!isValidFileSize(file)) {
        errors.push(`${file.name}: File too large. Maximum ${formatFileSize(maxFileSize)}.`);
        continue;
      }

      validFiles.push(file);
    }

    // Show errors if any
    if (errors.length > 0) {
      setError(errors.join('\n'));
    }

    // Process valid files
    for (const file of validFiles) {
      const id = generateId();
      const preview = await createPreview(file);

      const image: AttachedImage = {
        id,
        file,
        preview,
        size: file.size
      };

      attachedImages.push(image);
    }

    // Notify parent
    if (onAttach && validFiles.length > 0) {
      onAttach(attachedImages);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process files';
    setError(message);
  } finally {
    isUploading = false;
  }
}

/**
 * Remove image
 */
function removeImage(imageId: string): void {
  const index = attachedImages.findIndex(img => img.id === imageId);
  if (index !== -1) {
    // Revoke preview URL to free memory
    URL.revokeObjectURL(attachedImages[index].preview);
    attachedImages.splice(index, 1);

    // Notify parent
    if (onRemove) {
      onRemove(imageId);
    }

    // Clear error when removing images
    errorMessage = null;
  }
}

/**
 * Clear all images
 */
export function clearAll(): void {
  // Revoke all preview URLs
  attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
  attachedImages = [];
  errorMessage = null;
}

/**
 * Get attached images
 */
export function getImages(): AttachedImage[] {
  return [...attachedImages];
}

/**
 * Set error message
 */
function setError(message: string): void {
  errorMessage = message;
  if (onError) {
    onError(message);
  }
}

/**
 * Handle file input change
 */
function handleFileInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const files = Array.from(target.files);
    processFiles(files);
    // Reset input so same file can be selected again
    target.value = '';
  }
}

/**
 * Handle click on upload button
 */
function handleUploadClick(): void {
  fileInputElement?.click();
}

/**
 * Handle drag over event
 */
function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();

  if (!canAddMore) return;

  // Set correct dropEffect
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

/**
 * Handle drag enter event
 */
function handleDragEnter(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();

  if (!canAddMore) return;

  isDragOver = true;
}

/**
 * Handle drag leave event
 */
function handleDragLeave(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();

  // Only set isDragOver to false if leaving the drop zone entirely
  const target = event.target as HTMLElement;
  const relatedTarget = event.relatedTarget as HTMLElement;

  if (!dropZoneElement?.contains(relatedTarget)) {
    isDragOver = false;
  }
}

/**
 * Handle drop event
 */
function handleDrop(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();

  isDragOver = false;

  if (!canAddMore) {
    setError(`Maximum ${maxImages} images allowed`);
    return;
  }

  // Get dropped files
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const fileArray = Array.from(files);
    // Filter for image files (including HEIC by extension)
    const imageFiles = fileArray.filter(file => isValidFileType(file));

    if (imageFiles.length === 0) {
      setError('No valid image files found. Please drop PNG, JPG, WebP, or HEIC files.');
      return;
    }

    processFiles(imageFiles);
  }
}

/**
 * Handle paste event from clipboard
 */
function handlePaste(event: ClipboardEvent): void {
  if (!canAddMore) {
    setError(`Maximum ${maxImages} images allowed`);
    return;
  }

  const items = event.clipboardData?.items;
  if (!items) return;

  const imageFiles: File[] = [];

  // Process clipboard items
  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Check if item is an image
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file && isValidFileType(file)) {
        imageFiles.push(file);
      }
    }
  }

  // Process pasted images
  if (imageFiles.length > 0) {
    event.preventDefault();
    processFiles(imageFiles);
  }
}

/**
 * Lifecycle: Mount
 */
onMount(() => {
  if (dropZoneElement) {
    // Add drag-drop event listeners
    dropZoneElement.addEventListener('dragover', handleDragOver);
    dropZoneElement.addEventListener('dragenter', handleDragEnter);
    dropZoneElement.addEventListener('dragleave', handleDragLeave);
    dropZoneElement.addEventListener('drop', handleDrop);
  }

  // Add paste event listener to document
  document.addEventListener('paste', handlePaste);
});

/**
 * Lifecycle: Destroy
 */
onDestroy(() => {
  // Clean up preview URLs
  attachedImages.forEach(img => URL.revokeObjectURL(img.preview));

  // Remove drag-drop event listeners
  if (dropZoneElement) {
    dropZoneElement.removeEventListener('dragover', handleDragOver);
    dropZoneElement.removeEventListener('dragenter', handleDragEnter);
    dropZoneElement.removeEventListener('dragleave', handleDragLeave);
    dropZoneElement.removeEventListener('drop', handleDrop);
  }

  // Remove paste event listener
  document.removeEventListener('paste', handlePaste);
});
</script>

<div class="media-attacher-container">
  <!-- Drop zone -->
  <div
    bind:this={dropZoneElement}
    class="drop-zone"
    class:drag-over={isDragOver}
    class:disabled={!canAddMore}
  >
    <div class="drop-zone-content">
      {#if isUploading}
        <div class="uploading-indicator">
          <div class="spinner"></div>
          <p>Processing images...</p>
        </div>
      {:else if imageCount === 0}
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <p class="title">Drop images here or click to upload</p>
          <p class="subtitle">PNG, JPG, WebP • Max {formatFileSize(maxFileSize)} per file</p>
          <button type="button" class="upload-button" onclick={handleUploadClick} disabled={!canAddMore}>
            Choose Files
          </button>
        </div>
      {:else}
        <div class="images-preview">
          {#each attachedImages as image (image.id)}
            <div class="image-card">
              <img src={image.preview} alt="Preview" />
              <button
                type="button"
                class="remove-button"
                onclick={() => removeImage(image.id)}
                aria-label="Remove image"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <div class="image-info">
                <span class="file-size">{formatFileSize(image.size)}</span>
              </div>
            </div>
          {/each}

          {#if canAddMore}
            <button type="button" class="add-more-button" onclick={handleUploadClick}>
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Add More</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Image count indicator -->
  <div class="image-count" class:warning={imageCount >= maxImages - 2} class:error={isLimitReached}>
    {imageCount} / {maxImages} images
    {#if isLimitReached}
      <span class="limit-text">Limit reached</span>
    {/if}
  </div>

  <!-- Error message -->
  {#if errorMessage}
    <div class="error-message" role="alert">
      {errorMessage}
    </div>
  {/if}

  <!-- Hidden file input -->
  <input
    bind:this={fileInputElement}
    type="file"
    accept={acceptedTypes.join(',')}
    multiple
    capture="environment"
    onchange={handleFileInputChange}
    class="file-input"
    aria-label="Upload images"
    tabindex="-1"
  />
</div>

<style>
  .media-attacher-container {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .drop-zone {
    min-height: 200px;
    border: 2px dashed var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-primary);
    transition: all 0.2s ease;
    position: relative;
  }

  .drop-zone.drag-over {
    border-color: var(--interactive-accent);
    background: var(--interactive-accent-hover);
    opacity: 0.8;
  }

  .drop-zone.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .drop-zone-content {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
  }

  .empty-state .icon {
    width: 48px;
    height: 48px;
    color: var(--text-muted);
  }

  .empty-state .title {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-normal);
  }

  .empty-state .subtitle {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .upload-button {
    padding: 0.5rem 1.5rem;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .upload-button:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .upload-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .uploading-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .images-preview {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 1rem;
    width: 100%;
  }

  .image-card {
    position: relative;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    transition: transform 0.2s ease;
  }

  .image-card:hover {
    transform: scale(1.05);
  }

  .image-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .remove-button {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    width: 24px;
    height: 24px;
    padding: 0;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .image-card:hover .remove-button {
    opacity: 1;
  }

  .remove-button svg {
    width: 16px;
    height: 16px;
    color: white;
    stroke-width: 2;
  }

  .remove-button:hover {
    background: rgba(0, 0, 0, 0.9);
  }

  .image-info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0.25rem 0.5rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .file-size {
    font-size: 0.75rem;
    color: white;
  }

  .add-more-button {
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 2px dashed var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 1rem;
  }

  .add-more-button:hover {
    border-color: var(--interactive-accent);
    background: var(--interactive-accent-hover);
  }

  .add-more-button .icon {
    width: 24px;
    height: 24px;
    color: var(--text-muted);
  }

  .add-more-button span {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .image-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-muted);
    padding: 0.25rem 0.5rem;
  }

  .image-count.warning {
    color: var(--text-warning);
    font-weight: 500;
  }

  .image-count.error {
    color: var(--text-error);
    font-weight: 500;
  }

  .limit-text {
    padding: 0.25rem 0.5rem;
    background: var(--background-modifier-error);
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .error-message {
    padding: 0.75rem;
    background: var(--background-modifier-error);
    border-left: 3px solid var(--text-error);
    border-radius: 4px;
    color: var(--text-error);
    font-size: 0.875rem;
    white-space: pre-wrap;
  }

  .file-input {
    display: none;
  }

  /* Mobile responsive */
  @media (max-width: 640px) {
    .images-preview {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 0.75rem;
    }

    .drop-zone {
      min-height: 160px;
    }

    .drop-zone-content {
      padding: 1rem;
    }

    .empty-state .icon {
      width: 40px;
      height: 40px;
    }
  }
</style>
