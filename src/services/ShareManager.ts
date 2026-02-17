import { nanoid } from 'nanoid';
import type { TFile } from 'obsidian';
import type { IService } from './base/IService';

/**
 * Share tier type
 */
export type ShareTier = 'free' | 'pro';

/**
 * Share options for creating a new share
 */
export interface ShareOptions {
  password?: string;
  customExpiry?: Date;
  tier?: ShareTier;
}

/**
 * Share information structure
 */
export interface ShareInfo {
  id: string;
  noteId: string;
  notePath: string;
  content: string;
  metadata: {
    title: string;
    author?: string;
    tags?: string[];
    created: number;
    modified: number;
  };
  password?: string;
  expiresAt?: Date;
  viewCount: number;
  tier: ShareTier;
  createdAt: Date;
  lastAccessed?: Date;
}

/**
 * Share validation result
 */
export interface ShareValidationResult {
  valid: boolean;
  shareInfo?: ShareInfo;
  error?: string;
}

/**
 * Custom error for share operations
 */
export class ShareError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

/**
 * ShareManager Service
 *
 * Handles share link creation, validation, and management
 * following Single Responsibility Principle
 */
export class ShareManager implements IService {
  private readonly baseUrl: string;

  constructor(baseUrl: string = 'https://social-archive.org') {
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize the service
   */
  initialize(): void {
    // No initialization needed for client-side service
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Generate a unique share ID
   */
  generateShareId(): string {
    return nanoid(12); // 12 characters = ~90 bits of entropy
  }

  /**
   * Create share information from a note
   */
  async createShareInfo(
    note: TFile,
    vault: { read(file: TFile): Promise<string> }, // Obsidian Vault
    metadataCache: { getFileCache(file: TFile): { tags?: Array<{ tag: string }> } | null }, // Obsidian MetadataCache
    options: ShareOptions = {}
  ): Promise<ShareInfo> {
    try {
      // Read note content
      const content = await vault.read(note);

      // Get note metadata
      const metadata = metadataCache.getFileCache(note);

      // Calculate expiration based on tier
      const tier = options.tier || 'free';
      const expiresAt = options.customExpiry || this.calculateExpiration(tier);

      // Create share info
      const shareInfo: ShareInfo = {
        id: this.generateShareId(),
        noteId: note.path,
        notePath: note.path,
        content,
        metadata: {
          title: note.basename,
          tags: metadata?.tags?.map((t: { tag: string }) => t.tag) || [],
          created: note.stat.ctime,
          modified: note.stat.mtime
        },
        password: options.password,
        expiresAt,
        viewCount: 0,
        tier,
        createdAt: new Date()
      };

      return shareInfo;
    } catch (error) {
      throw new ShareError(
        `Failed to create share info: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SHARE_CREATION_FAILED',
        500
      );
    }
  }

  /**
   * Calculate expiration date based on tier
   */
  private calculateExpiration(tier: ShareTier): Date {
    const now = new Date();

    if (tier === 'free') {
      // Free tier: 30 days
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    } else {
      // Pro tier: 1 year (effectively permanent)
      return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Generate share URL
   */
  generateShareUrl(shareId: string): string {
    return `${this.baseUrl}/${shareId}`;
  }

  /**
   * Validate share access
   *
   * This is a client-side validation. Server-side validation
   * happens in the Workers endpoint
   */
  validateShareAccess(
    shareInfo: ShareInfo,
    password?: string
  ): ShareValidationResult {
    // Check if expired
    if (shareInfo.expiresAt && new Date() > shareInfo.expiresAt) {
      return {
        valid: false,
        error: 'Share link has expired'
      };
    }

    // Check password if protected
    if (shareInfo.password) {
      if (!password) {
        return {
          valid: false,
          error: 'Password required'
        };
      }

      if (password !== shareInfo.password) {
        return {
          valid: false,
          error: 'Invalid password'
        };
      }
    }

    return {
      valid: true,
      shareInfo
    };
  }

  /**
   * Create API request payload for sharing
   */
  createShareRequest(shareInfo: ShareInfo): Record<string, unknown> {
    return {
      content: shareInfo.content,
      metadata: shareInfo.metadata,
      options: {
        password: shareInfo.password,
        expiry: shareInfo.expiresAt?.getTime(),
        tier: shareInfo.tier
      }
    };
  }

  /**
   * Parse share response from API
   */
  parseShareResponse(response: Record<string, unknown>): {
    shareId: string;
    shareUrl: string;
    expiresAt?: number;
    passwordProtected: boolean;
  } {
    if (!response.success || !response.data) {
      const err = response.error as Record<string, unknown> | undefined;
      throw new ShareError(
        typeof err?.message === 'string' ? err.message : 'Share creation failed',
        typeof err?.code === 'string' ? err.code : 'SHARE_FAILED',
        400
      );
    }

    return response.data as { shareId: string; shareUrl: string; expiresAt?: number; passwordProtected: boolean };
  }

  /**
   * Check if a note is currently shared
   */
  isNoteShared(notePath: string, shares: ShareInfo[]): boolean {
    return shares.some(share =>
      share.notePath === notePath &&
      (!share.expiresAt || new Date() < share.expiresAt)
    );
  }

  /**
   * Get share info for a note
   */
  getShareForNote(notePath: string, shares: ShareInfo[]): ShareInfo | null {
    return shares.find(share =>
      share.notePath === notePath &&
      (!share.expiresAt || new Date() < share.expiresAt)
    ) || null;
  }

  /**
   * Filter expired shares
   */
  filterExpiredShares(shares: ShareInfo[]): ShareInfo[] {
    const now = new Date();
    return shares.filter(share =>
      !share.expiresAt || share.expiresAt > now
    );
  }

  /**
   * Sort shares by creation date (newest first)
   */
  sortSharesByDate(shares: ShareInfo[]): ShareInfo[] {
    return [...shares].sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Calculate remaining days until expiration
   */
  getRemainingDays(shareInfo: ShareInfo): number | null {
    if (!shareInfo.expiresAt) return null;

    const now = new Date();
    const diff = shareInfo.expiresAt.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    return Math.max(0, days);
  }

  /**
   * Check if share is expiring soon (within 7 days)
   */
  isExpiringSoon(shareInfo: ShareInfo): boolean {
    const remainingDays = this.getRemainingDays(shareInfo);
    return remainingDays !== null && remainingDays <= 7;
  }
}
