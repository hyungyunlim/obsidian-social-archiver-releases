import { describe, expect, it } from 'vitest';
import { getAICommentDisplay } from '../../utils/ai-comment-display';

describe('getAICommentDisplay', () => {
  it('shows a local provider even when the server minted an action-comment id', () => {
    // Action-path comments run by a desktop executor carry ai-action-comment-<job> ids.
    const apple = getAICommentDisplay({ id: 'ai-action-comment-42', cli: 'apple', model: 'system' });
    expect(apple).toMatchObject({ icon: '🍎', providerLabel: 'Apple Intelligence', modelLabel: 'On-device', headerLabel: 'Apple Intelligence' });

    const claude = getAICommentDisplay({ id: 'ai-action-comment-43', cli: 'claude', model: 'sonnet' });
    expect(claude).toMatchObject({ providerLabel: 'Claude', modelLabel: 'Sonnet', headerLabel: 'Claude' });
  });

  it('keeps Cloud AI rendering for server comments', () => {
    expect(getAICommentDisplay({ id: 'ai-action-comment-44', cli: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash' }))
      .toMatchObject({ icon: '☁️', providerLabel: 'GLM' });
    expect(getAICommentDisplay({ id: 'server-ai-1', cli: 'workers-ai' }))
      .toMatchObject({ icon: '☁️', providerLabel: 'Cloud AI', headerLabel: 'Cloud AI' });
    // A Cloudflare model id wins over a stale local provider tag.
    expect(getAICommentDisplay({ id: 'x', cli: 'claude', model: '@cf/meta/llama-3.3-70b' }).icon).toBe('☁️');
  });

  it('labels comments made with the user\'s own key by provider, even with an executor id', () => {
    expect(getAICommentDisplay({ id: 'openai-api-summary-1', cli: 'openai-api', model: 'gpt-6-luna', executedModel: 'gpt-6-luna-2026-10-01' }))
      .toEqual({ icon: '⚡', providerLabel: 'OpenAI API', modelLabel: 'GPT 6 Luna 2026 10 01', headerLabel: 'OpenAI API' });
    // An executor ran it with the desktop's key: still not Cloud AI.
    expect(getAICommentDisplay({ id: 'ai-action-comment-45', cli: 'anthropic-api', model: 'claude-haiku-5-5' }))
      .toMatchObject({ icon: '⚡', providerLabel: 'Anthropic API', modelLabel: 'Haiku 5.5' });
    expect(getAICommentDisplay({ id: 'x', cli: 'gemini-api' }).headerLabel).toBe('Gemini API');
    expect(getAICommentDisplay({ id: 'x', cli: 'openrouter-api', model: 'google/gemma-3' }).icon).toBe('⚡');
  });
});
