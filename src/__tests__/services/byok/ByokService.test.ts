import { describe, expect, it } from 'vitest';
import { ByokError } from '../../../vendor/byok-ai-core';
import { normalizeByokSettings } from '../../../types/byok-settings';
import { FAKE_OPENAI_KEY, byokFixture, openaiAnswer, openaiModels, readyOpenAI } from './byokTestKit';

const LIVE = openaiModels('gpt-6-luna', 'gpt-5.4-mini', 'text-embedding-3-small');

function openaiRoutes(generate: () => ReturnType<typeof openaiAnswer> | { status: number; json: unknown }) {
  return (req: { method: string; url: string }) =>
    req.method === 'GET' && req.url === 'https://api.openai.com/v1/models' ? LIVE : generate();
}

describe('ByokService consent', () => {
  it('turns a provider on only after consent, asked once per device', async () => {
    const fixture = byokFixture({ answer: () => LIVE, consent: false });
    expect(await fixture.service.setEnabled('openai', true)).toBe(false);
    expect(fixture.holder.settings.byok.providers.openai.enabled).toBe(false);
    expect(fixture.requestConsent).toHaveBeenCalledWith('openai');

    fixture.requestConsent.mockResolvedValue(true);
    expect(await fixture.service.setEnabled('openai', true)).toBe(true);
    expect(fixture.holder.settings.byok.providers.openai.enabled).toBe(true);
    expect(await fixture.service.hasConsent('openai')).toBe(true);

    fixture.requestConsent.mockClear();
    await fixture.service.setEnabled('openai', false);
    await fixture.service.setEnabled('openai', true);
    expect(fixture.requestConsent).not.toHaveBeenCalled();
  });

  it('shows one consent sheet for concurrent first runs, none for executors', async () => {
    const fixture = byokFixture({ answer: () => LIVE });
    const [a, b] = await Promise.all([
      fixture.service.ensureConsent('gemini', { interactive: true }),
      fixture.service.ensureConsent('gemini', { interactive: true }),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(fixture.requestConsent).toHaveBeenCalledTimes(1);

    expect(await fixture.service.ensureConsent('anthropic', { interactive: false })).toBe(false);
    expect(fixture.requestConsent).toHaveBeenCalledTimes(1);
  });

  it('refuses an executor run without consent here, before any request', async () => {
    const fixture = byokFixture({
      answer: () => LIVE,
      // Enabled through synced settings from another device: no consent on this one.
      settings: { byok: normalizeByokSettings({ providers: { openai: { enabled: true } } }) },
    });
    fixture.app.secretStorage.setSecret('social-archiver-openai', FAKE_OPENAI_KEY);
    const run = fixture.service.run({ provider: 'openai', task: 'comment', interactive: false, run: async () => 'never' });
    await expect(run).rejects.toMatchObject({ code: 'invalid_key' });
    expect(fixture.transport.calls).toHaveLength(0);
    expect(fixture.requestConsent).not.toHaveBeenCalled();
  });
});

describe('ByokService runs', () => {
  it('moves the user off a retired model, saves the replacement and says so once', async () => {
    const fixture = byokFixture({ answer: openaiRoutes(() => openaiAnswer('A summary.')) });
    await readyOpenAI(fixture);
    await fixture.service.setModel('openai', 'o4-mini');

    const generate = (): ReturnType<typeof fixture.service.run<string>> =>
      fixture.service.run({
        provider: 'openai',
        task: 'comment',
        run: async (client, model) =>
          (await client.generate({ model, system: 's', messages: [{ role: 'user', content: 'q' }], maxOutputTokens: 100 })).text,
      });

    const first = await generate();
    expect(first.value).toBe('A summary.');
    expect(first.model).toBe('gpt-6-luna');
    expect(first.replaced).toMatchObject({ from: 'o4-mini', reason: 'retired' });
    expect(fixture.holder.settings.byok.providers.openai.model).toBe('gpt-6-luna');
    expect(fixture.notify).toHaveBeenCalledTimes(1);
    expect(fixture.notify.mock.calls[0]?.[0]).toBe('o4-mini was retired by OpenAI; now using gpt-6-luna.');
    const sent = fixture.transport.calls.find((req) => req.method === 'POST');
    expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({ model: 'gpt-6-luna' });

    await generate();
    expect(fixture.notify).toHaveBeenCalledTimes(1);
  });

  it('leaves the setting alone when only a catalog pick moved on', async () => {
    let calls = 0;
    const fixture = byokFixture({
      answer: openaiRoutes(() =>
        ++calls === 1
          ? { status: 404, json: { error: { code: 'model_not_found', message: 'The model gpt-6-luna does not exist' } } }
          : openaiAnswer('Recovered.', 'gpt-5.4-mini'),
      ),
    });
    await readyOpenAI(fixture);
    const result = await fixture.service.run({
      provider: 'openai',
      task: 'comment',
      run: async (client, model) =>
        (await client.generate({ model, system: 's', messages: [{ role: 'user', content: 'q' }], maxOutputTokens: 100 })).text,
    });
    expect(result.recoveredFrom).toBe('gpt-6-luna');
    expect(result.model).toBe('gpt-5.4-mini');
    expect(fixture.holder.settings.byok.providers.openai.model).toBeUndefined();
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  it('runs the model a job asked for without touching the user\'s own choice', async () => {
    const fixture = byokFixture({ answer: openaiRoutes(() => openaiAnswer('Done.', 'gpt-5.4-mini')) });
    await readyOpenAI(fixture);
    await fixture.service.setModel('openai', 'gpt-6-luna');
    const generate = (preferred: string) =>
      fixture.service.run({
        provider: 'openai',
        task: 'comment',
        interactive: false,
        preferred,
        run: async (client, model) =>
          (await client.generate({ model, system: 's', messages: [{ role: 'user', content: 'q' }], maxOutputTokens: 100 })).text,
      });

    expect((await generate('gpt-5.4-mini')).model).toBe('gpt-5.4-mini');
    // A retired model from an old picker: resolved on the executor, still no settings change or notice.
    const replaced = await generate('o4-mini');
    expect(replaced.replaced?.from).toBe('o4-mini');
    expect(fixture.holder.settings.byok.providers.openai.model).toBe('gpt-6-luna');
    expect(fixture.notify).not.toHaveBeenCalled();
  });

  it('records a key the provider rejected, so the executor stops advertising it as signed in', async () => {
    const fixture = byokFixture({
      answer: openaiRoutes(() => ({ status: 401, json: { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } } })),
    });
    await readyOpenAI(fixture);
    const run = fixture.service.run({
      provider: 'openai',
      task: 'chat',
      run: (client, model) => client.generate({ model, system: 's', messages: [{ role: 'user', content: 'q' }], maxOutputTokens: 10 }),
    });
    await expect(run).rejects.toBeInstanceOf(ByokError);
    expect(await fixture.service.getValidation('openai')).toMatchObject({ ok: false, code: 'invalid_key' });
    expect(fixture.onChange).toHaveBeenCalled();
    const [capability] = await fixture.service.buildProviderCapabilities();
    expect(capability).toMatchObject({ id: 'openai-api', available: true, authenticated: false });
  });

  it('marks the key good again once a run gets an answer', async () => {
    let rejected = true;
    const fixture = byokFixture({
      answer: openaiRoutes(() =>
        rejected ? { status: 401, json: { error: { message: 'Incorrect API key provided' } } } : openaiAnswer('Fine.'),
      ),
    });
    await readyOpenAI(fixture);
    const ask = () =>
      fixture.service.run({
        provider: 'openai',
        task: 'chat',
        run: (client, model) => client.generate({ model, system: 's', messages: [{ role: 'user', content: 'q' }], maxOutputTokens: 10 }),
      });
    await expect(ask()).rejects.toMatchObject({ code: 'invalid_key' });
    rejected = false;
    await ask();
    expect(await fixture.service.getValidation('openai')).toMatchObject({ ok: true });
  });
});

describe('ByokService web search support', () => {
  const claudeModel = (id: string, name: string, webSearch: boolean): Record<string, unknown> => ({
    id,
    display_name: name,
    capabilities: { server_tools: { web_search: { supported: webSearch } } },
  });

  it('names the model a task would use when the provider says it cannot search the web', async () => {
    const fixture = byokFixture({
      answer: () => ({
        status: 200,
        json: {
          data: [claudeModel('claude-haiku-5-5', 'Claude Haiku 5.5', false), claudeModel('claude-sonnet-5-5', 'Claude Sonnet 5.5', true)],
          has_more: false,
        },
      }),
    });
    fixture.app.secretStorage.setSecret('social-archiver-anthropic', 'sk-ant-test-1234567890');
    await fixture.service.setEnabled('anthropic', true);

    expect(await fixture.service.modelWithoutWebSearch('anthropic', 'chat')).toBe('Claude Haiku 5.5');
    expect(await fixture.service.modelWithoutWebSearch('anthropic', 'research')).toBeNull();
  });

  it('says nothing when the provider does not report it', async () => {
    const fixture = byokFixture({ answer: () => LIVE });
    await readyOpenAI(fixture);
    expect(await fixture.service.modelWithoutWebSearch('openai', 'comment')).toBeNull();
  });
});

describe('ByokService keys and capability', () => {
  it('validates the stored key and caches its model list', async () => {
    const fixture = byokFixture({ answer: () => LIVE });
    expect(await fixture.service.validate('openai')).toBeNull();
    fixture.app.secretStorage.setSecret('social-archiver-openai', FAKE_OPENAI_KEY);
    const state = await fixture.service.validate('openai');
    expect(state).toMatchObject({ ok: true });
    expect(fixture.transport.calls[0]?.headers.Authorization).toBe(`Bearer ${FAKE_OPENAI_KEY}`);
    const callsAfterValidate = fixture.transport.calls.length;
    expect((await fixture.service.listModels('openai')).map((model) => model.id)).toEqual(['gpt-6-luna', 'gpt-5.4-mini']);
    expect(fixture.transport.calls.length).toBe(callsAfterValidate);
  });

  it('advertises ready providers with models and types, never the key', async () => {
    const fixture = byokFixture({ answer: () => LIVE });
    expect(await fixture.service.buildProviderCapabilities()).toEqual([]);
    await readyOpenAI(fixture);
    const capabilities = await fixture.service.buildProviderCapabilities();
    expect(capabilities).toHaveLength(1);
    const [openai] = capabilities;
    expect(openai).toMatchObject({ id: 'openai-api', available: true, authenticated: true, defaultModel: 'gpt-6-luna' });
    expect(openai?.supportedTypes).toContain('research');
    expect(openai?.supportedTypes).not.toContain('connections');
    expect(openai?.supportedTypes).not.toContain('chat');
    expect(openai?.models?.find((model) => model.id === 'gpt-6-luna')?.recommended).toBe(true);
    const json = JSON.stringify(capabilities);
    expect(json).not.toContain(FAKE_OPENAI_KEY);
    expect(json).not.toContain('…cdef');
  });

  it('saves a pasted key under its own secret, links it and checks it', async () => {
    const fixture = byokFixture({ answer: () => LIVE });
    fixture.app.secretStorage.setSecret('shared-openai', ['sk', 'test-shared-0000000000'].join('-'));
    await fixture.service.setSecretName('openai', 'shared-openai');

    const state = await fixture.service.saveKey('openai', FAKE_OPENAI_KEY);
    expect(state).toMatchObject({ ok: true });
    expect(fixture.holder.settings.byok.providers.openai.secretName).toBe('social-archiver-openai');
    expect(fixture.app.secretStorage.getSecret('shared-openai')).toBe(['sk', 'test-shared-0000000000'].join('-'));
    expect(fixture.service.fingerprint('openai')).toBe('…cdef');
    expect(fixture.service.savedSecretNames()).toEqual(['shared-openai', 'social-archiver-openai']);
    expect(JSON.stringify(fixture.holder.settings)).not.toContain(FAKE_OPENAI_KEY);
  });

  it('removes our own secret, unlinks a shared one, and keeps keys out of settings', async () => {
    const fixture = byokFixture({ answer: () => LIVE });
    await readyOpenAI(fixture);
    await fixture.service.validate('openai');
    await fixture.service.clearKey('openai');
    expect(fixture.app.secretStorage.getSecret('social-archiver-openai')).toBe('');
    expect(fixture.service.hasKey('openai')).toBe(false);
    expect(await fixture.service.getValidation('openai')).toBeNull();

    fixture.app.secretStorage.setSecret('shared-openai', FAKE_OPENAI_KEY);
    await fixture.service.setSecretName('openai', 'shared-openai');
    expect(fixture.service.fingerprint('openai')).toBe('…cdef');
    await fixture.service.clearKey('openai');
    expect(fixture.app.secretStorage.getSecret('shared-openai')).toBe(FAKE_OPENAI_KEY);
    expect(fixture.holder.settings.byok.providers.openai.secretName).toBe('');

    // data.json round trip: only names, switches and models.
    expect(JSON.stringify(fixture.holder.settings)).not.toContain(FAKE_OPENAI_KEY);
  });
});
