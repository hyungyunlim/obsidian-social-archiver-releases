import { describe, expect, it } from 'vitest';
import { baseStringLiteral, buildCollectionBase, collectionBaseFileName } from '../../../plugin/collections/CollectionBaseWriter';

describe('CollectionBaseWriter', () => {
  it('filters on the archiveCollections list, tolerating a single value', () => {
    const base = buildCollectionBase('Trips');
    expect(base).toContain(`    - 'list(note.archiveCollections).contains("Trips")'`);
    expect(base).toContain('  - type: cards\n    name: "Trips"');
    expect(base).toContain('  - type: table');
    expect(base).toContain('  - type: social-archiver-media-gallery');
  });

  it('escapes quotes for both the expression and the YAML scalar', () => {
    // Bases sees "Bob's \"best\"" once YAML has undone the doubled single quote.
    expect(baseStringLiteral(`Bob's "best"`)).toBe(`"Bob''s \\"best\\""`);
    expect(buildCollectionBase('Say "hi"')).toContain('    name: "Say \\"hi\\""');
  });

  it('turns a collection name into a safe file name', () => {
    expect(collectionBaseFileName('Trips / 2026: Taiwan?')).toBe('Trips 2026 Taiwan');
    expect(collectionBaseFileName('###')).toBe('Collection');
    expect(collectionBaseFileName('가오슝')).toBe('가오슝');
  });
});
