import { describe, expect, it, vi } from 'vitest';
import { PostChatSession, chatErrorMessage, type PostChatSessionDeps } from '../../../services/byok/PostChatSession';
import {
  AI_COMMENT_TRUNCATED_NOTE,
  CHAT_HISTORY_BUDGET_CHARS,
  CHAT_MAX_USER_TURNS,
  ByokError,
  WEB_ACCESS_REQUEST,
  utf8ByteLength,
  type ByokArticleInput,
} from '../../../vendor/byok-ai-core';
import { byokFixture, openaiModels, readyOpenAI, type ScriptedAnswer } from './byokTestKit';

const ARTICLE: ByokArticleInput = { title: 'Kubernetes at ten', authorName: 'Ada', platform: 'x', body: 'Kubernetes schedules containers.' };

/** The Responses API stream as server-sent events (the transport hands it over whole). */
export function openaiStream(deltas: string[], model = 'gpt-6-luna-2026-10-01', annotations: unknown[] = []): ScriptedAnswer {
  const text = deltas.join('');
  const frames = [
    ...deltas.map((delta) => ({ type: 'response.output_text.delta', delta })),
    {
      type: 'response.completed',
      response: { status: 'completed', model, output: [{ type: 'message', content: [{ type: 'output_text', text, annotations }] }], usage: {} },
    },
  ];
  return { status: 200, text: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') };
}

async function byokSession(answers: string[][]) {
  let call = 0;
  const fixture = byokFixture({
    answer: (req) => (req.method === 'GET' ? openaiModels('gpt-6-luna') : openaiStream(answers[call++] ?? ['…'])),
  });
  await readyOpenAI(fixture);
  const session = new PostChatSession({ byok: () => fixture.service, cloud: () => null, article: () => ARTICLE, archiveId: null });
  session.setEngine({ kind: 'byok', provider: 'openai' });
  return { fixture, session };
}

function cloudSession(askChatAI: NonNullable<ReturnType<PostChatSessionDeps['cloud']>>['askChatAI']) {
  const session = new PostChatSession({
    byok: () => null,
    cloud: () => ({ askChatAI }),
    article: () => ARTICLE,
    archiveId: 'archive-1',
    outputLanguage: 'ko',
  });
  session.setEngine({ kind: 'cloud' });
  return session;
}

describe('PostChatSession with the user\'s own key', () => {
  it('streams the answer, grounds it in the post and locks the engine', async () => {
    const { fixture, session } = await byokSession([['It ', 'schedules ', 'containers.']]);
    const partials: string[] = [];
    const answer = await session.ask('What does it do?', { onText: (partial) => partials.push(partial) });

    expect(answer).toEqual({ text: 'It schedules containers.', model: 'gpt-6-luna', executedModel: 'gpt-6-luna-2026-10-01' });
    expect(partials).toEqual(['', 'It ', 'It schedules ', 'It schedules containers.']);
    const request = fixture.transport.calls.find((req) => req.method === 'POST');
    expect(request?.stream).toBe(true);
    const body = JSON.parse(request?.body ?? '{}') as { instructions: string; input: unknown[] };
    expect(body.instructions).toContain('<<<ARTICLE\nKubernetes schedules containers.\nARTICLE>>>');
    expect(body.input).toEqual([{ role: 'user', content: 'What does it do?' }]);

    expect(session.messages).toHaveLength(2);
    expect(session.locked).toBe(true);
    expect(session.setEngine({ kind: 'cloud' })).toBe(false);
    expect(session.engine).toEqual({ kind: 'byok', provider: 'openai' });

    session.reset();
    expect(session.locked).toBe(false);
    expect(session.setEngine({ kind: 'cloud' })).toBe(true);
  });

  it('sends the history with the next question', async () => {
    const { fixture, session } = await byokSession([['First.'], ['Second.']]);
    await session.ask('One?');
    await session.ask('Two?');
    const last = fixture.transport.calls.filter((req) => req.method === 'POST').at(-1);
    expect(JSON.parse(last?.body ?? '{}').input).toEqual([
      { role: 'user', content: 'One?' },
      { role: 'assistant', content: 'First.' },
      { role: 'user', content: 'Two?' },
    ]);
  });

  it('records nothing when the provider fails', async () => {
    const fixture = byokFixture({
      answer: (req) => (req.method === 'GET' ? openaiModels('gpt-6-luna') : { status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'Slow down' } } }),
    });
    await readyOpenAI(fixture);
    const session = new PostChatSession({ byok: () => fixture.service, cloud: () => null, article: () => ARTICLE, archiveId: null });
    session.setEngine({ kind: 'byok', provider: 'openai' });
    await expect(session.ask('Why?')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(session.messages).toHaveLength(0);
    expect(session.locked).toBe(false);
  });
});

