import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ImageOptimizer, ImageOptimizationError } from '../../services/ImageOptimizer';

describe('ImageOptimizer', () => {
  let optimizer: ImageOptimizer;

  // Mock Canvas API
  beforeEach(() => {
    // Mock HTMLCanvasElement
    global.HTMLCanvasElement = class MockHTMLCanvasElement {
      width = 0;
      height = 0;

      getContext() {
        return {
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          drawImage: vi.fn(),
        };
      }

      toBlob(callback: BlobCallback, mimeType?: string, quality?: number) {
        // Create a mock blob
        const mockBlob = new Blob([new Uint8Array(100)], { type: mimeType || 'image/png' });
        setTimeout(() => callback(mockBlob), 0);
      }

      toDataURL(type?: string) {
        if (type === 'image/webp') {
          return 'data:image/webp;base64,mock';
        }
        return 'data:image/png;base64,mock';
      }
    } as any;

    // Mock Image
    global.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      width = 1024;
      height = 768;

      set src(value: string) {
        this._src = value;
        // Simulate async image loading
        setTimeout(() => {
          if (this.onload) {
            this.onload();
          }
        }, 0);
      }

      get src() {
        return this._src || '';
      }

      private _src = '';
    } as any;

    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // Mock FileReader
    global.FileReader = class MockFileReader {
      onload: ((event: ProgressEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      result: ArrayBuffer | null = null;

      readAsArrayBuffer(_blob: Blob) {
        this.result = new ArrayBuffer(100);
        setTimeout(() => {
          if (this.onload) {
            this.onload({ target: this } as any);
          }
        }, 0);
      }
    } as any;

    optimizer = new ImageOptimizer();
  });

  afterEach(() => {
    optimizer.dispose();
  });

  describe('Constructor', () => {
    it('should create an instance', () => {
      expect(optimizer).toBeInstanceOf(ImageOptimizer);
    });

    it('should throw error if canvas context unavailable', () => {
      // Mock canvas without 2D context
      global.HTMLCanvasElement = class MockHTMLCanvasElement {
        getContext() {
          return null;
        }
      } as any;

      expect(() => new ImageOptimizer()).toThrow(ImageOptimizationError);
      expect(() => new ImageOptimizer()).toThrow('Failed to get 2D context from canvas');
    });
  });

  describe('WebP Support Detection', () => {
    it('should detect WebP support', () => {
      const supported = ImageOptimizer.supportsWebP();
      expect(typeof supported).toBe('boolean');
    });
  });

  describe('Image Optimization', () => {
    it('should optimize a valid image', async () => {
      // Create mock JPEG data (JPEG magic numbers)
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);
      const arrayBuffer = mockImageData.buffer;

      const result = await optimizer.optimize(arrayBuffer);

      expect(result).toBeDefined();
      expect(result.format).toBe('webp');
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.originalSize).toBe(arrayBuffer.byteLength);
      expect(result.optimizedSize).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeGreaterThan(0);
    });

    it('should maintain aspect ratio when resizing', async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer, {
        maxWidth: 512,
        maxHeight: 512,
        maintainAspectRatio: true,
      });

      // Original is 1024x768, aspect ratio 4:3
      // Resized to fit 512x512, should be 512x384 (4:3 ratio preserved)
      expect(result.width).toBeLessThanOrEqual(512);
      expect(result.height).toBeLessThanOrEqual(512);
    });

    it('should respect max dimensions', async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer, {
        maxWidth: 256,
        maxHeight: 256,
      });

      expect(result.width).toBeLessThanOrEqual(256);
      expect(result.height).toBeLessThanOrEqual(256);
    });

    it('should accept custom quality setting', async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer, {
        quality: 0.5,
      });

      expect(result).toBeDefined();
    });

    it('should convert to WebP by default', async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer);

      expect(result.format).toBe('webp');
    });

    it('should support JPEG output format', async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer, {
        format: 'jpeg',
      });

      expect(result.format).toBe('jpeg');
    });

    it('should support PNG output format', async () => {
      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer, {
        format: 'png',
      });

      expect(result.format).toBe('png');
    });

    it('should detect original format when format is "original"', async () => {
      // PNG magic numbers
      const mockImageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer, {
        format: 'original',
      });

      expect(result.format).toBe('png');
    });

    it('should reject images exceeding max file size', async () => {
      // Create a mock image larger than 10MB
      const largeData = new ArrayBuffer(11 * 1024 * 1024);

      await expect(optimizer.optimize(largeData)).rejects.toThrow(ImageOptimizationError);
      await expect(optimizer.optimize(largeData)).rejects.toThrow('exceeds maximum allowed size');
    });

    it('should handle corrupt images gracefully', async () => {
      // Mock Image to simulate load error
      global.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';

        set src(value: string) {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror();
            }
          }, 0);
        }
      } as any;

      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      await expect(optimizer.optimize(mockImageData.buffer)).rejects.toThrow(ImageOptimizationError);
      await expect(optimizer.optimize(mockImageData.buffer)).rejects.toThrow('corrupt or invalid format');
    });

    it('should not resize if image is already smaller than max dimensions', async () => {
      // Mock smaller image
      global.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';
        width = 512;
        height = 384;

        set src(value: string) {
          setTimeout(() => {
            if (this.onload) {
              this.onload();
            }
          }, 0);
        }
      } as any;

      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(mockImageData.buffer, {
        maxWidth: 2048,
        maxHeight: 2048,
      });

      // Should keep original dimensions
      expect(result.width).toBe(512);
      expect(result.height).toBe(384);
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple images', async () => {
      const images = [
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer, name: 'image1.jpg' },
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer, name: 'image2.jpg' },
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer, name: 'image3.jpg' },
      ];

      const results = await optimizer.optimizeBatch(images);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(result.optimizedSize).toBeGreaterThan(0);
      });
    });

    it('should track progress during batch processing', async () => {
      const images = [
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer },
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer },
      ];

      const progressUpdates: number[] = [];
      const onProgress = vi.fn((progress) => {
        progressUpdates.push(progress.percentage);
      });

      await optimizer.optimizeBatch(images, {}, onProgress);

      expect(onProgress).toHaveBeenCalled();
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
    });

    it('should continue processing after individual failures', async () => {
      // Mock one failed image
      let callCount = 0;
      global.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';
        width = 1024;
        height = 768;

        set src(value: string) {
          callCount++;
          setTimeout(() => {
            if (callCount === 2 && this.onerror) {
              // Fail second image
              this.onerror();
            } else if (this.onload) {
              this.onload();
            }
          }, 0);
        }
      } as any;

      const images = [
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer },
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer },
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer },
      ];

      const results = await optimizer.optimizeBatch(images);

      // Should have 2 successful results (1st and 3rd images)
      expect(results).toHaveLength(2);
    });

    it('should report failed count in progress', async () => {
      // Mock all images to fail
      global.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';

        set src(value: string) {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror();
            }
          }, 0);
        }
      } as any;

      const images = [
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer },
        { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]).buffer },
      ];

      let failedCount = 0;
      const onProgress = vi.fn((progress) => {
        failedCount = progress.failed;
      });

      await optimizer.optimizeBatch(images, {}, onProgress);

      expect(failedCount).toBe(2);
    });
  });

  describe('Format Detection', () => {
    it('should detect JPEG format', async () => {
      const jpegData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(jpegData.buffer, { format: 'original' });

      expect(result.format).toBe('jpeg');
    });

    it('should detect PNG format', async () => {
      const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(pngData.buffer, { format: 'original' });

      expect(result.format).toBe('png');
    });

    it('should detect WebP format', async () => {
      const webpData = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // file size
        0x57, 0x45, 0x42, 0x50, // WEBP
        ...new Array(100).fill(0)
      ]);

      const result = await optimizer.optimize(webpData.buffer, { format: 'original' });

      expect(result.format).toBe('webp');
    });

    it('should default to JPEG for unknown formats', async () => {
      const unknownData = new Uint8Array([0x00, 0x00, 0x00, 0x00, ...new Array(100).fill(0)]);

      const result = await optimizer.optimize(unknownData.buffer, { format: 'original' });

      expect(result.format).toBe('jpeg');
    });
  });

  describe('Resource Cleanup', () => {
    it('should dispose resources', () => {
      expect(() => optimizer.dispose()).not.toThrow();
    });

    it('should reset canvas dimensions on dispose', () => {
      const canvas = (optimizer as any).canvas;
      canvas.width = 1024;
      canvas.height = 768;

      optimizer.dispose();

      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw ImageOptimizationError with cause', async () => {
      global.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';

        set src(value: string) {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror();
            }
          }, 0);
        }
      } as any;

      const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);

      try {
        await optimizer.optimize(mockImageData.buffer);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ImageOptimizationError);
        expect((error as ImageOptimizationError).name).toBe('ImageOptimizationError');
      }
    });
  });
});
