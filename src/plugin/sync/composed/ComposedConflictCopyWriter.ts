/**
 * Saves the vault's version of a composed post as a conflict copy before the
 * note is rewritten from the server (prd-plugin-my-posts-two-way-sync §5.4).
 *
 * The copy keeps the note's text and user frontmatter, loses every field that
 * binds it to the server row (so it is neither synced nor matched), and points
 * back with `conflictOf`. Copies are never deleted automatically. Takes no
 * locks: the caller holds the archive write locks.
 */

import { Notice, type App, type TFile } from 'obsidian';
import { t } from '../../../i18n';

const LOG_PREFIX = '[Social Archiver] [ComposedConflictCopy]';
const NOTICE_DURATION_MS = 15_000;

/** Identity, sync and share fields; `originalUrl` too, because library sync's Tier 2 matches on it. */
export const CONFLICT_COPY_STRIPPED_FIELDS: readonly string[] = [
  'sourceArchiveId',
  'clientPostId',
  'postOrigin',
  'syncState',
  'serverSyncedAt',
  'syncedContentHash',
  'syncedContentRevision',
  'syncedMedia',
  'syncedMediaNext',
  'share',
  'shareId',
  'shareUrl',
  'sharePassword',
  'shareMode',
  'originalUrl',
];

/** `${parent}/${basename} (conflict YYYY-MM-DD HH-mm).md` in local time; the caller adds " 2", " 3"… on collision. */
export function conflictCopyPath(parentPath: string, basename: string, now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const name = `${basename} (conflict ${stamp}).md`;
  return parentPath && parentPath !== '/' ? `${parentPath}/${name}` : name;
}

export class ComposedConflictCopyWriter {
  constructor(private readonly app: App) {}

  async write(file: TFile, now: Date = new Date()): Promise<TFile> {
    const raw = await this.app.vault.read(file);
    const frontmatterBlock = /^---\n[\s\S]*?\n---\n/.exec(raw)?.[0] ?? '';
    const frontmatter = { ...(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) } as Record<string, unknown>;

    const base = conflictCopyPath(file.parent?.path ?? '', file.basename, now);
    let path = base;
    for (let n = 2; this.app.vault.getFileByPath(path); n++) path = base.replace(/\.md$/, ` ${n}.md`);

    // Created without frontmatter, then given it: the copy never exists with
    // the original's identity, so lookup and the push watcher never see a twin.
    const copy = await this.app.vault.create(path, raw.slice(frontmatterBlock.length));
    await this.app.fileManager.processFrontMatter(copy, (fm: Record<string, unknown>) => {
      Object.assign(fm, frontmatter);
      for (const field of CONFLICT_COPY_STRIPPED_FIELDS) delete fm[field];
      fm['conflictOf'] = `[[${file.basename}]]`;
    });
    this.notify(file, copy);
    return copy;
  }

  private notify(file: TFile, copy: TFile): void {
    try {
      const notice = new Notice(t('composed.conflict.notice', { name: file.basename }), NOTICE_DURATION_MS);
      notice.containerEl.setAttribute('role', 'button');
      notice.containerEl.setAttribute('aria-label', t('composed.conflict.open'));
      notice.containerEl.addEventListener('click', () => {
        notice.hide();
        void this.app.workspace.getLeaf('tab').openFile(copy);
      });
    } catch (error) {
      // The copy is saved; only the notice failed.
      console.warn(`${LOG_PREFIX} Notice failed for ${copy.path}:`, error);
    }
  }
}
