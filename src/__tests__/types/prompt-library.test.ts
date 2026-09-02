import { describe, expect, it } from 'vitest';
import { parsePromptLibraryResponse } from '@/types/prompt-library';

const savedPrompt = {
  id: 'p-1',
  name: 'Fact check',
  prompt: 'Check every claim against primary sources.',
  isDefault: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('parsePromptLibraryResponse', () => {
  it('parses a valid envelope (extra envelope fields tolerated)', () => {
    const result = parsePromptLibraryResponse({
      success: true,
      prompts: [savedPrompt],
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(result).toEqual([savedPrompt]);
  });

  it('returns null for a failed or malformed envelope', () => {
    expect(parsePromptLibraryResponse({ success: false, prompts: [] })).toBeNull();
    expect(parsePromptLibraryResponse({ success: true, prompts: [{ id: 'x' }] })).toBeNull();
    expect(parsePromptLibraryResponse(null)).toBeNull();
  });
});
