import { describe, it, expect } from 'vitest';
import {
  CliValidationError,
  containsTraversal,
  normalizeWorkspacePath,
  parseAbsolutePath,
  parseBool,
  parseCsv,
  parseEnum,
  parseNumber,
  parseString,
  parseWorkspacePath,
} from '../src/core/params';

describe('parseBool', () => {
  it('treats a bare flag and truthy strings as true', () => {
    expect(parseBool({ x: 'true' }, 'x')).toBe(true);
    expect(parseBool({ x: '' }, 'x')).toBe(true);
    expect(parseBool({ x: 'yes' }, 'x')).toBe(true);
    expect(parseBool({ x: 'no' }, 'x')).toBe(false);
  });
  it('returns the default when missing', () => {
    expect(parseBool({}, 'x')).toBe(false);
    expect(parseBool({}, 'x', true)).toBe(true);
  });
  it('throws on garbage', () => {
    expect(() => parseBool({ x: 'maybe' }, 'x')).toThrow(CliValidationError);
  });
});

describe('parseEnum', () => {
  const vals = ['a', 'b', 'c'] as const;
  it('returns default when missing or bare', () => {
    expect(parseEnum({}, 'k', vals, { default: 'a' })).toBe('a');
    expect(parseEnum({ k: 'true' }, 'k', vals, { default: 'b' })).toBe('b');
  });
  it('throws on invalid value', () => {
    expect(() => parseEnum({ k: 'z' }, 'k', vals)).toThrow(CliValidationError);
  });
  it('throws when required and missing', () => {
    expect(() => parseEnum({}, 'k', vals, { required: true })).toThrow(CliValidationError);
  });
});

describe('parseNumber', () => {
  it('parses + enforces bounds and integer', () => {
    expect(parseNumber({ n: '20' }, 'n', { default: 5 })).toBe(20);
    expect(parseNumber({}, 'n', { default: 5 })).toBe(5);
    expect(() => parseNumber({ n: '1.5' }, 'n', { integer: true })).toThrow(CliValidationError);
    expect(() => parseNumber({ n: '0' }, 'n', { min: 1 })).toThrow(CliValidationError);
    expect(() => parseNumber({ n: '999' }, 'n', { max: 200 })).toThrow(CliValidationError);
    expect(() => parseNumber({ n: 'abc' }, 'n')).toThrow(CliValidationError);
  });
});

describe('parseCsv + parseString', () => {
  it('splits + trims csv, dropping empties', () => {
    expect(parseCsv({ tags: 'a, b ,,c' }, 'tags')).toEqual(['a', 'b', 'c']);
    expect(parseCsv({}, 'tags')).toEqual([]);
  });
  it('requires a value and rejects bare flag by default', () => {
    expect(() => parseString({}, 's', { required: true })).toThrow(CliValidationError);
    expect(() => parseString({ s: 'true' }, 's')).toThrow(CliValidationError);
    expect(parseString({ s: 'true' }, 's', { allowBareFlag: true })).toBe('true');
    expect(parseString({ s: 'hi' }, 's')).toBe('hi');
  });
});

describe('path parsing', () => {
  it('normalizes + detects traversal', () => {
    expect(normalizeWorkspacePath('a\\\\b//c/')).toBe('a/b/c');
    expect(containsTraversal('a/../b')).toBe(true);
    expect(containsTraversal('a/b')).toBe(false);
  });
  it('rejects absolute + traversal workspace paths', () => {
    expect(() => parseWorkspacePath({ p: '/abs' }, 'p', { required: true })).toThrow(CliValidationError);
    expect(() => parseWorkspacePath({ p: 'a/../b' }, 'p', { required: true })).toThrow(CliValidationError);
  });
  it('accepts a clean workspace path', () => {
    expect(parseWorkspacePath({ p: 'Notes/x.md' }, 'p', { required: true })).toBe('Notes/x.md');
  });
  it('enforces mustExist against the resolver', () => {
    const resolver = { exists: (p: string) => p === 'Notes/x.md' };
    expect(parseWorkspacePath({ p: 'Notes/x.md' }, 'p', { required: true, mustExist: true }, resolver)).toBe('Notes/x.md');
    expect(() => parseWorkspacePath({ p: 'Notes/missing.md' }, 'p', { required: true, mustExist: true }, resolver)).toThrow(
      CliValidationError,
    );
  });
  it('requires absolute paths for parseAbsolutePath', () => {
    expect(parseAbsolutePath({ p: '/tmp/a.zip' }, 'p')).toBe('/tmp/a.zip');
    expect(() => parseAbsolutePath({ p: 'rel/a.zip' }, 'p')).toThrow(CliValidationError);
  });
});