describe('PostChatSession web access', () => {
  type Fixture = ReturnType<typeof byokFixture>;
  type RequestBody = { tools?: unknown; input: { role: string; content: string }[] };
  const posts = (fixture: Fixture): RequestBody[] =>
    fixture.transport.calls.filter((req) => req.method === 'POST').map((req) => JSON.parse(req.body ?? '{}') as RequestBody);
  const openaiSession = (fixture: Fixture): PostChatSession => {
    const deps: PostChatSessionDeps = { byok: () => fixture.service, cloud: () => null, article: () => ARTICLE, archiveId: null };
    const session = new PostChatSession(deps);
    session.setEngine({ kind: 'byok', provider: 'openai' });
    return session;
  };

  it('searches only for the question it was turned on for, and lists the sources it used', async () => {
    let call = 0;
    const fixture = byokFixture({
      answer: (req) => {
        if (req.method === 'GET') return openaiModels('gpt-6-luna');
        return call++ === 0
          ? openaiStream(['Released in 2014.'], undefined, [{ type: 'url_citation', url: 'https://example.org/k8s', title: 'Kubernetes history' }])
          : openaiStream(['Containers.']);
      },
    });
    await readyOpenAI(fixture);
    const session = openaiSession(fixture);

    session.setWeb(true);
    expect(session.web).toBe(true);
    await session.send('When was it released?');
    expect(session.web).toBe(false);
    await session.send('What does it run?');

    const [withWeb, withoutWeb] = posts(fixture);
    expect(withWeb?.tools).toEqual([{ type: 'web_search' }]);
    expect(withWeb?.input.at(-1)?.content).toBe(`When was it released?\n\n${WEB_ACCESS_REQUEST}`);
    expect(withoutWeb).not.toHaveProperty('tools');
    expect(withoutWeb?.input.at(-1)?.content).toBe('What does it run?');
    // The history keeps the question as asked; the answer keeps its sources.
    expect(withoutWeb?.input[0]?.content).toBe('When was it released?');
    expect(session.messages[1]?.content).toBe('Released in 2014.\n\n#### Sources\n- [Kubernetes history](https://example.org/k8s)');
  });

  it('gives the web choice back with a question that failed or was stopped', async () => {
    const fixture = byokFixture({
      answer: (req) => (req.method === 'GET' ? openaiModels('gpt-6-luna') : { status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'Slow down' } } }),
    });
    await readyOpenAI(fixture);
    const session = openaiSession(fixture);
    session.setWeb(true);
    await session.send('Why?');
    expect(session.error).not.toBe('');
    expect(session.input).toBe('Why?');
    expect(session.web).toBe(true);

    const turn = session.send('Why?');
    expect(session.web).toBe(false);
    session.stop();
    expect(session.input).toBe('Why?');
    expect(session.web).toBe(true);
    await turn;
    expect(session.messages).toEqual([]);
  });

  it('never searches on Cloud AI: choosing it turns web access off', async () => {
    const askChatAI = vi.fn(async () => ({ text: 'Answer.', provider: 'workers-ai' as const, model: 'm' }));
    const deps: PostChatSessionDeps = { byok: () => null, cloud: () => ({ askChatAI }), article: () => ARTICLE, archiveId: 'archive-1' };
    const session = new PostChatSession(deps);
    session.setEngine({ kind: 'byok', provider: 'openai' });
    session.setWeb(true);
    session.setEngine({ kind: 'cloud' });
    expect(session.web).toBe(false);
    await session.send('Why?');
    expect(askChatAI).toHaveBeenCalledWith({ archiveId: 'archive-1', history: [], question: 'Why?' });
  });
});

