/**
 * HEIC Image Conversion Utilities
 *
 * Provides utilities for detecting and converting HEIC/HEIF images to JPEG.
 * Used across multiple services to avoid code duplication.
 */

/**
 * Check if image data is HEIC/HEIF format by checking magic numbers
 */
export function isHEIC(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  if (bytes.length < 12) return false;

  // HEIC/HEIF files start with ftyp box
  // Check for 'ftyp' signature at bytes 4-7
  const brand = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  if (brand !== 'ftyp') return false;

  // Check brand name at bytes 8-11 (heic, heix, hevc, heim, heis, heif, mif1, msf1, etc)
  const brandName = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!).toLowerCase();
  return brandName.startsWith('heic') || brandName.startsWith('heif') ||
         brandName.startsWith('heix') || brandName.startsWith('heim') ||
         brandName.startsWith('heis') || brandName.startsWith('hevx') ||
         brandName.startsWith('mif1') || brandName.startsWith('msf1') ||
         brandName.startsWith('avif');
}

/**
 * Get HEIC brand info for debugging
 */
export function getHEICBrandInfo(data: ArrayBuffer): {
  brand: string;
  brandName: string;
  size: number;
  compatibleBrands: string[];
  isHDR: boolean;
} | null {
  const bytes = new Uint8Array(data);
  if (bytes.length < 12) return null;

  // Read ftyp box size (first 4 bytes, big-endian)
  const ftypSize = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;

  const brand = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  const brandName = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);

  // Extract compatible brands (after minor_version at bytes 12-15)
  const compatibleBrands: string[] = [];
  for (let i = 16; i < Math.min(ftypSize, bytes.length); i += 4) {
    if (i + 4 <= bytes.length) {
      const cb = String.fromCharCode(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!);
      if (cb.trim()) compatibleBrands.push(cb);
    }
  }

  // Check for HDR markers
  const isHDR = compatibleBrands.some(b =>
    b === 'MiHB' || // Multi-Image HDR Base
    b === 'MiHE' || // Multi-Image HDR Extension (sometimes indicates HDR capability)
    b.includes('hdr')
  ) && compatibleBrands.includes('MiHB'); // MiHB specifically indicates HDR content

  return { brand, brandName, size: bytes.length, compatibleBrands, isHDR };
}

/**
 * Check if image data is actually JPEG format by checking magic numbers
 */
export function isJPEG(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  if (bytes.length < 3) return false;

  // JPEG: FF D8 FF
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Try to convert HEIC using libheif-js directly (latest version with better codec support)
 */
async function tryLibheifJsConversion(
  data: ArrayBuffer,
  quality: number
): Promise<ArrayBuffer | null> {
  try {
    // Use the pre-bundled WASM version for browser compatibility
    const libheif = await import('libheif-js/wasm-bundle');
    const decoder = new libheif.HeifDecoder();

    const heifData = decoder.decode(new Uint8Array(data));
    if (!heifData || heifData.length === 0) {
      return null;
    }

    const image = heifData[0];
    if (!image) {
      return null;
    }

    const width = image.get_width();
    const height = image.get_height();

    // Create canvas and draw the image
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    // Get image data
    const imageData = ctx.createImageData(width, height);
    await new Promise<void>((resolve, reject) => {
      image.display(imageData, (displayData: ImageData | null) => {
        if (!displayData) {
          reject(new Error('Failed to display HEIC image'));
          return;
        }
        ctx.putImageData(displayData, 0, 0);
        resolve();
      });
    });

    // Convert to JPEG
    return new Promise((resolve) => {
      canvas.toBlob(
        async (blob) => {
          if (blob) {
            resolve(await blob.arrayBuffer());
          } else {
            resolve(null);
          }
        },
        'image/jpeg',
        quality
      );
    });
  } catch {
    return null;
  }
}

/**
 * Try to convert HEIC using browser's native decoder (canvas fallback)
 * Works on macOS/iOS where the OS provides native HEIC support
 */
async function tryNativeHEICConversion(
  data: ArrayBuffer,
  quality: number
): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const blob = new Blob([data], { type: 'image/heic' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    const cleanup = () => {
      URL.revokeObjectURL(url);
    };

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          async (jpegBlob) => {
            cleanup();
            if (jpegBlob) {
              resolve(await jpegBlob.arrayBuffer());
            } else {
              resolve(null);
            }
          },
          'image/jpeg',
          quality
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    // Set a timeout in case the image never loads
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10000);

    img.src = url;
  });
}

/**
 * Convert HEIC/HEIF format to JPEG using libheif-js
 * Falls back to native browser decoder if libheif-js fails
 *
 * @param data - HEIC image data as ArrayBuffer
 * @param quality - JPEG quality (0.0 to 1.0, default: 0.95)
 * @returns Converted JPEG data as ArrayBuffer
 * @throws Error if conversion fails
 */
export async function convertHEICtoJPEG(
  data: ArrayBuffer,
  quality: number = 0.95
): Promise<ArrayBuffer> {
  // Try libheif-js (supports HDR HEIC)
  const libheifResult = await tryLibheifJsConversion(data, quality);
  if (libheifResult) {
    return libheifResult;
  }

  // Try native browser decoder as fallback
  const nativeResult = await tryNativeHEICConversion(data, quality);
  if (nativeResult) {
    return nativeResult;
  }

  // All methods failed
  const brandInfo = getHEICBrandInfo(data);
  throw new Error(
    `Failed to convert HEIC image (brand: ${brandInfo?.brandName ?? 'unknown'}, size: ${data.byteLength}). Try converting to JPEG using Preview app.`
  );
}

/**
 * Detect actual image format and convert HEIC to JPEG if needed
 *
 * This function handles the common case where:
 * - URL extension is .heic but Cloudflare already converted it to JPEG
 * - URL extension is .heic and file is actually HEIC (needs conversion)
 *
 * @param data - Image data as ArrayBuffer
 * @param urlExtension - File extension from URL (e.g., 'heic', 'jpg')
 * @param quality - JPEG quality for conversion (0.0 to 1.0, default: 0.95)
 * @returns Object with converted data and actual extension
 */
export async function detectAndConvertHEIC(
  data: ArrayBuffer,
  urlExtension: string,
  quality: number = 0.95
): Promise<{ data: ArrayBuffer; extension: string; wasConverted: boolean }> {
  // Only check if URL extension suggests HEIC
  if (urlExtension !== 'heic' && urlExtension !== 'heif') {
    return { data, extension: urlExtension, wasConverted: false };
  }

  // Check actual format via magic numbers
  if (isJPEG(data)) {
    // Cloudflare already converted it to JPEG, just fix the extension
    return { data, extension: 'jpg', wasConverted: false };
  }

  if (isHEIC(data)) {
    // It's actually HEIC, need to convert
    try {
      const convertedData = await convertHEICtoJPEG(data, quality);
      return { data: convertedData, extension: 'jpg', wasConverted: true };
    } catch {
      // Return original data with original extension if conversion fails
      return { data, extension: urlExtension, wasConverted: false };
    }
  }

  // Unknown format, return as-is
  return { data, extension: urlExtension, wasConverted: false };
}
