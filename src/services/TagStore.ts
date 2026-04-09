import { TFile, TFolder, type App } from 'obsidian';
import type { TagDefinition, TagWithCount } from '@/types/tag';
import { TAG_COLORS } from '@/types/tag';
import { normalizeTagName, validateTagName } from '@/utils/tags';
import type SocialArchiverPlugin from '@/main';
import type { WorkersAPIClient, UserTag } from './WorkersAPIClient';

/**
 * TagStore - Manages user-defined tag definitions and tag-post assignments
 *
 * Single Responsibility: Tag CRUD operations and YAML frontmatter tag management
 *
 * Storage:
 * - Tag definitions (name, color, sortOrder) → plugin data.json via settings
 * - Tag assignments per post → YAML frontmatter `tags` array
 */
export class TagStore {
  private app: App;
  private plugin: SocialArchiverPlugin;

  constructor(app: App, plugin: SocialArchiverPlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  // ============================================================
  // Tag Definition CRUD (stored in plugin settings)
  // ============================================================

  /** Get all tag definitions */
  getTagDefinitions(): TagDefinition[] {
    return this.plugin.settings.tagDefinitions || [];
  }

  /** Get a tag definition by ID */
  getTagById(id: string): TagDefinition | undefined {
    return this.getTagDefinitions().find(t => t.id === id);
  }

  /** Get a tag definition by name (case-insensitive, `#` prefix stripped) */
  getTagByName(name: string): TagDefinition | undefined {
    const lower = normalizeTagName(name).toLowerCase();
    return this.getTagDefinitions().find(t => t.name.toLowerCase() === lower);
  }

  /** Create a new tag definition */
  async createTag(name: string, color?: string | null): Promise<TagDefinition> {
    const validationError = validateTagName(name);
    if (validationError) {
      throw new Error(validationError);
    }
    const trimmed = normalizeTagName(name);

    if (this.getTagByName(trimmed)) {
      throw new Error(`Tag "${trimmed}" already exists`);
    }

    const definitions = this.getTagDefinitions();
    const tag: TagDefinition = {
      id: this.generateId(),
      name: trimmed,
      color: color ?? this.getNextColor(definitions),
      sortOrder: definitions.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    definitions.push(tag);
    await this.saveTagDefinitions(definitions);
    return tag;
  }

  /** Update an existing tag definition */
  async updateTag(id: string, changes: Partial<Pick<TagDefinition, 'name' | 'color' | 'sortOrder'>>): Promise<TagDefinition | undefined> {
    const definitions = this.getTagDefinitions();
    const index = definitions.findIndex(t => t.id === id);
    if (index === -1) return undefined;

    const existing = definitions[index];
    if (!existing) return undefined;

    // Validate name uniqueness if changing
    if (changes.name && changes.name !== existing.name) {
      const validationError = validateTagName(changes.name);
      if (validationError) {
        throw new Error(validationError);
      }
      const trimmed = changes.name.trim();
      if (this.getTagByName(trimmed)) {
        throw new Error(`Tag "${trimmed}" already exists`);
      }
    }

    // If renaming, update all posts that have the old tag name
    if (changes.name && changes.name.trim() !== existing.name) {
      await this.renameTagInAllPosts(existing.name, changes.name.trim());
    }

    const updated: TagDefinition = {
      id: existing.id,
      createdAt: existing.createdAt,
      sortOrder: changes.sortOrder ?? existing.sortOrder,
      color: changes.color !== undefined ? changes.color : existing.color,
      name: changes.name?.trim() ?? existing.name,
      updatedAt: new Date().toISOString(),
    };
    definitions[index] = updated;

    await this.saveTagDefinitions(definitions);
    return definitions[index];
  }

  /** Delete a tag definition and remove from all posts */
  async deleteTag(id: string): Promise<boolean> {
    const definitions = this.getTagDefinitions();
    const tag = definitions.find(t => t.id === id);
    if (!tag) return false;

    // Remove tag from all posts
    await this.removeTagFromAllPosts(tag.name);

    // Remove from definitions
    const filtered = definitions.filter(t => t.id !== id);
    await this.saveTagDefinitions(filtered);
    return true;
  }

  // ============================================================
  // Tag-Post Assignment (YAML frontmatter)
  // ============================================================

  /** Get tags for a post from its YAML frontmatter (returns all tags, including undefined ones) */
  getTagsForPost(filePath: string): string[] {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return [];

    const cache = this.app.metadataCache.getFileCache(file);
    const rawTags: unknown = cache?.frontmatter?.tags;
    if (!Array.isArray(rawTags)) return [];

    return rawTags.filter((t: unknown): t is string => typeof t === 'string');
  }

  /** Add a tag to a post's YAML frontmatter */
  async addTagToPost(filePath: string, tagName: string): Promise<void> {
    const validationError = validateTagName(tagName);
    if (validationError) {
      throw new Error(validationError);
    }
    const normalizedTagName = tagName.trim();

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      if (!Array.isArray(frontmatter.tags)) {
        frontmatter.tags = [];
      }
      const tagsArr = frontmatter.tags as string[];
      // Avoid duplicates (case-insensitive)
      const lower = normalizedTagName.toLowerCase();
      if (!tagsArr.some((t: string) => t.toLowerCase() === lower)) {
        tagsArr.push(normalizedTagName);
      }
    });
  }

