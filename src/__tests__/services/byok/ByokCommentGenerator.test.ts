import { afterEach, describe, expect, it, vi } from 'vitest';
import { AICommentService } from '../../../services/AICommentService';
import { setByokService } from '../../../services/byok/ByokService';
import { AICommentError } from '../../../types/ai-comment';
import { AICliDetector } from '../../../utils/ai-cli';
import {
  ByokError,
  COMMENT_SYSTEM_INSTRUCTIONS,
  RESEARCH_SYSTEM_INSTRUCTIONS,
  WEB_ACCESS_REQUEST,
  type ByokGenerateRequest,
} from '../../../vendor/byok-ai-core';
import { FAKE_OPENAI_KEY, byokFixture, openaiAnswer, openaiModels, readyOpenAI } from './byokTestKit';

const LIVE = openaiModels('gpt-6-luna', 'gpt-6.1-terra');
const POST = 'Kubernetes schedules containers across a cluster of machines. It was released by Google in 2014.';

function postBodies(fixture: ReturnType<typeof byokFixture>): Record<string, unknown>[] {
  return fixture.transport.calls
    .filter((req) => req.method === 'POST')
    .map((req) => JSON.parse(req.body ?? '{}') as Record<string, unknown>);
}

describe('AI comments with the user\'s own key', () => {
  afterEach(() => {
    setByokService(null);
    vi.restoreAllMocks();
  });

  it('runs a summary through the provider with the CLI prompt and records provider and models', async () => {
    const detect = vi.spyOn(AICliDetector, 'detect');
    const fixture = byokFixture({
      answer: (req) => (req.method === 'GET' ? LIVE : openaiAnswer('## Summary\n\nKubernetes runs containers.')),
    });
    await readyOpenAI(fixture);
    setByokService(fixture.service);

    const result = await new AICommentService().generateComment(POST, { cli: 'openai-api', type: 'summary' });

    expect(detect).not.toHaveBeenCalled();
    const [body] = postBodies(fixture);
    expect(body).toMatchObject({ model: 'gpt-6-luna', instructions: COMMENT_SYSTEM_INSTRUCTIONS, store: false });
    expect(body).not.toHaveProperty('tools');
    expect(JSON.stringify(body?.input)).toContain('Kubernetes schedules containers');
    expect(result.content).toBe('Kubernetes runs containers.');
    expect(result.meta).toMatchObject({
      cli: 'openai-api',
      type: 'summary',
      model: 'gpt-6-luna',
      executedModel: 'gpt-6-luna-2026-10-01',
    });
    expect(result.meta.id.startsWith('openai-api-summary-')).toBe(true);
  });

  it('turns web search on for fact checks only', async () => {
    const fixture = byokFixture({ answer: (req) => (req.method === 'GET' ? LIVE : openaiAnswer('Checked.')) });
    await readyOpenAI(fixture);
    setByokService(fixture.service);
    await new AICommentService().generateComment(POST, { cli: 'openai-api', type: 'factcheck' });
    await new AICommentService().generateComment(POST, { cli: 'openai-api', type: 'glossary' });
    const [factcheck, glossary] = postBodies(fixture);
    expect(factcheck?.tools).toEqual([{ type: 'web_search' }]);
    expect(glossary).not.toHaveProperty('tools');
  });

  it('searches the web for a custom comment only when the user asked, and lists its sources', async () => {
    const fixture = byokFixture({
      answer: (req) =>
        req.method === 'GET'
          ? LIVE
          : openaiAnswer('Released in 2014.', 'gpt-6-luna-2026-10-01', [
              { type: 'url_citation', url: 'https://example.org/k8s', title: 'Kubernetes history' },
            ]),
    });
    await readyOpenAI(fixture);
    setByokService(fixture.service);
    const custom = { cli: 'openai-api', type: 'custom', customPrompt: 'Check the release year' } as const;

    const withWeb = await new AICommentService().generateComment(POST, { ...custom, web: true });
    const plain = await new AICommentService().generateComment(POST, custom);
    // Other types never take it: a glossary stays offline, a fact check searches anyway.
    await new AICommentService().generateComment(POST, { cli: 'openai-api', type: 'glossary', web: true });

    const [webBody, plainBody, glossaryBody] = postBodies(fixture) as { tools?: unknown; input?: { content: string }[] }[];
    expect(webBody?.tools).toEqual([{ type: 'web_search' }]);
    expect(webBody?.input?.at(-1)?.content).toMatch(/^Check the release year\n\nContent:\nKubernetes/);
    expect(webBody?.input?.at(-1)?.content.endsWith(`\n\n${WEB_ACCESS_REQUEST}`)).toBe(true);
    expect(withWeb.content).toBe('Released in 2014.\n\n#### Sources\n- [Kubernetes history](https://example.org/k8s)');
    expect(withWeb.meta).toMatchObject({ type: 'custom', customPrompt: 'Check the release year' });

    expect(plainBody).not.toHaveProperty('tools');
    expect(plainBody?.input?.at(-1)?.content).not.toContain(WEB_ACCESS_REQUEST);
    expect(plain.content).toBe('Released in 2014.');
    expect(glossaryBody).not.toHaveProperty('tools');
    expect(glossaryBody?.input?.at(-1)?.content).not.toContain(WEB_ACCESS_REQUEST);
  });

  it('researches with the shared prompt and stores a report without ###-level headings', async () => {
    const fixture = byokFixture({
      answer: (req) =>
        req.method === 'GET'
          ? LIVE
          : openaiAnswer('## Summary\nClaims.\n### Claim check\nSupported.', 'gpt-6.1-terra', [
              { type: 'url_citation', url: 'https://example.org/source', title: 'Source' },
            ]),
    });
    await readyOpenAI(fixture);
    setByokService(fixture.service);

    const result = await new AICommentService().generateComment(POST, {
      cli: 'openai-api',
      type: 'research',
      customPrompt: 'the release year',
      researchContext: { title: 'Kubernetes', authorName: 'Ada', platform: 'web' },
    });

    const [body] = postBodies(fixture);
    expect(body?.model).toBe('gpt-6.1-terra');
    expect(body?.tools).toEqual([{ type: 'web_search' }]);
    expect(String(body?.instructions)).toContain(RESEARCH_SYSTEM_INSTRUCTIONS);
    expect(String(body?.instructions)).toContain('Kubernetes schedules containers');
    expect(JSON.stringify(body?.input)).toContain('the release year');
    expect(result.content).not.toMatch(/^#{1,3} /m);
    expect(result.content).toContain('#### Summary');
    expect(result.content).toContain('[Source](https://example.org/source)');
    expect(result.meta).toMatchObject({ cli: 'openai-api', type: 'research', executedModel: 'gpt-6.1-terra' });
  });

  it('reports a rejected key as a localized error carrying the provider code, never the key', async () => {
    const fixture = byokFixture({
      answer: (req) =>
        req.method === 'GET'
          ? LIVE
          : { status: 401, json: { error: { message: `Incorrect API key provided: ${FAKE_OPENAI_KEY}`, code: 'invalid_api_key' } } },
    });
    await readyOpenAI(fixture);
    setByokService(fixture.service);

    const error = await new AICommentService()
      .generateComment(POST, { cli: 'openai-api', type: 'summary' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AICommentError);
    expect(error).toMatchObject({ code: 'CLI_NOT_AUTHENTICATED', byokCode: 'invalid_key' });
    expect((error as AICommentError).userMessage).toBe('OpenAI rejected the key. Check it in Social Archiver settings.');
    expect(JSON.stringify(error)).not.toContain(FAKE_OPENAI_KEY);
    expect((error as Error).message).not.toContain(FAKE_OPENAI_KEY);
  });

  it('stops on cancel() and on its deadline', async () => {
    let release: () => void = () => undefined;
    const fixture = byokFixture({ answer: () => LIVE });
    await readyOpenAI(fixture);
    setByokService(fixture.service);
    // Hold each run open until released; the fake client honours the abort like the real one.
    const client = {
      generate: async (req: ByokGenerateRequest) => {
        if (req.signal?.aborted) throw new ByokError('cancelled', 'The OpenAI request was cancelled.', { provider: 'openai' });
        return { text: 'late', model: 'gpt-6-luna', usage: {}, citations: [], finishReason: 'stop' as const };
      },
    };
    vi.spyOn(fixture.service, 'run').mockImplementation(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { value: await input.run(client as never, 'gpt-6-luna'), model: 'gpt-6-luna' } as never;
    });

    const service = new AICommentService();
    const cancelled = service.generateComment(POST, { cli: 'openai-api', type: 'summary' });
    await Promise.resolve();
    expect(service.isRunning()).toBe(true);
    service.cancel();
    release();
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED', byokCode: 'cancelled' });
    expect(service.isRunning()).toBe(false);

    const timedOut = new AICommentService().generateComment(POST, { cli: 'openai-api', type: 'summary', timeoutMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    release();
    await expect(timedOut).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('explains when BYOK is unavailable', async () => {
    await expect(new AICommentService().generateComment(POST, { cli: 'gemini-api', type: 'summary' })).rejects.toMatchObject({
      code: 'CLI_NOT_INSTALLED',
      userMessage: expect.stringContaining('1.11.4'),
    });
  });
});
