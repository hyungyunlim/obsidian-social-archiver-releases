/**
 * Encryption utilities for secure license storage
 * Uses Web Crypto API (AES-256-GCM)
 */

/**
 * Encryption result
 */
export interface EncryptionResult {
  /** Encrypted data (base64) */
  encrypted: string;
  /** Initialization vector (base64) */
  iv: string;
}

/**
 * Generate encryption key from device-specific identifier
 */
export async function deriveEncryptionKey(deviceId: string, salt: string = 'social-archiver'): Promise<CryptoKey> {
  // Combine device ID with salt
  const keyMaterial = `${deviceId}-${salt}`;

  // Convert to buffer
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyMaterial);

  // Import as raw key material
  const importedKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES-GCM key
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    importedKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return key;
}

/**
 * Encrypt data using AES-256-GCM
 */
export async function encrypt(data: string, key: CryptoKey): Promise<EncryptionResult> {
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encode data
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data);

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encodedData
  );

  // Convert to base64
  return {
    encrypted: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
export async function decrypt(encryptedData: string, iv: string, key: CryptoKey): Promise<string> {
  try {
    // Convert from base64
    const encryptedBuffer = base64ToArrayBuffer(encryptedData);
    const ivBuffer = base64ToArrayBuffer(iv);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBuffer,
      },
      key,
      encryptedBuffer
    );

    // Decode
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    throw new Error('Decryption failed: data may be corrupted or tampered with');
  }
}

/**
 * Generate device-specific UUID v4
 */
export function generateDeviceId(): string {
  // Use crypto.randomUUID if available (modern browsers/Node 16+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback to manual UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Convert base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Hash data using SHA-256
 */
export async function sha256Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  return arrayBufferToBase64(hashBuffer);
}

/**
 * Verify HMAC signature (for webhook verification)
 */
export async function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Import secret as key
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    // Compute expected signature
    const payloadData = encoder.encode(payload);
    const expectedSignatureBuffer = await crypto.subtle.sign('HMAC', key, payloadData);
    const expectedSignature = arrayBufferToBase64(expectedSignatureBuffer);

    // Compare signatures (constant-time comparison)
    return timingSafeEqual(expectedSignature, signature);
  } catch (error) {
    return false;
  }
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
