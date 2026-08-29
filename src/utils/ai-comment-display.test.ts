import { describe, expect, it } from 'vitest';
import { formatAIModelLabel, getAICommentDisplay } from './ai-comment-display';

describe('formatAIModelLabel', () => {
  it('formats new-style claude ids (name-major-minor-date)', () => {
    expect(formatAIModelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(formatAIModelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1');
    expect(formatAIModelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4');
    expect(formatAIModelLabel('claude-fable-5')).toBe('Fable 5');
  });

  it('formats old-style claude ids (major-minor-name-date)', () => {
    expect(formatAIModelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
  });

  it('capitalizes bare aliases', () => {
    expect(formatAIModelLabel('sonnet')).toBe('Sonnet');
    expect(formatAIModelLabel('opus')).toBe('Opus');
  });

  it('falls back to generic formatting for non-claude ids', () => {
    expect(formatAIModelLabel('gpt-5.4-mini')).toBe('GPT 5.4 Mini');
    expect(formatAIModelLabel('gemini-2.5-flash')).toBe('Gemini 2.5 Flash');
  });

  it('returns empty for missing input', () => {
    expect(formatAIModelLabel(undefined)).toBe('');
    expect(formatAIModelLabel('  ')).toBe('');
  });
});

describe('getAICommentDisplay model preference', () => {
  it('prefers the executed model over the requested alias', () => {
    const display = getAICommentDisplay({
      id: 'claude-summary-1',
      cli: 'claude',
      model: 'sonnet',
      executedModel: 'claude-sonnet-4-5-20250929',
    });
    expect(display.providerLabel).toBe('Claude');
    expect(display.modelLabel).toBe('Sonnet 4.5');
    // headerLabel stays provider-only: it feeds the markdown header round-trip.
    expect(display.headerLabel).toBe('Claude');
  });

  it('falls back to the requested alias when no executed model is known', () => {
    const display = getAICommentDisplay({ id: 'claude-summary-2', cli: 'claude', model: 'opus' });
    expect(display.modelLabel).toBe('Opus');
  });

  it('shows no model label when nothing was recorded', () => {
    const display = getAICommentDisplay({ id: 'claude-summary-3', cli: 'claude' });
    expect(display.modelLabel).toBe('');
  });
});