  /** Remove a tag from a post's YAML frontmatter */
  async removeTagFromPost(filePath: string, tagName: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      if (!Array.isArray(frontmatter.tags)) return;
      const lower = tagName.toLowerCase();
      frontmatter.tags = frontmatter.tags.filter((t: string) => t.toLowerCase() !== lower);
    });
  }

  /** Toggle a tag on a post (add if missing, remove if present) */
  async toggleTagOnPost(filePath: string, tagName: string): Promise<boolean> {
    const currentTags = this.getTagsForPost(filePath);
    const lower = tagName.toLowerCase();
    const exists = currentTags.some(t => t.toLowerCase() === lower);

    if (exists) {
      await this.removeTagFromPost(filePath, tagName);
      return false; // removed
    } else {
      await this.addTagToPost(filePath, tagName);
      return true; // added
    }
  }

  /**
   * Get all discovered tags from YAML frontmatter (including ones without a TagDefinition).
   * Returns TagDefinition-shaped objects: defined tags have full data, undefined tags have id='auto:...' and color=null.
   */
  getAllDiscoveredTags(): TagDefinition[] {
    const definitions = this.getTagDefinitions();
    const definedLower = new Set(definitions.map(d => d.name.toLowerCase()));

    // Scan archive folder for all tags
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';
    const folder = this.app.vault.getAbstractFileByPath(archivePath);
    const discovered = new Map<string, string>(); // lowercase → original casing

    if (folder && folder instanceof TFolder) {
      const files = this.getMarkdownFiles(folder);
      for (const file of files) {
        const cache = this.app.metadataCache.getFileCache(file);
        // Skip author note files
        if (cache?.frontmatter?.type === 'social-archiver-author') continue;
        const rawTagsValue: unknown = cache?.frontmatter?.tags;
        const tags = Array.isArray(rawTagsValue) ? rawTagsValue : [];
        if (Array.isArray(tags)) {
          for (const tag of tags) {
            if (typeof tag !== 'string') continue;
            const lower = tag.toLowerCase();
            if (!definedLower.has(lower) && !discovered.has(lower)) {
              discovered.set(lower, tag);
            }
          }
        }
      }
    }

    // Merge: defined tags first, then undefined
    const result: TagDefinition[] = [...definitions];
    for (const [, originalName] of discovered) {
      result.push({
        id: `auto:${originalName.toLowerCase()}`,
        name: originalName,
        color: null,
        sortOrder: 9999,
        createdAt: '',
        updatedAt: '',
      });
    }

    return result;
  }

  /** Remove a tag from ALL posts in the archive folder (public, for bulk cleanup) */
  async bulkRemoveTag(tagName: string): Promise<number> {
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';
    const folder = this.app.vault.getAbstractFileByPath(archivePath);
    if (!folder || !(folder instanceof TFolder)) return 0;

    const files = this.getMarkdownFiles(folder);
    const lower = tagName.toLowerCase();
    let count = 0;

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      // Skip author note files
      if (cache?.frontmatter?.type === 'social-archiver-author') continue;
      const rawTagsValue: unknown = cache?.frontmatter?.tags;
        const tags = Array.isArray(rawTagsValue) ? rawTagsValue : [];
      if (!Array.isArray(tags)) continue;
      if (!tags.some((t: string) => typeof t === 'string' && t.toLowerCase() === lower)) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (!Array.isArray(frontmatter.tags)) return;
        frontmatter.tags = frontmatter.tags.filter((t: string) => t.toLowerCase() !== lower);
      });
      count++;
    }

    return count;
  }

  /** Get all tag definitions with archive counts, including undefined tags from YAML */
  getTagsWithCounts(): TagWithCount[] {
    const definitions = this.getTagDefinitions();

    // Build a map of tag name (lowercase) → count for ALL tags found in files
    const countMap = new Map<string, number>();
    // Track original casing for undefined tags
    const originalNames = new Map<string, string>();

    // Pre-populate defined tags
    definitions.forEach(d => {
      countMap.set(d.name.toLowerCase(), 0);
      originalNames.set(d.name.toLowerCase(), d.name);
    });

    // Scan all markdown files in archive path (discovers undefined tags too)
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';
    const folder = this.app.vault.getAbstractFileByPath(archivePath);
    if (folder && folder instanceof TFolder) {
      this.countTagsInFolder(folder, countMap, originalNames);
    }

    // Build results: defined tags first
    const results: TagWithCount[] = definitions.map(d => ({
      ...d,
      archiveCount: countMap.get(d.name.toLowerCase()) || 0,
    }));

    // Append undefined tags (found in YAML but no TagDefinition)
    const definedLower = new Set(definitions.map(d => d.name.toLowerCase()));
    for (const [lower, count] of countMap) {
      if (!definedLower.has(lower) && count > 0) {
        results.push({
          id: `auto:${lower}`,
          name: originalNames.get(lower) || lower,
          color: null,
          sortOrder: 9999,
          createdAt: '',
          updatedAt: '',
          archiveCount: count,
        });
      }
    }

    return results;
  }

  // ============================================================
  // Server Tag Sync (inbound: server → local tagDefinitions)
  // ============================================================

  /**
   * Pull tag definitions from the server and merge into local tagDefinitions.
   *
   * Merge strategy:
   * - Server tags not in local → add with server color (or auto-assign if null)
   * - Server tags already in local → update name casing & sortOrder from server,
   *   keep local color if server color is null (local color takes priority)
   * - Local-only tags (not on server) → keep as-is
   * - Deleted tags on server → remove from local
   */
  async pullTagDefinitionsFromServer(apiClient: WorkersAPIClient): Promise<number> {
    try {
      const response = await apiClient.getUserTags();
      const { tags: serverTags, deletedIds } = response;

      if (serverTags.length === 0 && deletedIds.length === 0) return 0;

      const definitions = this.getTagDefinitions();
      const localByName = new Map<string, TagDefinition>();
      const localById = new Map<string, TagDefinition>();
      for (const d of definitions) {
        localByName.set(d.name.toLowerCase(), d);
        localById.set(d.id, d);
      }

      let changeCount = 0;

      // Remove server-deleted tags from local
      if (deletedIds.length > 0) {
        const deleteSet = new Set(deletedIds);
        const before = definitions.length;
        const filtered = definitions.filter(d => !deleteSet.has(d.id));
        if (filtered.length < before) {
          definitions.length = 0;
          definitions.push(...filtered);
          changeCount += before - filtered.length;
        }
      }

      // Merge server tags
      for (const serverTag of serverTags) {
        const normalizedName = normalizeTagName(serverTag.name);
        if (!normalizedName) continue;

        const existingById = localById.get(serverTag.id);
        const existingByName = localByName.get(normalizedName.toLowerCase());
        const existing = existingById || existingByName;

        if (existing) {
          // Update existing: server wins for name/sortOrder, local wins for color if server is null
          let changed = false;
          if (existing.name !== normalizedName) {
            existing.name = normalizedName;
            changed = true;
          }
          if (serverTag.sortOrder !== existing.sortOrder) {
            existing.sortOrder = serverTag.sortOrder;
            changed = true;
          }
          if (serverTag.color && serverTag.color !== existing.color) {
            existing.color = serverTag.color;
            changed = true;
          }
          // Sync server ID if matched by name but has different local ID
          if (existing.id !== serverTag.id) {
            existing.id = serverTag.id;
            changed = true;
          }
          if (serverTag.updatedAt && serverTag.updatedAt > (existing.updatedAt || '')) {
            existing.updatedAt = serverTag.updatedAt;
          }
          if (changed) changeCount++;
        } else {
          // New tag from server — add with color (auto-assign if server color is null)
          const newDef: TagDefinition = {
            id: serverTag.id,
            name: normalizedName,
            color: serverTag.color || this.getNextColor(definitions),
            sortOrder: serverTag.sortOrder,
            createdAt: serverTag.createdAt || new Date().toISOString(),
            updatedAt: serverTag.updatedAt || new Date().toISOString(),
          };
          definitions.push(newDef);
          localByName.set(normalizedName.toLowerCase(), newDef);
          localById.set(serverTag.id, newDef);
          changeCount++;
        }
      }

      if (changeCount > 0) {
        await this.saveTagDefinitions(definitions);
        console.debug(`[Social Archiver] Tag sync: ${changeCount} changes merged from server (${serverTags.length} tags, ${deletedIds.length} deleted)`);
      }

      return changeCount;
    } catch (err) {
      console.error('[Social Archiver] Failed to pull tag definitions from server:', err instanceof Error ? err.message : String(err));
      return 0;
    }
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private async saveTagDefinitions(definitions: TagDefinition[]): Promise<void> {
    this.plugin.settings.tagDefinitions = definitions;
    await this.plugin.saveData(this.plugin.settings);
  }

  private getNextColor(definitions: TagDefinition[]): string {
    const usedColors = new Set(definitions.map(d => d.color).filter(Boolean));
    for (const color of TAG_COLORS) {
      if (!usedColors.has(color)) return color;
    }
    // All used, cycle
    return TAG_COLORS[definitions.length % TAG_COLORS.length] as string;
  }

  private generateId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : `tag-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /** Rename a tag across all posts in the archive folder */
  private async renameTagInAllPosts(oldName: string, newName: string): Promise<void> {
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';
    const folder = this.app.vault.getAbstractFileByPath(archivePath);
    if (!folder || !(folder instanceof TFolder)) return;

    const files = this.getMarkdownFiles(folder);
    const oldLower = oldName.toLowerCase();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      // Skip author note files
      if (cache?.frontmatter?.type === 'social-archiver-author') continue;
      const rawTagsValue: unknown = cache?.frontmatter?.tags;
        const tags = Array.isArray(rawTagsValue) ? rawTagsValue : [];
      if (!Array.isArray(tags)) continue;
      if (!tags.some((t: string) => t.toLowerCase() === oldLower)) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (!Array.isArray(frontmatter.tags)) return;
        frontmatter.tags = frontmatter.tags.map((t: string) =>
          t.toLowerCase() === oldLower ? newName : t
        );
      });
    }
  }

  /** Remove a tag from all posts in the archive folder */
  private async removeTagFromAllPosts(tagName: string): Promise<void> {
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';
    const folder = this.app.vault.getAbstractFileByPath(archivePath);
    if (!folder || !(folder instanceof TFolder)) return;

    const files = this.getMarkdownFiles(folder);
    const lower = tagName.toLowerCase();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      // Skip author note files
      if (cache?.frontmatter?.type === 'social-archiver-author') continue;
      const rawTagsValue: unknown = cache?.frontmatter?.tags;
        const tags = Array.isArray(rawTagsValue) ? rawTagsValue : [];
      if (!Array.isArray(tags)) continue;
      if (!tags.some((t: string) => t.toLowerCase() === lower)) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (!Array.isArray(frontmatter.tags)) return;
        frontmatter.tags = frontmatter.tags.filter((t: string) => t.toLowerCase() !== lower);
      });
    }
  }

  /** Recursively get all markdown files in a folder */
  private getMarkdownFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        files.push(...this.getMarkdownFiles(child));
      } else if (child instanceof TFile && child.extension === 'md') {
        files.push(child);
      }
    }
    return files;
  }

  /** Count tag occurrences recursively in a folder (discovers undefined tags too) */
  private countTagsInFolder(folder: TFolder, countMap: Map<string, number>, originalNames: Map<string, string>): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        this.countTagsInFolder(child, countMap, originalNames);
      } else if (child instanceof TFile && child.extension === 'md') {
        const cache = this.app.metadataCache.getFileCache(child);
        // Skip author note files
        if (cache?.frontmatter?.type === 'social-archiver-author') continue;
        const rawTagsValue: unknown = cache?.frontmatter?.tags;
        const tags = Array.isArray(rawTagsValue) ? rawTagsValue : [];
        if (Array.isArray(tags)) {
          for (const tag of tags) {
            if (typeof tag !== 'string') continue;
            const lower = tag.toLowerCase();
            countMap.set(lower, (countMap.get(lower) || 0) + 1);
            // Keep first-seen casing for undefined tags
            if (!originalNames.has(lower)) {
              originalNames.set(lower, tag);
            }
          }
        }
      }
    }
  }
}
