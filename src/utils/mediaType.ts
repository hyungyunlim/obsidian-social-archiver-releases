/**
 * Media Type Detection Utilities
 * Single source of truth for detecting media types from URLs/paths
 */

export type MediaType = 'image' | 'video' | 'audio' | 'document';

// File extension patterns
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|ogg|flac|aac)$/i;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i;

/**
 * Detect media type from URL or file path
 * @param url - URL or file path to check
 * @returns MediaType - 'video', 'audio', 'image', or 'document'
 */
export function detectMediaType(url: string): MediaType {
  if (VIDEO_EXTENSIONS.test(url)) {
    return 'video';
  }
  if (AUDIO_EXTENSIONS.test(url)) {
    return 'audio';
  }
  if (IMAGE_EXTENSIONS.test(url)) {
    return 'image';
  }
  return 'document';
}

/**
 * Check if URL/path is a video file
 */
export function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url);
}

/**
 * Check if URL/path is an audio file
 */
export function isAudioUrl(url: string): boolean {
  return AUDIO_EXTENSIONS.test(url);
}

/**
 * Check if URL/path is an image file
 */
export function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.test(url);
}

/**
 * Get video extension regex for embed pattern matching
 * Used for ![[file.mp4]] pattern detection
 */
export function getVideoExtensionPattern(): string {
  return 'mp4|webm|mov|avi|mkv|m4v';
}

/**
 * Get audio extension regex for embed pattern matching
 */
export function getAudioExtensionPattern(): string {
  return 'mp3|m4a|wav|ogg|flac|aac';
}
