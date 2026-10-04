import { Notice, TFile, type App, type Plugin } from 'obsidian';
import { t } from '../../i18n';
import { IMPORT_MODE_FRONTMATTER_KEY, IMPORT_MODE_LOCAL_ONLY } from '../../services/import/local/LocalArchiveScanner';
import type { CollectionStore } from '../../services/collections/CollectionStore';
import { canContribute, canManage } from '../../types/collections';
import type { CollectablePost, CollectionUiActions } from './CollectionUiActions';

/**
 * Obsidian-native ways into collections (prd-collections-obsidian-plugin §4.2):
 * command-palette commands and a file-menu item on archive notes. The apps
 * have no equivalent; here they let a note be filed without the timeline.
 * No default hotkeys (Obsidian guideline).
 */

export interface CollectionCommandDeps {
  app: App;
  plugin: Plugin;
  ui: () => CollectionUiActions;
  store: () => CollectionStore;
  /** Phase 3; absent = command not registered. */
  createBase?: (collectionId: string) => Promise<void>;
}

/** What a note is to collections: its server archive id, or why it has none. */
export function collectablePostForFile(app: App, file: TFile | null): CollectablePost | null {
  if (!file || file.extension !== 'md') return null;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return null;
  const archiveId = typeof frontmatter.sourceArchiveId === 'string' && frontmatter.sourceArchiveId.trim()
    ? frontmatter.sourceArchiveId.trim()
    : undefined;
  return {
    ...(archiveId ? { sourceArchiveId: archiveId } : {}),
    isLocalOnly: frontmatter[IMPORT_MODE_FRONTMATTER_KEY] === IMPORT_MODE_LOCAL_ONLY,
  };
}

export function registerCollectionCommands(deps: CollectionCommandDeps): void {
  const { app, plugin } = deps;

  plugin.addCommand({
    id: 'add-note-to-collection',
    name: t('col.cmd.addNote'),
    checkCallback: (checking) => {
      const post = collectablePostForFile(app, app.workspace.getActiveFile());
      // Archive notes only: linked to the account, or local-only (which get the upload hint).
      if (!post || (!post.sourceArchiveId && !post.isLocalOnly)) return false;
      if (!checking) deps.ui().openPickerForPosts([post]);
      return true;
    },
  });

  plugin.addCommand({
    id: 'remove-note-from-collection',
    name: t('col.cmd.removeNote'),
    checkCallback: (checking) => {
      const archiveId = collectablePostForFile(app, app.workspace.getActiveFile())?.sourceArchiveId;
      if (!archiveId) return false;
      const store = deps.store();
      const removable = new Set(
        store.getCollectionIdsForArchive(archiveId).filter((id) => canContribute(store.getCollection(id)?.role ?? 'owner')),
      );
      if (removable.size === 0) return false;
      if (!checking) {
        deps.ui().openSwitcher({
          allowCreate: false,
          filter: (collection) => removable.has(collection.id),
          onChoose: (choice) => {
            if (choice.kind === 'collection') deps.ui().removeFromCollection(choice.collection.id, [archiveId]);
          },
        });
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'open-collection',
    name: t('col.cmd.open'),
    callback: () => deps.ui().openSwitcher(),
  });

  plugin.addCommand({
    id: 'copy-collection-link',
    name: t('col.cmd.copyLink'),
    callback: () => {
      deps.ui().openSwitcher({
        allowCreate: false,
        filter: (collection) => canManage(collection.role ?? 'owner'),
        onChoose: (choice) => {
          if (choice.kind === 'collection') void deps.ui().copyLink(choice.collection.id);
        },
      });
    },
  });

  if (deps.createBase) {
    const createBase = deps.createBase;
    plugin.addCommand({
      id: 'create-base-from-collection',
      name: t('col.cmd.createBase'),
      callback: () => {
        deps.ui().openSwitcher({
          allowCreate: false,
          onChoose: (choice) => {
            if (choice.kind === 'collection') void createBase(choice.collection.id);
          },
        });
      },
    });
  }
}

/** "Add to collection" on archive notes in the file explorer menu. */
export function registerCollectionFileMenu(deps: CollectionCommandDeps): void {
  const { app, plugin } = deps;
  plugin.registerEvent(
    app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile)) return;
      const post = collectablePostForFile(app, file);
      if (!post?.sourceArchiveId) return;
      menu.addItem((item) => {
        item
          .setTitle(t('col.action.add'))
          .setIcon('folder-plus')
          .onClick(() => {
            if (!post.sourceArchiveId) {
              new Notice(t('col.localOnly'));
              return;
            }
            deps.ui().openPickerForPosts([post]);
          });
      });
    }),
  );
}
