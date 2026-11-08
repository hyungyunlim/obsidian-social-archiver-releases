/**
 * One pass per vault over the `<` older note writers left in archived posts
 * (escape-html-openers.ts):
 * - Before 4.7.11 a caption's `<Hang On>` was written as is. Live Preview then
 *   shows every line after it (images, headings, the author line) as raw
 *   markdown, and the reading view hides the text.
 * - 4.7.11 to 4.11 wrote `&lt;`, which Live Preview shows as typed.
 * Both become `\<`.
 *
 * Only the post text changes: from the end of the frontmatter to the first `---`
 * line. Media, the author line, comments and the user's own sections come after
 * it. These are left alone: notes without that line, web articles, blogs, user
 * posts, browser clips (their markup is deliberate), and notes with highlights
 * (their marks quote the text).
 */

import type { App } from 'obsidian';
import type { SocialArchiverSettings } from '../../types/settings';
import { repairHtmlOpeners } from '../../utils/escape-html-openers';

const LOG_PREFIX = '[Social Archiver] [AngleBracketRepair]';

/** Platforms whose note body is the post's plain text, escaped by the writer. */
const PLAIN_TEXT_PLATFORMS = new Set([
  'instagram', 'facebook', 'x', 'threads', 'tiktok', 'linkedin', 'youtube', 'reddit',
  'pinterest', 'mastodon', 'bluesky', 'xiaohongshu', 'weibo',
]);

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const RULE = /^---[ \t]*\r?$/m;

export function isRepairableArchiveNote(fm: Record<string, unknown> | undefined): boolean {
  if (!fm) return false;
  const platform = fm['platform'];
  if (typeof platform !== 'string' || !PLAIN_TEXT_PLATFORMS.has(platform)) return false;
  if (typeof fm['sourceArchiveId'] !== 'string' && typeof fm['originalUrl'] !== 'string') return false;
  const importSource = fm['social_archiver_import_source'];
  if (typeof importSource === 'string' && importSource.startsWith('browser-clip:')) return false;
  return !(Number(fm['userHighlightCount']) > 0);
}

/** The note with its post text repaired, or null when nothing changes. */
export function repairArchiveNoteBody(markdown: string): string | null {
  const head = FRONTMATTER.exec(markdown)?.[0];
  if (!head) return null;
  const rest = markdown.slice(head.length);
  const rule = RULE.exec(rest);
  if (!rule) return null;
  const body = rest.slice(0, rule.index);
  const fixed = repairHtmlOpeners(body);
  return fixed === body ? null : head + fixed + rest.slice(rule.index);
}

export interface AngleBracketNoteRepairDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  saveSettings: () => Promise<void>;
  /** Resolves once the metadata cache knows every note's frontmatter. */
  waitForIndex: () => Promise<void>;
  isOpen: (path: string) => boolean;
}

export class AngleBracketNoteRepairService {
  private running = false;

  constructor(private readonly deps: AngleBracketNoteRepairDeps) {}

  async runIfNeeded(): Promise<void> {
    if (this.running || this.deps.settings().angleBracketRepairDone) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      console.warn(`${LOG_PREFIX} Stopped, retried next load:`, error);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    await this.deps.waitForIndex();
    const { app } = this.deps;
    let repaired = 0;
    let left = 0;
    for (const [index, file] of app.vault.getMarkdownFiles().entries()) {
      // A few thousand reads: give the UI a turn now and then.
      if (index % 200 === 199) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!isRepairableArchiveNote(app.metadataCache.getFileCache(file)?.frontmatter)) continue;
      if (repairArchiveNoteBody(await app.vault.cachedRead(file)) === null) continue;
      // An open note is the user's: next load.
      if (this.deps.isOpen(file.path)) {
        left += 1;
        continue;
      }
      try {
        let changed = false;
        await app.vault.process(file, (current) => {
          const next = repairArchiveNoteBody(current);
          changed = next !== null;
          return next ?? current;
        });
        if (changed) repaired += 1;
      } catch (error) {
        left += 1;
        console.warn(`${LOG_PREFIX} Could not repair ${file.path}:`, error);
      }
    }
    if (repaired > 0) console.debug(`${LOG_PREFIX} Repaired the < in ${repaired} note(s)`);
    if (left > 0) return;
    // Fresh object: saveSettingsPartial swaps it on every save.
    this.deps.settings().angleBracketRepairDone = true;
    await this.deps.saveSettings();
  }
}
