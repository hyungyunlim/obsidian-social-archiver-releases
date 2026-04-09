/**
 * AuthorNoteService
 *
 * Manages vault-native author note files: CRUD, frontmatter upsert,
 * index by authorKey, and bulk loading for the Author Catalog.
 *
 * Single Responsibility: Author note file lifecycle management
 *
 * Key design decisions:
 *   - Identity is `authorKey` in frontmatter, NOT the filename.
 *   - Lookup scans `authorNotesPath` and reads `type: social-archiver-author`.
 *   - Body (markdown below frontmatter) is NEVER auto-modified after creation.
 *   - User-owned fields (`displayNameOverride`, `aliases`, `tags`) are NEVER overwritten.
 *   - Uses `app.fileManager.processFrontMatter` for atomic frontmatter updates.
 */

import { type App, TFile, TFolder, normalizePath } from 'obsidian';
import type { Platform } from '@/types/post';
import type { PostData } from '@/types/post';
import type { AuthorCatalogEntry } from '@/types/author-catalog';
import {
  AUTHOR_NOTE_TYPE,
  AUTHOR_NOTE_VERSION,
  USER_OWNED_FIELDS,
  type AuthorNoteData,
} from '@/types/author-note';
import { normalizeAuthorUrl, normalizeAuthorName } from '@/services/AuthorDeduplicator';

// ============================================================================
// Constants
// ============================================================================

/** Default body scaffold for new author notes */
const DEFAULT_BODY = '\n## Notes\n';

/** Maximum filename slug length */
const MAX_SLUG_LENGTH = 80;

/** Short hash length for collision resolution */
const SHORT_HASH_LENGTH = 6;

// ============================================================================
// AuthorNoteService
// ============================================================================

export class AuthorNoteService {
  private readonly app: App;
  private readonly getAuthorNotesPath: () => string;
  private readonly isEnabled: () => boolean;

  /**
   * In-memory index: authorKey → TFile path.
   * Built on first access, invalidated by vault events.
   */
  private indexCache: Map<string, string> | null = null;

  constructor(config: {
    app: App;
    getAuthorNotesPath: () => string;
    isEnabled: () => boolean;
  }) {
    this.app = config.app;
    this.getAuthorNotesPath = config.getAuthorNotesPath;
    this.isEnabled = config.isEnabled;
  }

  // ============================================================================
  // Identity helpers
  // ============================================================================

  /**
   * Build the canonical authorKey for author notes.
   *
   * Format:
   *   - URL-based: "{platform}:url:{normalizedUrl}"
   *   - Name-based: "{platform}:name:{normalizedName}" (legacy fallback)
   */
  buildAuthorKey(
    authorUrl: string | undefined,
    authorName: string,
    platform: Platform,
  ): string {
    if (authorUrl) {
      const normalized = normalizeAuthorUrl(authorUrl, platform);
      if (normalized.url) {
        return `${platform}:url:${normalized.url}`;
      }
    }

    const normalizedName = normalizeAuthorName(authorName);
    return `${platform}:name:${normalizedName}`;
  }

  /**
   * Generate a human-readable filename for an author note.
   *
   * Format: `{platform}-{slug}.md`
   * Collision: `{platform}-{slug}--{shortHash}.md`
   */
  generateFilename(
    platform: Platform,
    handle?: string,
    name?: string,
  ): string {
    const raw = handle || name || 'unknown';
    const slug = this.slugify(raw);
    return `${platform}-${slug}.md`;
  }

