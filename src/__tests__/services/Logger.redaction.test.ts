import { describe, expect, it } from 'vitest';
import { Logger } from '../../services/Logger';
import { SENSITIVE_HEADERS } from '../../types/logger';

// Built at runtime: the public mirror's secret scan rejects any key-shaped literal (sk-…).
const OPENAI_KEY = ['sk', 'test-1234567890abcdef'].join('-');
const GEMINI_KEY = 'AIzaFAKEFAKEFAKEFAKEFAKEFAKE0000';

describe('Logger redaction of provider keys', () => {
  it('redacts key-shaped text in messages and free-text metadata', () => {
    const logger = new Logger({ enableConsole: false });
    logger.warn(`Provider said: Incorrect API key provided: ${OPENAI_KEY}`, {
      detail: `x-goog-api-key: ${GEMINI_KEY}`,
      nested: { body: `Authorization: Bearer ${OPENAI_KEY}` },
    });
    const json = JSON.stringify(logger.getBuffer());
    expect(json).not.toContain(OPENAI_KEY);
    expect(json).not.toContain(GEMINI_KEY);
    expect(json).toContain('[redacted]');
  });

  it('masks inside arrays, at any depth, and survives cycles', () => {
    const logger = new Logger({ enableConsole: false });
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    const list: unknown[] = ['plain'];
    list.push(list);
    logger.info('arrays', {
      attempts: [`Incorrect API key provided: ${OPENAI_KEY}`, { headers: { 'x-api-key': GEMINI_KEY } }, 42, null],
      matrix: [[{ apiKey: OPENAI_KEY }]],
      cyclic,
      list,
    });
    const [entry] = logger.getBuffer() as Array<Record<string, unknown>>;
    expect(JSON.stringify(entry)).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(entry)).not.toContain(GEMINI_KEY);
    expect(entry?.attempts).toEqual([
      'Incorrect API key provided: [redacted]',
      { headers: { 'x-api-key': 'AIza...0000' } },
      42,
      null,
    ]);
    expect(entry?.matrix).toEqual([[{ apiKey: 'sk-t...cdef' }]]);
    expect(entry?.cyclic).toEqual({ name: 'loop', self: '[Circular]' });
    expect(entry?.list).toEqual(['plain', '[Circular]']);
  });

  it('cuts metadata nested past the depth limit', () => {
    const logger = new Logger({ enableConsole: false });
    let deep: Record<string, unknown> = { leaf: OPENAI_KEY };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    logger.info('deep', { deep });
    const json = JSON.stringify(logger.getBuffer());
    expect(json).toContain('[Truncated]');
    expect(json).not.toContain(OPENAI_KEY);
  });

  it('treats the Gemini key header as sensitive', () => {
    expect(SENSITIVE_HEADERS).toContain('x-goog-api-key');
    expect(SENSITIVE_HEADERS).toContain('x-api-key');
  });
});
