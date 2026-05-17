import { describe, expect, it } from 'vitest';
import {
  CliValidationError,
  containsTraversal,
  normalizeVaultPath,
  parseAbsolutePath,
  parseBool,
  parseCsv,
  parseEnum,
  parseNumber,
  parseString,
  parseVaultPath,
  type CliParams,
} from '@/plugin/cli/CliParams';

describe('CliParams', () => {
  describe('parseBool', () => {
    it('returns default when missing', () => {
      expect(parseBool({}, 'foo', false)).toBe(false);
      expect(parseBool({}, 'foo', true)).toBe(true);
    });

    it('treats bare flag (value="true") as true', () => {
      expect(parseBool({ foo: 'true' }, 'foo')).toBe(true);
    });

    it('accepts string variants', () => {
      const truthy: CliParams[] = [
        { foo: 'true' }, { foo: '1' }, { foo: 'yes' }, { foo: 'on' }, { foo: '' },
      ];
      for (const p of truthy) expect(parseBool(p, 'foo')).toBe(true);
      const falsy: CliParams[] = [
        { foo: 'false' }, { foo: '0' }, { foo: 'no' }, { foo: 'off' },
      ];
      for (const p of falsy) expect(parseBool(p, 'foo')).toBe(false);
    });

    it('throws on garbage values', () => {
      expect(() => parseBool({ foo: 'maybe' }, 'foo')).toThrow(CliValidationError);
    });
  });

  describe('parseEnum', () => {
    const VALUES = ['json', 'text'] as const;
    it('returns undefined when missing and not required', () => {
      expect(parseEnum({}, 'format', VALUES)).toBeUndefined();
    });

    it('returns default when supplied', () => {
      expect(parseEnum({}, 'format', VALUES, { default: 'json' })).toBe('json');
    });

    it('throws on invalid values', () => {
      expect(() => parseEnum({ format: 'yaml' }, 'format', VALUES)).toThrow(CliValidationError);
    });

    it('throws when required and missing', () => {
      expect(() => parseEnum({}, 'format', VALUES, { required: true })).toThrow(CliValidationError);
    });

    it('returns valid value', () => {
      expect(parseEnum({ format: 'text' }, 'format', VALUES)).toBe('text');
    });
  });

  describe('parseNumber', () => {
    it('returns default when missing', () => {
      expect(parseNumber({}, 'limit', { default: 5 })).toBe(5);
    });

    it('parses numeric strings', () => {
      expect(parseNumber({ limit: '10' }, 'limit')).toBe(10);
    });

    it('enforces min/max', () => {
      expect(() => parseNumber({ limit: '0' }, 'limit', { min: 1 })).toThrow(CliValidationError);
      expect(() => parseNumber({ limit: '99' }, 'limit', { max: 10 })).toThrow(CliValidationError);
    });

    it('enforces integer', () => {
      expect(() => parseNumber({ limit: '1.5' }, 'limit', { integer: true })).toThrow(CliValidationError);
    });

    it('rejects non-numeric', () => {
      expect(() => parseNumber({ limit: 'lots' }, 'limit')).toThrow(CliValidationError);
    });
  });

  describe('parseCsv', () => {
    it('returns empty array when missing or bare', () => {
      expect(parseCsv({}, 'tags')).toEqual([]);
      expect(parseCsv({ tags: 'true' }, 'tags')).toEqual([]);
    });

    it('trims whitespace and drops empty entries', () => {
      expect(parseCsv({ tags: 'a, b ,, c' }, 'tags')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('parseString', () => {
    it('returns default when missing', () => {
      expect(parseString({}, 'name', { default: 'fallback' })).toBe('fallback');
    });

    it('throws when required is missing', () => {
      try {
        parseString({}, 'name', { required: true });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CliValidationError);
        expect((e as CliValidationError).field).toBe('name');
        expect((e as CliValidationError).code).toBe('INVALID_ARGUMENT');
      }
    });

    it('rejects bare flags by default', () => {
      expect(() => parseString({ name: 'true' }, 'name')).toThrow(CliValidationError);
    });

    it('enforces maxLength', () => {
      expect(() => parseString({ name: 'abcdef' }, 'name', { maxLength: 3 })).toThrow(
        CliValidationError,
      );
    });
  });

  describe('parseVaultPath', () => {
    const fakeApp = {
      vault: {
        getAbstractFileByPath: (p: string) => (p === 'notes/foo.md' ? { path: p } : null),
      },
    } as unknown as Parameters<typeof parseVaultPath>[2];

    it('normalizes separators', () => {
      expect(parseVaultPath({ path: 'a\\b' }, 'path', fakeApp)).toBe('a/b');
    });

    it('rejects parent traversal', () => {
      expect(() => parseVaultPath({ path: '../escape' }, 'path', fakeApp)).toThrow(
        CliValidationError,
      );
      expect(() => parseVaultPath({ path: 'a/../b' }, 'path', fakeApp)).toThrow(
        CliValidationError,
      );
    });

    it('rejects absolute paths', () => {
      expect(() => parseVaultPath({ path: '/etc/passwd' }, 'path', fakeApp)).toThrow(
        CliValidationError,
      );
    });

    it('enforces mustExist', () => {
      expect(() =>
        parseVaultPath({ path: 'missing.md' }, 'path', fakeApp, { mustExist: true }),
      ).toThrow(CliValidationError);
      expect(parseVaultPath({ path: 'notes/foo.md' }, 'path', fakeApp, { mustExist: true })).toBe(
        'notes/foo.md',
      );
    });
  });

  describe('parseAbsolutePath', () => {
    it('accepts unix absolute paths', () => {
      expect(parseAbsolutePath({ file: '/tmp/export.zip' }, 'file')).toBe('/tmp/export.zip');
    });

    it('accepts windows absolute paths', () => {
      expect(parseAbsolutePath({ file: 'C:\\tmp\\file.zip' }, 'file')).toBe('C:\\tmp\\file.zip');
    });

    it('rejects relative paths', () => {
      expect(() => parseAbsolutePath({ file: 'tmp/x.zip' }, 'file')).toThrow(CliValidationError);
    });
  });

  describe('helpers', () => {
    it('normalizeVaultPath collapses slashes', () => {
      expect(normalizeVaultPath('a//b///c')).toBe('a/b/c');
      expect(normalizeVaultPath('a/b/')).toBe('a/b');
    });

    it('containsTraversal detects ..', () => {
      expect(containsTraversal('a/../b')).toBe(true);
      expect(containsTraversal('a/b/..')).toBe(true);
      expect(containsTraversal('a/b')).toBe(false);
    });
  });
});
