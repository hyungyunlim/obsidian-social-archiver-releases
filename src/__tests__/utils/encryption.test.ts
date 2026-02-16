/**
 * Tests for encryption utilities
 */

import { describe, it, expect } from 'vitest';
import {
  deriveEncryptionKey,
  encrypt,
  decrypt,
  generateDeviceId,
  sha256Hash,
  verifyHmacSignature,
} from '../../utils/encryption';

describe('Encryption Utilities', () => {
  describe('deriveEncryptionKey', () => {
    it('should derive encryption key from device ID', async () => {
      const deviceId = 'test-device-123';
      const key = await deriveEncryptionKey(deviceId);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('should derive same key for same device ID', async () => {
      const deviceId = 'test-device-123';
      const key1 = await deriveEncryptionKey(deviceId);
      const key2 = await deriveEncryptionKey(deviceId);

      // Export keys to compare
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);

      expect(new Uint8Array(exported1)).toEqual(new Uint8Array(exported2));
    });

    it('should derive different keys for different device IDs', async () => {
      const key1 = await deriveEncryptionKey('device-1');
      const key2 = await deriveEncryptionKey('device-2');

      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);

      expect(new Uint8Array(exported1)).not.toEqual(new Uint8Array(exported2));
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const deviceId = 'test-device';
      const key = await deriveEncryptionKey(deviceId);
      const plaintext = 'sensitive-license-key-12345';

      const { encrypted, iv } = await encrypt(plaintext, key);

      expect(encrypted).toBeDefined();
      expect(iv).toBeDefined();
      expect(encrypted).not.toBe(plaintext);

      const decrypted = await decrypt(encrypted, iv, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different encrypted output for same input', async () => {
      const deviceId = 'test-device';
      const key = await deriveEncryptionKey(deviceId);
      const plaintext = 'license-key';

      const result1 = await encrypt(plaintext, key);
      const result2 = await encrypt(plaintext, key);

      // IVs should be different
      expect(result1.iv).not.toBe(result2.iv);
      // Encrypted data should be different
      expect(result1.encrypted).not.toBe(result2.encrypted);

      // But both should decrypt to same plaintext
      const decrypted1 = await decrypt(result1.encrypted, result1.iv, key);
      const decrypted2 = await decrypt(result2.encrypted, result2.iv, key);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });

    it('should fail to decrypt with wrong key', async () => {
      const key1 = await deriveEncryptionKey('device-1');
      const key2 = await deriveEncryptionKey('device-2');
      const plaintext = 'secret-data';

      const { encrypted, iv } = await encrypt(plaintext, key1);

      await expect(decrypt(encrypted, iv, key2)).rejects.toThrow('Decryption failed');
    });

    it('should fail to decrypt with wrong IV', async () => {
      const key = await deriveEncryptionKey('device');
      const plaintext = 'secret-data';

      const { encrypted } = await encrypt(plaintext, key);
      const { iv: wrongIv } = await encrypt('other', key);

      await expect(decrypt(encrypted, wrongIv, key)).rejects.toThrow('Decryption failed');
    });

    it('should fail to decrypt tampered data', async () => {
      const key = await deriveEncryptionKey('device');
      const plaintext = 'secret-data';

      const { encrypted, iv } = await encrypt(plaintext, key);

      // Tamper with encrypted data
      const tamperedEncrypted = encrypted.substring(0, encrypted.length - 10) + 'TAMPERED==';

      await expect(decrypt(tamperedEncrypted, iv, key)).rejects.toThrow();
    });
  });

  describe('generateDeviceId', () => {
    it('should generate valid UUID v4', () => {
      const deviceId = generateDeviceId();

      expect(deviceId).toBeDefined();
      expect(typeof deviceId).toBe('string');

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(deviceId).toMatch(uuidV4Regex);
    });

    it('should generate unique device IDs', () => {
      const ids = new Set<string>();
      const count = 100;

      for (let i = 0; i < count; i++) {
        ids.add(generateDeviceId());
      }

      expect(ids.size).toBe(count);
    });
  });

  describe('sha256Hash', () => {
    it('should generate SHA-256 hash', async () => {
      const data = 'test-data';
      const hash = await sha256Hash(data);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should generate same hash for same input', async () => {
      const data = 'consistent-data';
      const hash1 = await sha256Hash(data);
      const hash2 = await sha256Hash(data);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', async () => {
      const hash1 = await sha256Hash('data-1');
      const hash2 = await sha256Hash('data-2');

      expect(hash1).not.toBe(hash2);
    });

    it('should be deterministic', async () => {
      const data = 'deterministic-test';
      const hashes = await Promise.all(
        Array(10).fill(null).map(() => sha256Hash(data))
      );

      const firstHash = hashes[0];
      hashes.forEach((hash) => {
        expect(hash).toBe(firstHash);
      });
    });
  });

  describe('verifyHmacSignature', () => {
    it('should verify valid HMAC signature', async () => {
      const secret = 'webhook-secret';
      const payload = '{"event":"sale","license_key":"ABC123"}';

      // Create signature
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const payloadData = encoder.encode(payload);
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadData);

      // Convert to base64
      const bytes = new Uint8Array(signatureBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const signature = btoa(binary);

      // Verify
      const isValid = await verifyHmacSignature(payload, signature, secret);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const secret = 'webhook-secret';
      const payload = '{"event":"sale"}';
      const invalidSignature = 'invalid-signature';

      const isValid = await verifyHmacSignature(payload, invalidSignature, secret);
      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong secret', async () => {
      const correctSecret = 'correct-secret';
      const wrongSecret = 'wrong-secret';
      const payload = '{"event":"sale"}';

      // Create signature with correct secret
      const encoder = new TextEncoder();
      const keyData = encoder.encode(correctSecret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const payloadData = encoder.encode(payload);
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadData);

      const bytes = new Uint8Array(signatureBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const signature = btoa(binary);

      // Verify with wrong secret
      const isValid = await verifyHmacSignature(payload, signature, wrongSecret);
      expect(isValid).toBe(false);
    });

    it('should reject signature for tampered payload', async () => {
      const secret = 'webhook-secret';
      const originalPayload = '{"event":"sale","amount":100}';
      const tamperedPayload = '{"event":"sale","amount":999}';

      // Create signature for original payload
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const payloadData = encoder.encode(originalPayload);
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadData);

      const bytes = new Uint8Array(signatureBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const signature = btoa(binary);

      // Verify with tampered payload
      const isValid = await verifyHmacSignature(tamperedPayload, signature, secret);
      expect(isValid).toBe(false);
    });
  });
});
