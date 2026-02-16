import { type App, type TFile, TFolder } from 'obsidian';
import type { TagDefinition, TagWithCount } from '@/types/tag';
import { TAG_COLORS, TAG_NAME_MAX_LENGTH } from '@/types/tag';
import type SocialArchiverPlugin from '@/main';

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

  /** Get a tag definition by name (case-insensitive) */
  getTagByName(name: string): TagDefinition | undefined {
    const lower = name.toLowerCase();
    return this.getTagDefinitions().find(t => t.name.toLowerCase() === lower);
  }

  /** Create a new tag definition */
  async createTag(name: string, color?: string | null): Promise<TagDefinition> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > TAG_NAME_MAX_LENGTH) {
      throw new Error(`Tag name must be 1-${TAG_NAME_MAX_LENGTH} characters`);
    }

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

    const existing = definitions[index]!;

    // Validate name uniqueness if changing
    if (changes.name && changes.name !== existing.name) {
      const trimmed = changes.name.trim();
      if (!trimmed || trimmed.length > TAG_NAME_MAX_LENGTH) {
        throw new Error(`Tag name must be 1-${TAG_NAME_MAX_LENGTH} characters`);
      }
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
    if (!file || !(file instanceof TFolder === false && 'extension' in file)) return [];

    const cache = this.app.metadataCache.getFileCache(file as TFile);
    const tags = cache?.frontmatter?.tags;
    if (!Array.isArray(tags)) return [];

    return tags.filter((t: unknown): t is string => typeof t === 'string');
  }

  /** Add a tag to a post's YAML frontmatter */
  async addTagToPost(filePath: string, tagName: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !('extension' in file)) return;

    await this.app.fileManager.processFrontMatter(file as TFile, (frontmatter) => {
      if (!Array.isArray(frontmatter.tags)) {
        frontmatter.tags = [];
      }
      // Avoid duplicates (case-insensitive)
      const lower = tagName.toLowerCase();
      if (!frontmatter.tags.some((t: string) => t.toLowerCase() === lower)) {
        frontmatter.tags.push(tagName);
      }
    });
  }

  /** Remove a tag from a post's YAML frontmatter */
  async removeTagFromPost(filePath: string, tagName: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !('extension' in file)) return;

    await this.app.fileManager.processFrontMatter(file as TFile, (frontmatter) => {
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
        const tags = cache?.frontmatter?.tags;
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
      const tags = cache?.frontmatter?.tags;
      if (!Array.isArray(tags)) continue;
      if (!tags.some((t: string) => typeof t === 'string' && t.toLowerCase() === lower)) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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
      const tags = cache?.frontmatter?.tags;
      if (!Array.isArray(tags)) continue;
      if (!tags.some((t: string) => t.toLowerCase() === oldLower)) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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
      const tags = cache?.frontmatter?.tags;
      if (!Array.isArray(tags)) continue;
      if (!tags.some((t: string) => t.toLowerCase() === lower)) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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
      } else if ('extension' in child && (child as TFile).extension === 'md') {
        files.push(child as TFile);
      }
    }
    return files;
  }

  /** Count tag occurrences recursively in a folder (discovers undefined tags too) */
  private countTagsInFolder(folder: TFolder, countMap: Map<string, number>, originalNames: Map<string, string>): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        this.countTagsInFolder(child, countMap, originalNames);
      } else if ('extension' in child && (child as TFile).extension === 'md') {
        const cache = this.app.metadataCache.getFileCache(child as TFile);
        const tags = cache?.frontmatter?.tags;
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