describe('PostChatSession on Cloud AI', () => {
  it('asks with the archive id, the recent history and the output language', async () => {
    const askChatAI = vi.fn(async () => ({ text: ' Answer. ', provider: 'workers-ai' as const, model: '@cf/zai-org/glm-4.7-flash' }));
    const session = cloudSession(askChatAI);
    // An old turn past the server's history budget is left out of the request.
    askChatAI.mockResolvedValueOnce({ text: 'b'.repeat(CHAT_HISTORY_BUDGET_CHARS), provider: 'workers-ai', model: 'm' });
    await session.ask('First?');
    await session.ask('Second?');
    await session.ask('Third?');

    expect(askChatAI).toHaveBeenLastCalledWith({
      archiveId: 'archive-1',
      history: [
        { role: 'user', content: 'Second?' },
        { role: 'assistant', content: 'Answer.' },
      ],
      question: 'Third?',
      outputLanguage: 'ko',
    });
    expect(session.messages.at(-1)).toEqual({ role: 'assistant', content: 'Answer.' });
  });

  it('drops an answer that arrives after Stop', async () => {
    let answer!: (value: { text: string; provider: 'workers-ai'; model: string }) => void;
    const session = cloudSession(() => new Promise((resolve) => (answer = resolve)));
    const abort = new AbortController();
    const pending = session.ask('Why?', { signal: abort.signal });
    abort.abort();
    answer({ text: 'Late.', provider: 'workers-ai', model: 'm' });
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(session.messages).toHaveLength(0);
  });

  it('stops at the turn limit', async () => {
    const session = cloudSession(async () => ({ text: 'Ok.', provider: 'workers-ai', model: 'm' }));
    for (let i = 0; i < CHAT_MAX_USER_TURNS; i++) await session.ask(`Q${i}?`);
    expect(session.atTurnLimit).toBe(true);
    await expect(session.ask('One more?')).rejects.toThrow();
  });
});

