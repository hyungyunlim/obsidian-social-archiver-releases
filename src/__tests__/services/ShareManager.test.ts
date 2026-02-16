import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShareManager, ShareError, type ShareInfo, type ShareOptions } from '@/services/ShareManager';
import type { TFile } from 'obsidian';

describe('ShareManager', () => {
  let shareManager: ShareManager;
  const baseUrl = 'https://social-archive.org';

  beforeEach(() => {
    shareManager = new ShareManager(baseUrl);
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      await expect(shareManager.initialize()).resolves.toBeUndefined();
    });

    it('should destroy without errors', async () => {
      await expect(shareManager.destroy()).resolves.toBeUndefined();
    });

    it('should use default base URL if not provided', () => {
      const defaultManager = new ShareManager();
      const shareId = 'test123';
      expect(defaultManager.generateShareUrl(shareId)).toBe(`https://social-archive.org/${shareId}`);
    });
  });

  describe('generateShareId', () => {
    it('should generate a unique 12-character ID', () => {
      const id = shareManager.generateShareId();
      expect(id).toHaveLength(12);
      expect(typeof id).toBe('string');
    });

    it('should generate different IDs on multiple calls', () => {
      const id1 = shareManager.generateShareId();
      const id2 = shareManager.generateShareId();
      expect(id1).not.toBe(id2);
    });

    it('should generate URL-safe IDs', () => {
      const id = shareManager.generateShareId();
      // nanoid uses URL-safe alphabet: A-Za-z0-9_-
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('generateShareUrl', () => {
    it('should generate correct share URL', () => {
      const shareId = 'abc123def456';
      const url = shareManager.generateShareUrl(shareId);
      expect(url).toBe(`${baseUrl}/${shareId}`);
    });

    it('should handle different share IDs', () => {
      const ids = ['test1', 'test2', 'abc-def_123'];
      ids.forEach(id => {
        expect(shareManager.generateShareUrl(id)).toBe(`${baseUrl}/${id}`);
      });
    });
  });

  describe('createShareInfo', () => {
    const mockNote: TFile = {
      path: 'test/note.md',
      basename: 'note',
      stat: {
        ctime: 1609459200000, // 2021-01-01
        mtime: 1609545600000  // 2021-01-02
      }
    } as TFile;

    const mockVault = {
      read: vi.fn().mockResolvedValue('# Test Note\n\nContent here')
    };

    const mockMetadataCache = {
      getFileCache: vi.fn().mockReturnValue({
        tags: [{ tag: '#test' }, { tag: '#example' }]
      })
    };

    it('should create share info with default options', async () => {
      const shareInfo = await shareManager.createShareInfo(mockNote, mockVault, mockMetadataCache);

      expect(shareInfo.id).toHaveLength(12);
      expect(shareInfo.noteId).toBe('test/note.md');
      expect(shareInfo.notePath).toBe('test/note.md');
      expect(shareInfo.content).toBe('# Test Note\n\nContent here');
      expect(shareInfo.metadata.title).toBe('note');
      expect(shareInfo.metadata.tags).toEqual(['#test', '#example']);
      expect(shareInfo.metadata.created).toBe(1609459200000);
      expect(shareInfo.metadata.modified).toBe(1609545600000);
      expect(shareInfo.viewCount).toBe(0);
      expect(shareInfo.tier).toBe('free');
      expect(shareInfo.createdAt).toBeInstanceOf(Date);
      expect(shareInfo.expiresAt).toBeInstanceOf(Date);
    });

    it('should create share info with free tier (30 days expiry)', async () => {
      const options: ShareOptions = { tier: 'free' };
      const shareInfo = await shareManager.createShareInfo(mockNote, mockVault, mockMetadataCache, options);

      expect(shareInfo.tier).toBe('free');
      expect(shareInfo.expiresAt).toBeInstanceOf(Date);

      const now = new Date();
      const expiresAt = shareInfo.expiresAt!;
      const diffDays = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(29); // Allow for some timing variance
      expect(diffDays).toBeLessThanOrEqual(30);
    });

    it('should create share info with pro tier (365 days expiry)', async () => {
      const options: ShareOptions = { tier: 'pro' };
      const shareInfo = await shareManager.createShareInfo(mockNote, mockVault, mockMetadataCache, options);

      expect(shareInfo.tier).toBe('pro');
      expect(shareInfo.expiresAt).toBeInstanceOf(Date);

      const now = new Date();
      const expiresAt = shareInfo.expiresAt!;
      const diffDays = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(364);
      expect(diffDays).toBeLessThanOrEqual(365);
    });

    it('should create share info with password', async () => {
      const options: ShareOptions = { password: 'secret123' };
      const shareInfo = await shareManager.createShareInfo(mockNote, mockVault, mockMetadataCache, options);

      expect(shareInfo.password).toBe('secret123');
    });

    it('should create share info with custom expiry', async () => {
      const customExpiry = new Date('2025-12-31');
      const options: ShareOptions = { customExpiry };
      const shareInfo = await shareManager.createShareInfo(mockNote, mockVault, mockMetadataCache, options);

      expect(shareInfo.expiresAt).toEqual(customExpiry);
    });

    it('should handle note without tags', async () => {
      const metadataCacheWithoutTags = {
        getFileCache: vi.fn().mockReturnValue(null)
      };

      const shareInfo = await shareManager.createShareInfo(mockNote, mockVault, metadataCacheWithoutTags);
      expect(shareInfo.metadata.tags).toEqual([]);
    });

    it('should throw ShareError when vault read fails', async () => {
      const failingVault = {
        read: vi.fn().mockRejectedValue(new Error('Read failed'))
      };

      await expect(
        shareManager.createShareInfo(mockNote, failingVault, mockMetadataCache)
      ).rejects.toThrow(ShareError);

      await expect(
        shareManager.createShareInfo(mockNote, failingVault, mockMetadataCache)
      ).rejects.toThrow('Failed to create share info');
    });
  });

  describe('validateShareAccess', () => {
    const baseShareInfo: ShareInfo = {
      id: 'test123',
      noteId: 'note.md',
      notePath: 'note.md',
      content: 'test',
      metadata: { title: 'Test', created: Date.now(), modified: Date.now() },
      viewCount: 0,
      tier: 'free',
      createdAt: new Date()
    };

    it('should validate access for non-protected, non-expired share', async () => {
      const result = await shareManager.validateShareAccess(baseShareInfo);
      expect(result.valid).toBe(true);
      expect(result.shareInfo).toEqual(baseShareInfo);
      expect(result.error).toBeUndefined();
    });

    it('should reject expired share', async () => {
      const expiredShare: ShareInfo = {
        ...baseShareInfo,
        expiresAt: new Date('2020-01-01')
      };

      const result = await shareManager.validateShareAccess(expiredShare);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Share link has expired');
    });

    it('should reject password-protected share without password', async () => {
      const protectedShare: ShareInfo = {
        ...baseShareInfo,
        password: 'secret'
      };

      const result = await shareManager.validateShareAccess(protectedShare);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Password required');
    });

    it('should reject password-protected share with wrong password', async () => {
      const protectedShare: ShareInfo = {
        ...baseShareInfo,
        password: 'secret'
      };

      const result = await shareManager.validateShareAccess(protectedShare, 'wrong');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid password');
    });

    it('should validate password-protected share with correct password', async () => {
      const protectedShare: ShareInfo = {
        ...baseShareInfo,
        password: 'secret'
      };

      const result = await shareManager.validateShareAccess(protectedShare, 'secret');
      expect(result.valid).toBe(true);
      expect(result.shareInfo).toEqual(protectedShare);
    });
  });

  describe('share utilities', () => {
    const now = new Date();
    const shares: ShareInfo[] = [
      {
        id: '1',
        noteId: 'note1.md',
        notePath: 'note1.md',
        content: 'test1',
        metadata: { title: 'Note 1', created: now.getTime(), modified: now.getTime() },
        viewCount: 5,
        tier: 'free',
        createdAt: new Date('2024-01-01'),
        expiresAt: new Date('2025-12-31')
      },
      {
        id: '2',
        noteId: 'note2.md',
        notePath: 'note2.md',
        content: 'test2',
        metadata: { title: 'Note 2', created: now.getTime(), modified: now.getTime() },
        viewCount: 10,
        tier: 'pro',
        createdAt: new Date('2024-06-01')
      },
      {
        id: '3',
        noteId: 'note3.md',
        notePath: 'note3.md',
        content: 'test3',
        metadata: { title: 'Note 3', created: now.getTime(), modified: now.getTime() },
        viewCount: 0,
        tier: 'free',
        createdAt: new Date('2024-03-01'),
        expiresAt: new Date('2020-01-01') // Expired
      }
    ];

    describe('isNoteShared', () => {
      it('should return true for shared note', () => {
        expect(shareManager.isNoteShared('note1.md', shares)).toBe(true);
      });

      it('should return false for non-shared note', () => {
        expect(shareManager.isNoteShared('nonexistent.md', shares)).toBe(false);
      });

      it('should return false for expired share', () => {
        expect(shareManager.isNoteShared('note3.md', shares)).toBe(false);
      });
    });

    describe('getShareForNote', () => {
      it('should return share info for note', () => {
        const share = shareManager.getShareForNote('note1.md', shares);
        expect(share).toBeTruthy();
        expect(share?.id).toBe('1');
      });

      it('should return null for non-shared note', () => {
        const share = shareManager.getShareForNote('nonexistent.md', shares);
        expect(share).toBeNull();
      });

      it('should return null for expired share', () => {
        const share = shareManager.getShareForNote('note3.md', shares);
        expect(share).toBeNull();
      });
    });

    describe('filterExpiredShares', () => {
      it('should filter out expired shares', () => {
        const filtered = shareManager.filterExpiredShares(shares);
        expect(filtered).toHaveLength(2);
        expect(filtered.map(s => s.id)).toEqual(['1', '2']);
      });

      it('should handle empty array', () => {
        expect(shareManager.filterExpiredShares([])).toEqual([]);
      });
    });

    describe('sortSharesByDate', () => {
      it('should sort shares by creation date (newest first)', () => {
        const sorted = shareManager.sortSharesByDate(shares);
        expect(sorted.map(s => s.id)).toEqual(['2', '3', '1']);
      });

      it('should not mutate original array', () => {
        const original = [...shares];
        shareManager.sortSharesByDate(shares);
        expect(shares).toEqual(original);
      });
    });

    describe('getRemainingDays', () => {
      it('should return null for share without expiry', () => {
        expect(shareManager.getRemainingDays(shares[1])).toBeNull();
      });

      it('should return 0 for expired share', () => {
        expect(shareManager.getRemainingDays(shares[2])).toBe(0);
      });

      it('should calculate remaining days correctly', () => {
        const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days
        const share: ShareInfo = {
          ...shares[0],
          expiresAt: futureDate
        };

        const remaining = shareManager.getRemainingDays(share);
        expect(remaining).toBeGreaterThanOrEqual(9);
        expect(remaining).toBeLessThanOrEqual(10);
      });
    });

    describe('isExpiringSoon', () => {
      it('should return true for share expiring within 7 days', () => {
        const soonDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
        const share: ShareInfo = {
          ...shares[0],
          expiresAt: soonDate
        };

        expect(shareManager.isExpiringSoon(share)).toBe(true);
      });

      it('should return false for share expiring after 7 days', () => {
        const laterDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        const share: ShareInfo = {
          ...shares[0],
          expiresAt: laterDate
        };

        expect(shareManager.isExpiringSoon(share)).toBe(false);
      });

      it('should return false for share without expiry', () => {
        expect(shareManager.isExpiringSoon(shares[1])).toBe(false);
      });
    });
  });

  describe('API utilities', () => {
    describe('createShareRequest', () => {
      it('should create valid API request payload', () => {
        const shareInfo: ShareInfo = {
          id: 'test123',
          noteId: 'note.md',
          notePath: 'note.md',
          content: '# Test',
          metadata: {
            title: 'Test',
            author: 'User',
            tags: ['#test'],
            created: 1609459200000,
            modified: 1609545600000
          },
          password: 'secret',
          expiresAt: new Date('2025-12-31'),
          viewCount: 0,
          tier: 'pro',
          createdAt: new Date()
        };

        const payload = shareManager.createShareRequest(shareInfo);

        expect(payload.content).toBe('# Test');
        expect(payload.metadata).toEqual(shareInfo.metadata);
        expect(payload.options.password).toBe('secret');
        expect(payload.options.tier).toBe('pro');
        expect(payload.options.expiry).toBe(new Date('2025-12-31').getTime());
      });
    });

    describe('parseShareResponse', () => {
      it('should parse successful response', () => {
        const response = {
          success: true,
          data: {
            shareId: 'abc123',
            shareUrl: 'https://social-archive.org/abc123',
            expiresAt: 1735689600000,
            passwordProtected: true
          }
        };

        const result = shareManager.parseShareResponse(response);
        expect(result.shareId).toBe('abc123');
        expect(result.shareUrl).toBe('https://social-archive.org/abc123');
        expect(result.passwordProtected).toBe(true);
      });

      it('should throw ShareError for failed response', () => {
        const response = {
          success: false,
          error: {
            code: 'SHARE_FAILED',
            message: 'Failed to create share'
          }
        };

        expect(() => shareManager.parseShareResponse(response)).toThrow(ShareError);
        expect(() => shareManager.parseShareResponse(response)).toThrow('Failed to create share');
      });

      it('should throw ShareError for response without data', () => {
        const response = {
          success: true
        };

        expect(() => shareManager.parseShareResponse(response)).toThrow(ShareError);
      });
    });
  });
});
