import { afterEach, describe, expect, it } from 'vitest';
import { __setRequestUrlHandler, type RequestUrlParam } from 'obsidian';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';

function client(): WorkersAPIClient {
  const api = new WorkersAPIClient({ endpoint: 'https://api.test.com', authToken: 'test-token', pluginVersion: '4.11.0' });
  api.initialize();
  return api;
}

function capture(data: unknown): RequestUrlParam[] {
  const captured: RequestUrlParam[] = [];
  __setRequestUrlHandler(async (params) => {
    captured.push(params);
    return { status: 200, headers: {}, json: { success: true, data }, text: '', arrayBuffer: new ArrayBuffer(0) };
  });
  return captured;
}

describe('WorkersAPIClient capability tokens for BYOK', () => {
  afterEach(() => __setRequestUrlHandler(null));

  it('marks aiComments PATCHes as coming from a plugin that parses chat/research and lists BYOK providers', async () => {
    const captured = capture({ success: true });
    await client().updateArchiveActions('archive-1', {
      aiComments: [{
        meta: { id: 'openai-api-chat-1', cli: 'openai-api', type: 'chat', generatedAt: '2026-11-04T00:00:00.000Z' },
        content: '> [!question] Why?\n\nBecause.',
      }],
    });
    const capabilities = captured[0]?.headers?.['X-Client-Capabilities'] ?? '';
    expect(capabilities.split(',')).toEqual(expect.arrayContaining([
      'ai-comment-types-v2',
      'byok-providers-v1',
      'place-context-note-v1',
      'archive-note-ops-v1',
    ]));
  });

  it('claims and lists AI-action jobs as an executor that can research', async () => {
    const captured = capture({ jobs: [] });
    await client().getAvailableAIActionJobs('client-1');
    await client().claimAIActionJob('job-1', { clientId: 'client-1' });
    for (const request of captured) {
      expect(request.headers?.['X-Client-Capabilities']?.split(',')).toContain('comment-research-v1');
    }
    expect(captured).toHaveLength(2);
  });
});