describe('PostChatSession save payload', () => {
  it('builds a chat comment within the budget, oldest turns dropped first', async () => {
    const session = cloudSession(async () => ({ text: '답변 '.repeat(300), provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash' }));
    for (let i = 0; i < 5; i++) await session.ask(`질문 ${i}?`);

    const roomy = session.buildComment({ maxChars: 40_000, maxJsonBytes: 600_000 });
    expect(roomy?.droppedTurns).toBe(0);
    expect(roomy?.meta).toMatchObject({ cli: 'workers-ai', type: 'chat', model: '@cf/zai-org/glm-4.7-flash' });
    expect(roomy?.meta.executedModel).toBeUndefined();
    expect(roomy?.meta.id.startsWith('workers-ai-chat-')).toBe(true);
    expect(roomy?.content.startsWith('> [!question] 질문 0?')).toBe(true);

    const tight = { maxChars: 40_000, maxJsonBytes: 4_000 };
    const fitted = session.buildComment(tight);
    expect(fitted).not.toBeNull();
    expect(fitted!.droppedTurns).toBeGreaterThan(0);
    expect(utf8ByteLength(JSON.stringify(fitted!.content))).toBeLessThanOrEqual(tight.maxJsonBytes);
    expect(fitted!.content).toContain('질문 4?');
    expect(fitted!.content).not.toContain('질문 0?');

    const tiny = session.buildComment({ maxChars: 600, maxJsonBytes: 600_000 });
    expect(tiny!.content.length).toBeLessThanOrEqual(600);
    expect(tiny!.content.endsWith(AI_COMMENT_TRUNCATED_NOTE)).toBe(true);
  });

  it('records the provider key and both models for a BYOK chat, and demotes headings', async () => {
    const { session } = await byokSession([['# Big\n\nAnswer.']]);
    await session.ask('Why?');
    const comment = session.buildComment({ maxChars: 40_000, maxJsonBytes: 600_000 });
    expect(comment?.meta).toMatchObject({ cli: 'openai-api', model: 'gpt-6-luna', executedModel: 'gpt-6-luna-2026-10-01', type: 'chat' });
    expect(comment?.content).toBe('> [!question] Why?\n\n#### Big\n\nAnswer.');
  });

  it('has nothing to save before an answer', () => {
    const session = cloudSession(async () => ({ text: 'x', provider: 'workers-ai', model: 'm' }));
    expect(session.buildComment({ maxChars: 40_000, maxJsonBytes: 600_000 })).toBeNull();
  });
});

type CloudAnswer = { text: string; provider: 'workers-ai'; model: string };

/** A Cloud AI answer the test hands over when it chooses. */
function heldCloudAnswer(): { askChatAI: () => Promise<CloudAnswer>; answer: (text: string) => void } {
  let answer!: (value: CloudAnswer) => void;
  const askChatAI = vi.fn(() => new Promise<CloudAnswer>((resolve) => (answer = resolve)));
  return { askChatAI, answer: (text) => answer({ text, provider: 'workers-ai', model: 'm' }) };
}

const SAVED_CHAT = { id: 'workers-ai-chat-saved', content: '> [!question] First?\n\nSaved answer.' };

describe('PostChatSession as the post\'s chat', () => {
  it('owns the question in flight: its answer lands after the last listener left', async () => {
    const held = heldCloudAnswer();
    const session = cloudSession(held.askChatAI);
    const heard: string[] = [];
    const unsubscribe = session.subscribe(() => heard.push(session.pending ? `pending:${session.pending.question}` : `turns:${session.messages.length}`));

    session.setInput('Why?');
    const turn = session.send(session.input);
    expect(session.pending).toMatchObject({ question: 'Why?', partial: '' });
    expect(session.input).toBe('');
    unsubscribe(); // the chat UI closed

    held.answer('Because.');
    await turn;
    expect(session.pending).toBeNull();
    expect(session.messages).toEqual([{ role: 'user', content: 'Why?' }, { role: 'assistant', content: 'Because.' }]);
    expect(session.hasUnsaved).toBe(true);
    expect(session.locked).toBe(true);
    expect(heard).toEqual(['turns:0', 'pending:Why?']);
  });

  it('stops a turn: the question goes back to the box and a late answer is dropped', async () => {
    const held = heldCloudAnswer();
    const session = cloudSession(held.askChatAI);
    const turn = session.send('Why?');
    session.stop();
    expect(session.pending).toBeNull();
    expect(session.input).toBe('Why?');

    held.answer('Late.');
    await turn;
    expect(session.messages).toEqual([]);
    expect(session.error).toBe('');
  });

  it('keeps why a question failed, with the question back in the box', async () => {
    const session = cloudSession(async () => {
      throw Object.assign(new Error('slow'), { code: 'CHAT_AI_RATE_LIMITED', status: 429 });
    });
    await session.send('Why?');
    expect(session.error).toBe('Too many Cloud AI questions. Try again in a minute.');
    expect(session.input).toBe('Why?');
    expect(session.locked).toBe(false);
  });

  it('continues a saved chat: its turns are history, already saved, and leave the engine free', async () => {
    const askChatAI = vi.fn(async () => ({ text: 'More.', provider: 'workers-ai' as const, model: 'm' }));
    const session = cloudSession(askChatAI);
    session.seed(Promise.resolve(SAVED_CHAT));
    await vi.waitFor(() => expect(session.messages).toHaveLength(2));
    expect(session.savedCommentId).toBe(SAVED_CHAT.id);
    expect(session.hasUnsaved).toBe(false);
    expect(session.locked).toBe(false);
    expect(session.setEngine({ kind: 'cloud' })).toBe(true);

    await session.send('Second?');
    expect(askChatAI).toHaveBeenCalledWith(expect.objectContaining({
      history: [{ role: 'user', content: 'First?' }, { role: 'assistant', content: 'Saved answer.' }],
      question: 'Second?',
    }));
    expect(session.hasUnsaved).toBe(true);

    session.markSaved('workers-ai-chat-new', session.messages);
    expect(session.savedCommentId).toBe('workers-ai-chat-new');
    expect(session.hasUnsaved).toBe(false);
  });

  it('marks saved only the turns the saved comment holds', async () => {
    const session = cloudSession(async () => ({ text: 'Ok.', provider: 'workers-ai', model: 'm' }));
    await session.send('One?');
    const inComment = session.messages;
    await session.send('Two?'); // landed while the save was on its way
    session.markSaved('workers-ai-chat-1', inComment);
    expect(session.savedCommentId).toBe('workers-ai-chat-1');
    expect(session.hasUnsaved).toBe(true);

    const beforeNewChat = session.messages;
    session.reset(); // New chat while saving: the save must not claim the new chat
    session.markSaved('workers-ai-chat-2', beforeNewChat);
    expect(session.savedCommentId).toBeNull();
  });

  it('waits for the saved chat when asked before it is read', async () => {
    let read!: (chat: typeof SAVED_CHAT) => void;
    const askChatAI = vi.fn(async () => ({ text: 'More.', provider: 'workers-ai' as const, model: 'm' }));
    const session = cloudSession(askChatAI);
    session.seed(new Promise((resolve) => (read = resolve)));
    const turn = session.send('Second?');
    await Promise.resolve();
    expect(askChatAI).not.toHaveBeenCalled();
    read(SAVED_CHAT);
    await turn;
    expect(session.messages.map((message) => message.content)).toEqual(['First?', 'Saved answer.', 'Second?', 'More.']);
  });

  it('starts over on New chat, and a saved chat read before it does not land after it', async () => {
    let read!: (chat: typeof SAVED_CHAT) => void;
    const session = cloudSession(async () => ({ text: 'Ok.', provider: 'workers-ai', model: 'm' }));
    session.seed(new Promise((resolve) => (read = resolve)));
    session.reset();
    read(SAVED_CHAT);
    await session.send('Fresh?');
    expect(session.messages.map((message) => message.content)).toEqual(['Fresh?', 'Ok.']);
    expect(session.savedCommentId).toBeNull();

    session.reset();
    expect(session.messages).toEqual([]);
    expect(session.locked).toBe(false);
    expect(session.hasUnsaved).toBe(false);
  });
});

describe('chatErrorMessage', () => {
  const cloud = { kind: 'cloud' } as const;
  const coded = (code: string, status?: number) => Object.assign(new Error(code), { code, status });

  it('maps Cloud AI codes to their sentences', () => {
    expect(chatErrorMessage(coded('SERVER_AI_CONSENT_REQUIRED', 409), cloud)).toMatch(/Cloud AI is off for this account/);
    expect(chatErrorMessage(coded('SERVER_AI_LOCAL_ONLY', 409), cloud)).toMatch(/away from Cloud AI/);
    expect(chatErrorMessage(coded('PAYWALL_REQUIRED', 402), cloud)).toMatch(/Not enough Cloud AI credits/);
    expect(chatErrorMessage(coded('USD_BUDGET_EXCEEDED', 402), cloud)).toMatch(/Not enough Cloud AI credits/);
    expect(chatErrorMessage(coded('CHAT_AI_RATE_LIMITED', 429), cloud)).toMatch(/Try again in a minute/);
    expect(chatErrorMessage(coded('UNSUPPORTED_ARCHIVE', 400), cloud)).toMatch(/too little text/);
    expect(chatErrorMessage(new Error('net::ERR_INTERNET_DISCONNECTED'), cloud)).toMatch(/Cloud AI could not answer/);
  });

  it('names the provider for key errors', () => {
    const error = new ByokError('invalid_key', 'bad', { provider: 'anthropic', status: 401 });
    expect(chatErrorMessage(error, { kind: 'byok', provider: 'anthropic' })).toBe(
      'Anthropic rejected the key. Check it in Social Archiver settings.',
    );
  });
});
