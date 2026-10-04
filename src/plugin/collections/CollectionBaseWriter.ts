import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import { COLLECTIONS_PROPERTY } from './CollectionPropertyMirror';

/**
 * "Create base from collection" (prd-collections-obsidian-plugin O7): a
 * `.base` file that filters archive notes on their `archiveCollections`
 * property — which is why the property mirror must be on. Bases syntax:
 * help.obsidian.md/bases/syntax. `list()` keeps a hand-written single value working.
 */

/** The plugin's own Bases view (registered in main.ts as 'social-archiver-media-gallery'). */
const MEDIA_GALLERY_VIEW = 'social-archiver-media-gallery';

/** A Bases text literal inside a single-quoted YAML scalar. */
export function baseStringLiteral(value: string): string {
  const expressionLiteral = `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return expressionLiteral.replace(/'/g, "''");
}

/** A YAML double-quoted scalar for a view name. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildCollectionBase(collectionName: string): string {
  const filter = `'list(note.${COLLECTIONS_PROPERTY}).contains(${baseStringLiteral(collectionName)})'`;
  return [
    'filters:',
    '  and:',
    `    - ${filter}`,
    'views:',
    '  - type: cards',
    `    name: ${yamlString(collectionName)}`,
    '    order:',
    '      - file.name',
    '      - note.platform',
    '      - note.author',
    '  - type: table',
    '    name: "Table"',
    '    order:',
    '      - file.name',
    '      - note.platform',
    '      - note.author',
    '      - note.published',
    '      - note.archived',
    `  - type: ${MEDIA_GALLERY_VIEW}`,
    '    name: "Media"',
    '',
  ].join('\n');
}

/** A collection name as a file name: path separators and characters Obsidian rejects are dropped. */
export function collectionBaseFileName(collectionName: string): string {
  const cleaned = collectionName.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'Collection';
}

/**
 * Write the base under `<archive folder>/Collections/`, or return the existing
 * one: an existing file is never overwritten (the user may have edited it).
 */
export async function writeCollectionBase(app: App, archivePath: string, collectionName: string): Promise<{ file: TFile; created: boolean }> {
  const folderPath = normalizePath(`${archivePath || 'Social Archives'}/Collections`);
  if (!(app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
    await app.vault.createFolder(folderPath);
  }
  const path = normalizePath(`${folderPath}/${collectionBaseFileName(collectionName)}.base`);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return { file: existing, created: false };
  const file = await app.vault.create(path, buildCollectionBase(collectionName));
  return { file, created: true };
}
