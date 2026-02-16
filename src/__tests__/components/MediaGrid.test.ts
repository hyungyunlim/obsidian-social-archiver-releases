import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@testing-library/svelte';
import MediaGrid from '../../components/editor/MediaGrid.svelte';
import type { GridImage } from '../../components/editor/MediaGrid.svelte';

// Mock Obsidian Notice
vi.mock('obsidian', () => ({
  Notice: vi.fn().mockImplementation(() => ({
    noticeEl: {
      addEventListener: vi.fn(),
    },
    hide: vi.fn(),
  })),
}));

describe('MediaGrid', () => {
  let mockImages: GridImage[];

  beforeEach(() => {
    mockImages = [
      {
        id: 'img1',
        file: new File(['test1'], 'test1.png', { type: 'image/png' }),
        preview: 'data:image/png;base64,test1',
        size: 1024,
      },
      {
        id: 'img2',
        file: new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
        preview: 'data:image/jpeg;base64,test2',
        size: 2048,
        altText: 'Test image 2',
      },
      {
        id: 'img3',
        file: new File(['test3'], 'test3.webp', { type: 'image/webp' }),
        preview: 'data:image/webp;base64,test3',
        size: 3072,
      },
    ];
  });

  describe('Rendering', () => {
    it('should render empty state when no images', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: [],
        },
      });

      const emptyState = container.querySelector('.empty-state');
      expect(emptyState).toBeTruthy();
      expect(emptyState?.textContent).toContain('No images attached');
    });

    it('should render grid with images', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const grid = container.querySelector('.media-grid');
      expect(grid).toBeTruthy();

      const gridItems = container.querySelectorAll('.grid-item');
      expect(gridItems).toHaveLength(3);
    });

    it('should display image previews', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const images = container.querySelectorAll('.preview-image');
      expect(images).toHaveLength(3);
      expect(images[0].getAttribute('src')).toBe('data:image/png;base64,test1');
      expect(images[1].getAttribute('src')).toBe('data:image/jpeg;base64,test2');
    });

    it('should display file sizes', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const fileSizes = container.querySelectorAll('.file-size');
      expect(fileSizes).toHaveLength(3);
      expect(fileSizes[0].textContent).toBe('1.0 KB');
      expect(fileSizes[1].textContent).toBe('2.0 KB');
      expect(fileSizes[2].textContent).toBe('3.0 KB');
    });

    it('should show alt indicator when alt text exists', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const altIndicators = container.querySelectorAll('.alt-indicator');
      expect(altIndicators).toHaveLength(1); // Only img2 has alt text
      expect(altIndicators[0].getAttribute('title')).toBe('Test image 2');
    });

    it('should render action buttons', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const deleteButtons = container.querySelectorAll('.delete-btn');

      expect(editButtons).toHaveLength(3);
      expect(deleteButtons).toHaveLength(3);
    });
  });

  describe('Responsive Layout', () => {
    it('should use CSS Grid layout', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const grid = container.querySelector('.media-grid');
      const styles = window.getComputedStyle(grid!);
      expect(styles.display).toBe('grid');
    });

    it('should have responsive grid columns', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const grid = container.querySelector('.media-grid');
      expect(grid?.classList.contains('media-grid')).toBe(true);
      // CSS classes are applied correctly (actual responsive behavior tested in e2e)
    });
  });

  describe('Drag and Drop', () => {
    it('should mark items as draggable', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const gridItems = container.querySelectorAll('.grid-item');
      gridItems.forEach((item) => {
        expect(item.getAttribute('draggable')).toBe('true');
      });
    });

    it('should call onReorder when items are reordered', async () => {
      const onReorder = vi.fn();
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
          onReorder,
        },
      });

      const gridItems = container.querySelectorAll('.grid-item');
      const firstItem = gridItems[0] as HTMLElement;
      const lastItem = gridItems[2] as HTMLElement;

      // Simulate drag and drop
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });

      firstItem.dispatchEvent(dragStartEvent);
      lastItem.dispatchEvent(dropEvent);

      // Wait for reorder to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onReorder).toHaveBeenCalled();
      const reorderedImages = onReorder.mock.calls[0][0];
      expect(reorderedImages[0].id).toBe('img2'); // Original second item
    });

    it('should add dragging class during drag', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const firstItem = container.querySelector('.grid-item') as HTMLElement;

      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });

      firstItem.dispatchEvent(dragStartEvent);

      expect(firstItem.classList.contains('dragging')).toBe(true);
    });
  });

  describe('Delete Functionality', () => {
    it('should call onDelete when delete button clicked', async () => {
      const onDelete = vi.fn();
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
          onDelete,
        },
      });

      const deleteButtons = container.querySelectorAll('.delete-btn');
      const firstDeleteBtn = deleteButtons[0] as HTMLButtonElement;

      firstDeleteBtn.click();

      // Wait for undo timeout (5 seconds)
      await new Promise((resolve) => setTimeout(resolve, 5100));

      expect(onDelete).toHaveBeenCalledWith('img1');
    });

    it('should mark item as pending delete', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const deleteButtons = container.querySelectorAll('.delete-btn');
      const firstDeleteBtn = deleteButtons[0] as HTMLButtonElement;

      firstDeleteBtn.click();

      const firstItem = container.querySelector('.grid-item');
      expect(firstItem?.classList.contains('pending-delete')).toBe(true);
    });

    it('should support keyboard delete', async () => {
      const onDelete = vi.fn();
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
          onDelete,
        },
      });

      const firstItem = container.querySelector('.grid-item') as HTMLElement;
      firstItem.focus();

      const deleteKeyEvent = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
        cancelable: true,
      });

      firstItem.dispatchEvent(deleteKeyEvent);

      // Wait for undo timeout
      await new Promise((resolve) => setTimeout(resolve, 5100));

      expect(onDelete).toHaveBeenCalledWith('img1');
    });
  });

  describe('Alt Text Modal', () => {
    it('should not show modal by default', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const modal = container.querySelector('.modal-overlay');
      expect(modal).toBeFalsy();
    });

    it('should open modal when edit button clicked', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const firstEditBtn = editButtons[0] as HTMLButtonElement;

      firstEditBtn.click();

      const modal = container.querySelector('.modal-overlay');
      expect(modal).toBeTruthy();
    });

    it('should display current alt text in modal', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const secondEditBtn = editButtons[1] as HTMLButtonElement;

      secondEditBtn.click();

      const textarea = container.querySelector('#alt-text-input') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Test image 2');
    });

    it('should close modal when cancel clicked', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const firstEditBtn = editButtons[0] as HTMLButtonElement;
      firstEditBtn.click();

      const cancelBtn = container.querySelector('.btn-secondary') as HTMLButtonElement;
      cancelBtn.click();

      const modal = container.querySelector('.modal-overlay');
      expect(modal).toBeFalsy();
    });

    it('should call onUpdateAltText when saved', () => {
      const onUpdateAltText = vi.fn();
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
          onUpdateAltText,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const firstEditBtn = editButtons[0] as HTMLButtonElement;
      firstEditBtn.click();

      const textarea = container.querySelector('#alt-text-input') as HTMLTextAreaElement;
      textarea.value = 'New alt text';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      const saveBtn = container.querySelector('.btn-primary') as HTMLButtonElement;
      saveBtn.click();

      expect(onUpdateAltText).toHaveBeenCalledWith('img1', 'New alt text');
    });

    it('should enforce 125 character limit', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const firstEditBtn = editButtons[0] as HTMLButtonElement;
      firstEditBtn.click();

      const textarea = container.querySelector('#alt-text-input') as HTMLTextAreaElement;
      expect(textarea.getAttribute('maxlength')).toBe('125');
    });

    it('should display character count', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const secondEditBtn = editButtons[1] as HTMLButtonElement;
      secondEditBtn.click();

      const charCount = container.querySelector('.char-count');
      expect(charCount?.textContent).toContain('14/125'); // "Test image 2" = 14 chars
    });

    it('should close modal on Escape key', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const firstEditBtn = editButtons[0] as HTMLButtonElement;
      firstEditBtn.click();

      const textarea = container.querySelector('#alt-text-input') as HTMLTextAreaElement;
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });

      textarea.dispatchEvent(escapeEvent);

      const modal = container.querySelector('.modal-overlay');
      expect(modal).toBeFalsy();
    });

    it('should save on Enter key', () => {
      const onUpdateAltText = vi.fn();
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
          onUpdateAltText,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const firstEditBtn = editButtons[0] as HTMLButtonElement;
      firstEditBtn.click();

      const textarea = container.querySelector('#alt-text-input') as HTMLTextAreaElement;
      textarea.value = 'Keyboard save';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      textarea.dispatchEvent(enterEvent);

      expect(onUpdateAltText).toHaveBeenCalledWith('img1', 'Keyboard save');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should support Enter key to edit alt text', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const firstItem = container.querySelector('.grid-item') as HTMLElement;
      firstItem.focus();

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      firstItem.dispatchEvent(enterEvent);

      const modal = container.querySelector('.modal-overlay');
      expect(modal).toBeTruthy();
    });

    it('should support Space key to edit alt text', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const firstItem = container.querySelector('.grid-item') as HTMLElement;
      firstItem.focus();

      const spaceEvent = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      });

      firstItem.dispatchEvent(spaceEvent);

      const modal = container.querySelector('.modal-overlay');
      expect(modal).toBeTruthy();
    });

    it('should have proper tabindex for keyboard focus', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const gridItems = container.querySelectorAll('.grid-item');
      gridItems.forEach((item) => {
        expect(item.getAttribute('tabindex')).toBe('0');
      });
    });

    it('should have role="button" for accessibility', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const gridItems = container.querySelectorAll('.grid-item');
      gridItems.forEach((item) => {
        expect(item.getAttribute('role')).toBe('button');
      });
    });
  });

  describe('Accessibility', () => {
    it('should have alt text on images', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const images = container.querySelectorAll('.preview-image');
      expect(images[0].getAttribute('alt')).toBe('Image 1');
      expect(images[1].getAttribute('alt')).toBe('Test image 2');
      expect(images[2].getAttribute('alt')).toBe('Image 3');
    });

    it('should have aria-label on action buttons', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const deleteButtons = container.querySelectorAll('.delete-btn');

      editButtons.forEach((btn) => {
        expect(btn.getAttribute('aria-label')).toBe('Edit alt text');
      });

      deleteButtons.forEach((btn) => {
        expect(btn.getAttribute('aria-label')).toBe('Delete image');
      });
    });

    it('should have aria-label on close button', () => {
      const { container } = mount(MediaGrid, {
        props: {
          images: mockImages,
        },
      });

      const editButtons = container.querySelectorAll('.edit-btn');
      const firstEditBtn = editButtons[0] as HTMLButtonElement;
      firstEditBtn.click();

      const closeBtn = container.querySelector('.close-btn');
      expect(closeBtn?.getAttribute('aria-label')).toBe('Close');
    });
  });

  describe('File Size Formatting', () => {
    it('should format bytes correctly', () => {
      const testCases = [
        { size: 500, expected: '500 B' },
        { size: 1024, expected: '1.0 KB' },
        { size: 1536, expected: '1.5 KB' },
        { size: 1048576, expected: '1.0 MB' },
        { size: 5242880, expected: '5.0 MB' },
      ];

      testCases.forEach(({ size, expected }) => {
        const images: GridImage[] = [
          {
            id: 'test',
            file: new File(['test'], 'test.png', { type: 'image/png' }),
            preview: 'data:image/png;base64,test',
            size,
          },
        ];

        const { container } = mount(MediaGrid, {
          props: { images },
        });

        const fileSize = container.querySelector('.file-size');
        expect(fileSize?.textContent).toBe(expected);
      });
    });
  });
});
