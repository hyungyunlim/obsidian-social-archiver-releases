<script lang="ts">
/**
 * MediaGrid - Image preview grid component
 *
 * Features:
 * - Responsive CSS Grid layout (2 cols mobile, 3-4 cols desktop)
 * - Drag and drop reordering
 * - Delete with confirmation
 * - Alt text editing modal
 */

import { Notice } from 'obsidian';
import { onDestroy } from 'svelte';

/**
 * Grid item data (reusing AttachedImage interface)
 */
export interface GridImage {
  id: string;
  file: File;
  preview: string; // Data URL
  size: number;
  altText?: string;
  error?: string;
}

/**
 * Component props
 */
interface MediaGridProps {
  images: GridImage[];
  onReorder?: (images: GridImage[]) => void;
  onDelete?: (imageId: string) => void;
  onUpdateAltText?: (imageId: string, altText: string) => void;
}

let {
  images = $bindable([]),
  onReorder,
  onDelete,
  onUpdateAltText
}: MediaGridProps = $props();

/**
 * Component state
 */
let draggedIndex = $state<number | null>(null);
let dragOverIndex = $state<number | null>(null);
let editingImageId = $state<string | null>(null);
let editingAltText = $state('');
let pendingDeleteId = $state<string | null>(null);
let deleteTimeout = $state<NodeJS.Timeout | null>(null);

/**
 * Derived state
 */
let isEmpty = $derived(images.length === 0);
let editingImage = $derived(
  editingImageId ? images.find(img => img.id === editingImageId) : null
);

// Clean up pending delete timeout on component destroy
onDestroy(() => {
  if (deleteTimeout) {
    clearTimeout(deleteTimeout);
    deleteTimeout = null;
  }
});

/**
 * Drag and drop handlers
 */
function handleDragStart(event: DragEvent, index: number): void {
  if (!event.dataTransfer) return;

  draggedIndex = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/html', ''); // Required for Firefox

  // Add dragging class to target
  const target = event.target as HTMLElement;
  target.classList.add('dragging');
}

function handleDragEnd(event: DragEvent): void {
  const target = event.target as HTMLElement;
  target.classList.remove('dragging');
  draggedIndex = null;
  dragOverIndex = null;
}

function handleDragOver(event: DragEvent, index: number): void {
  event.preventDefault();
  if (!event.dataTransfer) return;

  event.dataTransfer.dropEffect = 'move';
  dragOverIndex = index;
}

function handleDragLeave(): void {
  dragOverIndex = null;
}

function handleDrop(event: DragEvent, dropIndex: number): void {
  event.preventDefault();

  if (draggedIndex === null || draggedIndex === dropIndex) {
    return;
  }

  // Reorder images array
  const newImages = [...images];
  const [draggedItem] = newImages.splice(draggedIndex, 1);
  newImages.splice(dropIndex, 0, draggedItem);

  // Update images
  images = newImages;

  // Notify parent
  if (onReorder) {
    onReorder(newImages);
  }

  draggedIndex = null;
  dragOverIndex = null;
}

/**
 * Delete handlers
 */
function handleDelete(imageId: string): void {
  // Set pending delete with undo capability
  pendingDeleteId = imageId;

  // Show undo notice
  const notice = new Notice('Image removed. Click to undo.', 5000);
  notice.messageEl.addEventListener('click', () => {
    handleUndoDelete();
    notice.hide();
  });

  // Set timeout for permanent deletion
  if (deleteTimeout) {
    clearTimeout(deleteTimeout);
  }

  deleteTimeout = setTimeout(() => {
    commitDelete(imageId);
  }, 5000);
}

function handleUndoDelete(): void {
  if (deleteTimeout) {
    clearTimeout(deleteTimeout);
    deleteTimeout = null;
  }
  pendingDeleteId = null;
}

function commitDelete(imageId: string): void {
  // Remove from images array
  images = images.filter(img => img.id !== imageId);

  // Notify parent
  if (onDelete) {
    onDelete(imageId);
  }

  pendingDeleteId = null;
  deleteTimeout = null;
}

/**
 * Alt text editing handlers
 */
function openAltTextModal(imageId: string): void {
  const image = images.find(img => img.id === imageId);
  if (!image) return;

  editingImageId = imageId;
  editingAltText = image.altText || '';
}

function closeAltTextModal(): void {
  editingImageId = null;
  editingAltText = '';
}

function saveAltText(): void {
  if (!editingImageId) return;

  // Update image alt text
  const imageIndex = images.findIndex(img => img.id === editingImageId);
  if (imageIndex !== -1) {
    images[imageIndex].altText = editingAltText;
  }

  // Notify parent
  if (onUpdateAltText) {
    onUpdateAltText(editingImageId, editingAltText);
  }

  closeAltTextModal();
}

/**
 * Keyboard navigation
 */
function handleKeyDown(event: KeyboardEvent, imageId: string): void {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    handleDelete(imageId);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openAltTextModal(imageId);
  }
}

function handleModalKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeAltTextModal();
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    saveAltText();
  }
}

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<div class="media-grid-container">
  {#if isEmpty}
    <div class="empty-state">
      <p class="empty-text">No images attached</p>
    </div>
  {:else}
    <div class="media-grid">
      {#each images as image, index (image.id)}
        <div
          class="grid-item"
          class:dragging={draggedIndex === index}
          class:drag-over={dragOverIndex === index}
          class:pending-delete={pendingDeleteId === image.id}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, index)}
          ondragend={handleDragEnd}
          ondragover={(e) => handleDragOver(e, index)}
          ondragleave={handleDragLeave}
          ondrop={(e) => handleDrop(e, index)}
          role="button"
          tabindex="0"
          onkeydown={(e) => handleKeyDown(e, image.id)}
        >
          <!-- Image Preview with Lazy Loading -->
          <div class="image-wrapper">
            <img
              src={image.preview}
              alt={image.altText || `Image ${index + 1}`}
              class="preview-image"
              loading="lazy"
              decoding="async"
            />

            <!-- Hover overlay with actions -->
            <div class="overlay">
              <button
                class="action-btn edit-btn"
                onclick={() => openAltTextModal(image.id)}
                title="Edit alt text"
                aria-label="Edit alt text"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>

              <button
                class="action-btn delete-btn"
                onclick={() => handleDelete(image.id)}
                title="Delete image"
                aria-label="Delete image"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- Image info -->
          <div class="image-info">
            <span class="file-size">{formatFileSize(image.size)}</span>
            {#if image.altText}
              <span class="alt-indicator" title={image.altText}>Alt</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Alt Text Modal -->
{#if editingImageId && editingImage}
  <div class="modal-overlay" onclick={closeAltTextModal}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h3>Edit Alt Text</h3>
        <button class="close-btn" onclick={closeAltTextModal} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="preview-container">
          <img src={editingImage.preview} alt="Preview" class="modal-preview" />
        </div>

        <div class="form-group">
          <label for="alt-text-input">
            Alt Text
            <span class="char-count">{editingAltText.length}/125</span>
          </label>
          <textarea
            id="alt-text-input"
            bind:value={editingAltText}
            maxlength="125"
            rows="3"
            placeholder="Describe this image for accessibility"
            onkeydown={handleModalKeyDown}
          ></textarea>
          <p class="help-text">
            Describe the image content for screen readers and accessibility
          </p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick={closeAltTextModal}>Cancel</button>
        <button class="btn-primary" onclick={saveAltText}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .media-grid-container {
    width: 100%;
    min-height: 100px;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 150px;
    border: 2px dashed var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
  }

  .empty-text {
    color: var(--text-muted);
    font-size: 14px;
  }

  /* Responsive Grid */
  .media-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  @media (min-width: 768px) {
    .media-grid {
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }
  }

  @media (min-width: 1024px) {
    .media-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  /* Grid Item */
  .grid-item {
    position: relative;
    border-radius: 6px;
    overflow: hidden;
    background: var(--background-secondary);
    cursor: move;
    transition: transform 0.2s, opacity 0.2s, box-shadow 0.2s;
  }

  .grid-item:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .grid-item:focus {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }

  .grid-item.dragging {
    opacity: 0.5;
    transform: scale(0.95);
  }

  .grid-item.drag-over {
    border: 2px solid var(--interactive-accent);
    transform: scale(1.05);
  }

  .grid-item.pending-delete {
    opacity: 0.3;
    pointer-events: none;
  }

  /* Image */
  .image-wrapper {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--background-secondary);
  }

  /* Loading skeleton placeholder */
  .image-wrapper::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      var(--background-secondary) 0%,
      var(--background-modifier-hover) 50%,
      var(--background-secondary) 100%
    );
    background-size: 200% 100%;
    animation: skeleton-loading 1.5s ease-in-out infinite;
    z-index: 0;
  }

  @keyframes skeleton-loading {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    position: relative;
    z-index: 1;
    /* Smooth fade-in when loaded */
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }

  .preview-image[src] {
    opacity: 1;
  }

  /* Overlay */
  .overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .grid-item:hover .overlay,
  .grid-item:focus-within .overlay {
    opacity: 1;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.9);
    color: var(--text-normal);
    cursor: pointer;
    transition: transform 0.2s, background 0.2s;
  }

  .action-btn:hover {
    transform: scale(1.1);
    background: white;
  }

  .delete-btn:hover {
    background: var(--text-error);
    color: white;
  }

  /* Image Info */
  .image-info {
    padding: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--text-muted);
  }

  .alt-indicator {
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--interactive-accent);
    color: white;
    font-weight: 500;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--background-primary);
    border-radius: 8px;
    max-width: 500px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .modal-body {
    padding: 1.5rem;
  }

  .preview-container {
    margin-bottom: 1.5rem;
    border-radius: 6px;
    overflow: hidden;
    background: var(--background-secondary);
  }

  .modal-preview {
    width: 100%;
    height: auto;
    max-height: 300px;
    object-fit: contain;
    display: block;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 500;
    font-size: 14px;
  }

  .char-count {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: normal;
  }

  .form-group textarea {
    padding: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-family: inherit;
    font-size: 14px;
    resize: vertical;
  }

  .form-group textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .help-text {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-secondary {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .btn-secondary:hover {
    background: var(--background-modifier-border);
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--interactive-accent-hover);
  }
</style>