  /**
   * Sanitize a string into a filename-safe slug.
   */
  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/^@/, '') // strip leading @
      .replace(/[\\/:*?"<>|#^[\]]/g, '-') // remove illegal chars
      .replace(/\s+/g, '-') // spaces to hyphens
      .replace(/-{2,}/g, '-') // collapse multiple hyphens
      .replace(/^-|-$/g, '') // trim leading/trailing hyphens
      .slice(0, MAX_SLUG_LENGTH) || 'unknown';
  }

  /**
   * Generate a short hash for collision resolution.
   */
  private shortHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).slice(0, SHORT_HASH_LENGTH);
  }

  // ============================================================================
  // CRUD operations
  // ============================================================================

  /**
   * Create a new author note file with YAML frontmatter + scaffold body.
   *
   * @returns The created TFile
   */
  async createNote(data: AuthorNoteData): Promise<TFile> {
    const notesPath = this.getAuthorNotesPath();
    await this.ensureFolderExists(notesPath);

    // Generate filename
    let filename = this.generateFilename(data.platform, data.authorHandle, data.authorName);
    let fullPath = normalizePath(`${notesPath}/${filename}`);

    // Handle collision
    if (this.app.vault.getFileByPath(fullPath)) {
      const hash = this.shortHash(data.authorKey);
      const base = filename.replace(/\.md$/, '');
      filename = `${base}--${hash}.md`;
      fullPath = normalizePath(`${notesPath}/${filename}`);
    }

    // Build frontmatter YAML
    const frontmatter = this.buildFrontmatterYaml(data);
    const content = `---\n${frontmatter}---\n${DEFAULT_BODY}`;

    const file = await this.app.vault.create(fullPath, content);

    // Update index
    this.invalidateIndex();

    return file;
  }

  /**
   * Find an existing author note by authorKey or legacyKeys.
   */
  findNote(authorUrl: string | undefined, authorName: string, platform: Platform): TFile | null {
    const key = this.buildAuthorKey(authorUrl, authorName, platform);
    return this.findNoteByKey(key);
  }

  /**
   * Find an author note by its authorKey value.
   */
  findNoteByKey(authorKey: string): TFile | null {
    const index = this.getIndex();

    // Direct lookup
    const path = index.get(authorKey);
    if (path) {
      const file = this.app.vault.getFileByPath(path);
      if (file instanceof TFile) return file;
    }

    return null;
  }

  /**
   * Read and parse author note frontmatter from a file.
   */
  readNote(file: TFile): AuthorNoteData | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    if (!fm || fm.type !== AUTHOR_NOTE_TYPE) {
      return null;
    }

    return this.parseFrontmatter(fm);
  }

  /**
   * Read the body (markdown content below frontmatter) of an author note.
   * Returns the trimmed body, or empty string if no body content.
   */
  async readNoteBody(file: TFile): Promise<string> {
    const content = await this.app.vault.cachedRead(file);
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    return body.trim();
  }

  /**
   * Update an existing author note's frontmatter.
   * Preserves body and user-owned fields.
   */
  async updateNote(file: TFile, updates: Partial<AuthorNoteData>): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(updates)) {
        // Never overwrite user-owned fields
        if (USER_OWNED_FIELDS.has(key as keyof AuthorNoteData)) {
          continue;
        }
        if (value !== undefined) {
          fm[key] = value;
        }
      }
    });

    this.invalidateIndex();
  }

  /**
   * Upsert author note from archive PostData.
   *
   * Creates the note if it doesn't exist, or updates frontmatter if it does.
   * Called after successful archive completion.
   */
  async upsertFromArchive(postData: PostData): Promise<TFile | null> {
    if (!this.isEnabled()) return null;

    const platform = postData.platform as Platform;
    const authorUrl = postData.author.url;
    const authorName = postData.author.name;
    const authorHandle = postData.author.handle || postData.author.username;

    if (!authorName && !authorUrl) return null;

    const authorKey = this.buildAuthorKey(authorUrl, authorName, platform);

    // Try to find existing note (by key or legacy keys)
    let existingFile = this.findNoteByKey(authorKey);

    // Also try name-based key if URL-based key didn't match
    // (for legacy key promotion)
    if (!existingFile && authorUrl) {
      const nameKey = this.buildAuthorKey(undefined, authorName, platform);
      existingFile = this.findNoteByKey(nameKey);
    }

    const now = new Date().toISOString();

    if (existingFile) {
      // Update existing note
      const existingData = this.readNote(existingFile);
      if (!existingData) return existingFile;

      const updates: Partial<AuthorNoteData> = {
        lastSeenAt: now,
        lastMetadataUpdate: now,
        archiveCount: (existingData.archiveCount || 0) + 1,
      };

      // Update profile fields if newer/non-empty
      if (authorName) updates.authorName = authorName;
      if (authorHandle) updates.authorHandle = authorHandle;
      if (postData.author.avatar) updates.avatar = postData.author.avatar;
      if (postData.author.localAvatar) updates.localAvatar = postData.author.localAvatar;
      if (postData.author.followers != null) updates.followers = postData.author.followers;
      if (postData.author.postsCount != null) updates.postsCount = postData.author.postsCount;
      if (postData.author.bio) updates.bio = postData.author.bio;
      if (postData.author.verified != null) updates.verified = postData.author.verified;

      // Legacy key promotion: name-based → URL-based
      if (
        authorUrl &&
        existingData.authorKey.includes(':name:') &&
        !authorKey.includes(':name:')
      ) {
        updates.authorKey = authorKey;
        updates.authorUrl = authorUrl;
        const legacyKeys = [...(existingData.legacyKeys || [])];
        if (!legacyKeys.includes(existingData.authorKey)) {
          legacyKeys.push(existingData.authorKey);
        }
        updates.legacyKeys = legacyKeys;
      }

      await this.updateNote(existingFile, updates);
      return existingFile;
    }

    // Create new note
    const noteData: AuthorNoteData = {
      type: AUTHOR_NOTE_TYPE,
      noteVersion: AUTHOR_NOTE_VERSION,
      authorKey,
      legacyKeys: [],
      platform,
      authorName: authorName || 'Unknown',
      authorUrl: authorUrl || undefined,
      authorHandle: authorHandle || undefined,
      avatar: postData.author.avatar || undefined,
      localAvatar: postData.author.localAvatar || undefined,
      followers: postData.author.followers ?? undefined,
      postsCount: postData.author.postsCount ?? undefined,
      bio: postData.author.bio || undefined,
      verified: postData.author.verified ?? undefined,
      archiveCount: 1,
      lastSeenAt: now,
      lastMetadataUpdate: now,
    };

    return this.createNote(noteData);
  }

  /**
   * Upsert author note from an AuthorCatalogEntry (for bulk generation).
   */
  async upsertFromCatalogEntry(entry: AuthorCatalogEntry): Promise<TFile | null> {
    if (!this.isEnabled()) return null;

    const authorKey = this.buildAuthorKey(entry.authorUrl, entry.authorName, entry.platform);

    // Check existing
    let existingFile = this.findNoteByKey(authorKey);
    if (!existingFile && entry.authorUrl) {
      const nameKey = this.buildAuthorKey(undefined, entry.authorName, entry.platform);
      existingFile = this.findNoteByKey(nameKey);
    }

    if (existingFile) {
      // Already exists — update metadata only
      const existingData = this.readNote(existingFile);
      if (!existingData) return existingFile;

      const updates: Partial<AuthorNoteData> = {
        archiveCount: entry.archiveCount,
        lastMetadataUpdate: new Date().toISOString(),
      };

      if (entry.avatar) updates.avatar = entry.avatar;
      if (entry.localAvatar) updates.localAvatar = entry.localAvatar;
      if (entry.followers != null) updates.followers = entry.followers;
      if (entry.postsCount != null) updates.postsCount = entry.postsCount;
      if (entry.bio) updates.bio = entry.bio;
      if (entry.handle) updates.authorHandle = entry.handle;
      if (entry.lastSeenAt) updates.lastSeenAt = entry.lastSeenAt.toISOString();

      // Legacy key promotion
      if (
        entry.authorUrl &&
        existingData.authorKey.includes(':name:') &&
        !authorKey.includes(':name:')
      ) {
        updates.authorKey = authorKey;
        updates.authorUrl = entry.authorUrl;
        const legacyKeys = [...(existingData.legacyKeys || [])];
        if (!legacyKeys.includes(existingData.authorKey)) {
          legacyKeys.push(existingData.authorKey);
        }
        updates.legacyKeys = legacyKeys;
      }

      await this.updateNote(existingFile, updates);
      return existingFile;
    }

    // Create new
    const now = new Date().toISOString();
    const noteData: AuthorNoteData = {
      type: AUTHOR_NOTE_TYPE,
      noteVersion: AUTHOR_NOTE_VERSION,
      authorKey,
      legacyKeys: [],
      platform: entry.platform,
      authorName: entry.authorName || 'Unknown',
      authorUrl: entry.authorUrl || undefined,
      authorHandle: entry.handle || undefined,
      avatar: entry.avatar || undefined,
      localAvatar: entry.localAvatar || undefined,
      followers: entry.followers ?? undefined,
      postsCount: entry.postsCount ?? undefined,
      bio: entry.bio || undefined,
      verified: undefined,
      archiveCount: entry.archiveCount,
      lastSeenAt: entry.lastSeenAt?.toISOString() || now,
      lastMetadataUpdate: now,
    };

    return this.createNote(noteData);
  }

  // ============================================================================
  // Bulk operations
  // ============================================================================

  /**
   * List all author note TFiles in authorNotesPath.
   */
  listNotes(): TFile[] {
    const notesPath = normalizePath(this.getAuthorNotesPath());
    const folder = this.app.vault.getFolderByPath(notesPath);
    if (!folder) return [];

    const files: TFile[] = [];
    this.collectMarkdownFiles(folder, files);
    return files;
  }

  /**
   * Load all author notes as a Map<authorKey, AuthorNoteData>.
   * Also indexes by legacyKeys for lookup.
   */
  loadAllNotes(): Map<string, { data: AuthorNoteData; file: TFile }> {
    const result = new Map<string, { data: AuthorNoteData; file: TFile }>();
    const files = this.listNotes();

    for (const file of files) {
      const data = this.readNote(file);
      if (!data) continue;

      result.set(data.authorKey, { data, file });

      // Index legacy keys too
      for (const legacyKey of data.legacyKeys) {
        if (!result.has(legacyKey)) {
          result.set(legacyKey, { data, file });
        }
      }
    }

    return result;
  }

  /**
   * Convert author note data to AuthorCatalogEntry for catalog display.
   */
  noteToEntry(data: AuthorNoteData, file: TFile): AuthorCatalogEntry {
    return {
      authorName: data.displayNameOverride || data.authorName,
      authorUrl: data.authorUrl || '',
      platform: data.platform,
      avatar: data.avatar || null,
      lastSeenAt: data.lastSeenAt ? new Date(data.lastSeenAt) : new Date(),
      archiveCount: data.archiveCount || 0,
      subscriptionId: null,
      status: 'not_subscribed',
      handle: data.authorHandle,
      localAvatar: data.localAvatar || null,
      followers: data.followers ?? null,
      postsCount: data.postsCount ?? null,
      bio: data.bio || null,
      lastMetadataUpdate: data.lastMetadataUpdate
        ? new Date(data.lastMetadataUpdate)
        : null,
      hasNote: true,
      noteFilePath: file.path,
      displayNameOverride: data.displayNameOverride,
    };
  }

  // ============================================================================
  // Index management
  // ============================================================================

  /**
   * Build or return the authorKey → filePath index.
   */
  private getIndex(): Map<string, string> {
    if (this.indexCache) return this.indexCache;

    const index = new Map<string, string>();
    const files = this.listNotes();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== AUTHOR_NOTE_TYPE) continue;

      const authorKey = fm.authorKey as string;
      if (authorKey) {
        index.set(authorKey, file.path);
      }

      // Index legacy keys
      const legacyKeys = fm.legacyKeys;
      if (Array.isArray(legacyKeys)) {
        for (const key of legacyKeys) {
          if (typeof key === 'string' && !index.has(key)) {
            index.set(key, file.path);
          }
        }
      }
    }

    this.indexCache = index;
    return index;
  }

  /**
   * Invalidate the index cache (call after create/update/delete).
   */
  invalidateIndex(): void {
    this.indexCache = null;
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /**
   * Parse frontmatter record into AuthorNoteData.
   */
  private parseFrontmatter(fm: Record<string, unknown>): AuthorNoteData {
    return {
      type: AUTHOR_NOTE_TYPE,
      noteVersion: typeof fm.noteVersion === 'number' ? fm.noteVersion : AUTHOR_NOTE_VERSION,
      authorKey: String(fm.authorKey || ''),
      legacyKeys: Array.isArray(fm.legacyKeys)
        ? fm.legacyKeys.filter((k): k is string => typeof k === 'string')
        : [],
      platform: String(fm.platform || '') as Platform,
      authorName: String(fm.authorName || ''),
      authorUrl: fm.authorUrl ? String(fm.authorUrl) : undefined,
      authorHandle: fm.authorHandle ? String(fm.authorHandle) : undefined,
      avatar: fm.avatar ? String(fm.avatar) : undefined,
      localAvatar: fm.localAvatar ? String(fm.localAvatar) : undefined,
      followers: typeof fm.followers === 'number' ? fm.followers : undefined,
      postsCount: typeof fm.postsCount === 'number' ? fm.postsCount : undefined,
      bio: fm.bio ? String(fm.bio) : undefined,
      verified: typeof fm.verified === 'boolean' ? fm.verified : undefined,
      archiveCount: typeof fm.archiveCount === 'number' ? fm.archiveCount : 0,
      lastSeenAt: fm.lastSeenAt ? String(fm.lastSeenAt) : undefined,
      lastMetadataUpdate: fm.lastMetadataUpdate ? String(fm.lastMetadataUpdate) : undefined,
      displayNameOverride: fm.displayNameOverride ? String(fm.displayNameOverride) : undefined,
      aliases: Array.isArray(fm.aliases)
        ? fm.aliases.filter((a): a is string => typeof a === 'string')
        : undefined,
      tags: Array.isArray(fm.tags)
        ? fm.tags.filter((t): t is string => typeof t === 'string')
        : undefined,
    };
  }

  /**
   * Build YAML frontmatter string from AuthorNoteData.
   * Uses manual serialization for consistent field ordering.
   */
  private buildFrontmatterYaml(data: AuthorNoteData): string {
    const lines: string[] = [];

    const addField = (key: string, value: unknown) => {
      if (value === undefined || value === null) return;
      if (typeof value === 'string') {
        // Quote strings that could be misinterpreted
        const needsQuotes = value.includes(':') || value.includes('#') ||
          value.includes('{') || value.includes('}') ||
          value.includes('[') || value.includes(']') ||
          value.includes(',') || value.includes('&') ||
          value.includes('*') || value.includes('!') ||
          value.includes('|') || value.includes('>') ||
          value.includes("'") || value.includes('"') ||
          value.includes('%') || value.includes('@') ||
          value === 'true' || value === 'false' ||
          value === 'null' || value === 'yes' || value === 'no' ||
          value === '';
        lines.push(`${key}: ${needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value}`);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`${key}: ${value}`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${key}: []`);
        } else {
          lines.push(`${key}:`);
          for (const item of value) {
            lines.push(`  - ${typeof item === 'string' && item.includes(':') ? `"${item.replace(/"/g, '\\"')}"` : item}`);
          }
        }
      }
    };

    // Ordered fields following PRD spec
    addField('type', data.type);
    addField('noteVersion', data.noteVersion);
    addField('authorKey', data.authorKey);
    addField('legacyKeys', data.legacyKeys);
    addField('platform', data.platform);
    addField('authorName', data.authorName);
    addField('displayNameOverride', data.displayNameOverride);
    addField('authorUrl', data.authorUrl);
    addField('authorHandle', data.authorHandle);
    addField('avatar', data.avatar);
    addField('localAvatar', data.localAvatar);
    addField('followers', data.followers);
    addField('postsCount', data.postsCount);
    addField('bio', data.bio);
    addField('verified', data.verified);
    addField('archiveCount', data.archiveCount);
    addField('lastSeenAt', data.lastSeenAt);
    addField('lastMetadataUpdate', data.lastMetadataUpdate);
    addField('aliases', data.aliases);
    addField('tags', data.tags);

    return lines.join('\n') + '\n';
  }

  /**
   * Recursively collect .md files from a folder.
   */
  private collectMarkdownFiles(folder: TFolder, result: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        result.push(child);
      } else if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, result);
      }
    }
  }

  /**
   * Ensure a folder exists, creating parent folders as needed.
   */
  private async ensureFolderExists(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    if (this.app.vault.getFolderByPath(normalizedPath)) return;

    const parts = normalizedPath.split('/');
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!this.app.vault.getFolderByPath(currentPath)) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch {
          // Folder may have been created concurrently
        }
      }
    }
  }
}
