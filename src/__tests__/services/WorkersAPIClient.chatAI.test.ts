import { afterEach, describe, expect, it } from 'vitest';
import { __setRequestUrlHandler, type RequestUrlParam } from 'obsidian';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';

function client(): WorkersAPIClient {
  const api = new WorkersAPIClient({ endpoint: 'https://api.test.com', authToken: 'test-token', pluginVersion: '4.11.0' });
  api.initialize();
  return api;
}

function respond(status: number, json: unknown): RequestUrlParam[] {
  const captured: RequestUrlParam[] = [];
  __setRequestUrlHandler(async (params) => {
    captured.push(params);
    return { status, headers: {}, json, text: JSON.stringify(json), arrayBuffer: new ArrayBuffer(0) };
  });
  return captured;
}

describe('WorkersAPIClient Cloud AI chat', () => {
  afterEach(() => __setRequestUrlHandler(null));

  it('asks with the conversation only and returns the answer', async () => {
    const captured = respond(200, {
      success: true,
      data: { text: 'It argues X.', provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash' },
    });
    const answer = await client().askChatAI({
      archiveId: 'archive-1',
      history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
      question: 'What does it argue?',
      outputLanguage: 'auto',
    });
    expect(answer).toEqual({ text: 'It argues X.', provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash' });
    expect(captured[0]?.url).toBe('https://api.test.com/api/ai-actions/chat/ask');
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.headers?.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(captured[0]?.body ?? '{}')).toEqual({
      archiveId: 'archive-1',
      history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
      question: 'What does it argue?',
      outputLanguage: 'auto',
    });
  });

  it('throws the server code for the modal to map', async () => {
    respond(409, { success: false, error: { code: 'SERVER_AI_CONSENT_REQUIRED', message: 'Cloud AI consent is required' } });
    await expect(client().askChatAI({ archiveId: 'archive-1', question: 'Why?' })).rejects.toMatchObject({
      code: 'SERVER_AI_CONSENT_REQUIRED',
      status: 409,
    });

    respond(429, { success: false, error: { code: 'CHAT_AI_RATE_LIMITED', message: 'Too many chat questions' } });
    await expect(client().askChatAI({ archiveId: 'archive-1', question: 'Why?' })).rejects.toMatchObject({
      code: 'CHAT_AI_RATE_LIMITED',
    });
  });

  it('reads Cloud AI availability', async () => {
    const captured = respond(200, { success: true, data: { cloud: { available: false, consentRequired: true, credits: 0.5 } } });
    await expect(client().getChatAIAvailability()).resolves.toEqual({
      cloud: { available: false, consentRequired: true, credits: 0.5 },
    });
    expect(captured[0]?.url).toBe('https://api.test.com/api/ai-actions/chat/availability');
    expect(captured[0]?.method).toBe('GET');
  });
});
