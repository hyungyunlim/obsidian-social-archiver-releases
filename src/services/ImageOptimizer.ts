/**
 * ImageOptimizer
 *
 * Client-side image optimization using Canvas API:
 * - Resize images to max 2048x2048 while maintaining aspect ratio
 * - Convert to WebP format for better compression
 * - Batch processing with progress tracking
 * - Memory management and error handling
 *
 * Single Responsibility: Image optimization operations
 */

/**
 * Image optimization options
 */
export interface OptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.0 to 1.0 for WebP
  format?: 'webp' | 'jpeg' | 'png' | 'original';
  maintainAspectRatio?: boolean;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  data: ArrayBuffer;
  format: string;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
  compressionRatio: number;
}

/**
 * Batch processing progress
 */
export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
  currentImage?: string;
}

/**
 * Optimization error types
 */
export class ImageOptimizationError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'ImageOptimizationError';
  }
}

/**
 * ImageOptimizer class
 */
export class ImageOptimizer {
  private static readonly DEFAULT_MAX_DIMENSION = 2048;
  private static readonly DEFAULT_QUALITY = 0.8;
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new ImageOptimizationError('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;
  }

  /**
   * Check if WebP is supported
   */
  static supportsWebP(): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  }

  /**
   * Optimize a single image
   */
  async optimize(
    imageData: ArrayBuffer,
    options: OptimizationOptions = {}
  ): Promise<OptimizationResult> {
    const {
      maxWidth = ImageOptimizer.DEFAULT_MAX_DIMENSION,
      maxHeight = ImageOptimizer.DEFAULT_MAX_DIMENSION,
      quality = ImageOptimizer.DEFAULT_QUALITY,
      format = 'webp',
      maintainAspectRatio = true,
    } = options;

    // Validate input size
    if (imageData.byteLength > ImageOptimizer.MAX_FILE_SIZE) {
      throw new ImageOptimizationError(
        `Image size exceeds maximum allowed size of ${ImageOptimizer.MAX_FILE_SIZE / 1024 / 1024}MB`
      );
    }

    try {
      // Load image
      const img = await this.loadImage(imageData);

      // Calculate target dimensions
      const dimensions = this.calculateDimensions(
        img.width,
        img.height,
        maxWidth,
        maxHeight,
        maintainAspectRatio
      );

      // Resize image
      this.canvas.width = dimensions.width;
      this.canvas.height = dimensions.height;

      // Use high-quality image smoothing
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';

      // Draw resized image
      this.ctx.drawImage(img, 0, 0, dimensions.width, dimensions.height);

      // Convert to target format
      const targetFormat = format === 'original' ? this.detectFormat(imageData) : format;
      const optimizedData = await this.canvasToBuffer(targetFormat, quality);

      // Calculate compression ratio
      const compressionRatio = imageData.byteLength / optimizedData.byteLength;

      return {
        data: optimizedData,
        format: targetFormat,
        width: dimensions.width,
        height: dimensions.height,
        originalSize: imageData.byteLength,
        optimizedSize: optimizedData.byteLength,
        compressionRatio,
      };
    } catch (error) {
      throw new ImageOptimizationError(
        'Failed to optimize image',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Batch optimize multiple images with progress tracking
   */
  async optimizeBatch(
    images: Array<{ data: ArrayBuffer; name?: string }>,
    options: OptimizationOptions = {},
    onProgress?: (progress: BatchProgress) => void
  ): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];
    let completed = 0;
    let failed = 0;

    for (const [index, image] of images.entries()) {
      try {
        const result = await this.optimize(image.data, options);
        results.push(result);
        completed++;

        if (onProgress) {
          onProgress({
            total: images.length,
            completed,
            failed,
            percentage: Math.round((completed / images.length) * 100),
            currentImage: image.name || `Image ${index + 1}`,
          });
        }
      } catch (error) {
        failed++;

        // Continue with other images
        if (onProgress) {
          onProgress({
            total: images.length,
            completed,
            failed,
            percentage: Math.round(((completed + failed) / images.length) * 100),
            currentImage: image.name || `Image ${index + 1}`,
          });
        }
      }
    }

    return results;
  }

  /**
   * Load image from ArrayBuffer
   */
  private async loadImage(data: ArrayBuffer): Promise<HTMLImageElement> {
    // Check if image is HEIC format and convert to JPEG
    const { isHEIC, convertHEICtoJPEG } = await import('../utils/heic');

    if (isHEIC(data)) {
      try {
        data = await convertHEICtoJPEG(data);
      } catch (error) {
        console.error('[ImageOptimizer] HEIC conversion failed:', error);
        throw new ImageOptimizationError(
          'Failed to convert HEIC image. Please use JPEG or PNG format.',
          error instanceof Error ? error : undefined
        );
      }
    }

    return new Promise((resolve, reject) => {
      const blob = new Blob([data]);
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new ImageOptimizationError('Failed to load image - possibly corrupt or invalid format'));
      };

      img.src = url;
    });
  }

  /**
   * Calculate target dimensions while maintaining aspect ratio
   */
  private calculateDimensions(
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number,
    maintainAspectRatio: boolean
  ): { width: number; height: number } {
    // If image is already smaller than max, return original dimensions
    if (width <= maxWidth && height <= maxHeight) {
      return { width, height };
    }

    if (!maintainAspectRatio) {
      return { width: maxWidth, height: maxHeight };
    }

    // Calculate aspect ratio
    const aspectRatio = width / height;

    // Determine which dimension to constrain
    let targetWidth = width;
    let targetHeight = height;

    if (width > maxWidth) {
      targetWidth = maxWidth;
      targetHeight = targetWidth / aspectRatio;
    }

    if (targetHeight > maxHeight) {
      targetHeight = maxHeight;
      targetWidth = targetHeight * aspectRatio;
    }

    return {
      width: Math.round(targetWidth),
      height: Math.round(targetHeight),
    };
  }

  /**
   * Convert canvas to ArrayBuffer
   */
  private async canvasToBuffer(format: string, quality: number): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      // Check WebP support
      if (format === 'webp' && !ImageOptimizer.supportsWebP()) {
        format = 'jpeg';
      }

      const mimeType = `image/${format}`;

      this.canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new ImageOptimizationError('Failed to convert canvas to blob'));
            return;
          }

          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
              resolve(reader.result);
            } else {
              reject(new ImageOptimizationError('Failed to read blob as ArrayBuffer'));
            }
          };
          reader.onerror = () => {
            reject(new ImageOptimizationError('Failed to read blob'));
          };
          reader.readAsArrayBuffer(blob);
        },
        mimeType,
        quality
      );
    });
  }

  /**
   * Detect image format from ArrayBuffer
   */
  private detectFormat(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data);

    // Check magic numbers
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'jpeg';
    }

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'png';
    }

    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'webp';
    }

    // Default to jpeg
    return 'jpeg';
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
