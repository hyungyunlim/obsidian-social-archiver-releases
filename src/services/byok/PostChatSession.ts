/**
 * One conversation about one archived post, on the user's own key (streamed)
 * or Cloud AI. The session owns its question in flight (send/stop), so an
 * answer lands here even after the chat UI closed; views follow it with
 * subscribe(). The first answer fixes the engine until reset(). A chat saved
 * to the note can seed it (seed): those turns count as saved, and saving
 * again replaces that comment. Builds the `chat` AI comment the conversation
 * is saved as. A question searches the web only when the user turned that on
 * for it (own key only; setWeb). No DOM: views render, this decides.
 */
import {
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MAX_QUESTION_CHARS,
  CHAT_MAX_USER_TURNS,
  ByokError,
  buildArticleContext,
  buildChatMessages,
  fitChatTranscript,
  noteReplySuffix,
  parseChatTranscript,
  toStoredProviderId,
  withSourceLinks,
  type AICommentBudget,
  type ByokArticleInput,
  type ByokMessage,
  type ByokProviderId,
} from '../../vendor/byok-ai-core';
import {
  createContentHash,
  generateCommentId,
  type AICommentMeta,
  type AICommentProviderId,
} from '../../types/ai-comment';
import type { StoredAIComment } from '../ai-comment/AICommentSaver';
import type { WorkersAPIClient } from '../WorkersAPIClient';
import type { ByokService } from './ByokService';
import { byokErrorMessage } from './byokText';
import { t } from '../../i18n';

export type ChatEngine = { kind: 'byok'; provider: ByokProviderId } | { kind: 'cloud' };

export interface ChatAnswer {
  text: string;
  /** The model asked (BYOK: resolved for this run; Cloud AI: the one that answered). */
  model: string;
  /** BYOK: the id the provider reports, which may differ from `model`. */
  executedModel?: string;
}

export interface PostChatSessionDeps {
  byok: () => ByokService | null;
  cloud: () => Pick<WorkersAPIClient, 'askChatAI'> | null;
  /** The post as a BYOK model reads it. Cloud AI reads the archive on the server instead. */
  article: () => ByokArticleInput;
  /** Server archive id; Cloud AI needs one. */
  archiveId: string | null;
  /** 'auto' | ISO code; 'auto' answers in the question's language. */
  outputLanguage?: string;
  now?: () => number;
}

/** A question on its way, with what has streamed of its answer. */
export interface ChatTurn {
  readonly question: string;
  readonly partial: string;
}

interface AskOptions {
  signal?: AbortSignal;
  onText?: (partial: string) => void;
  /** Own key only: the user turned web access on for this question. */
  web?: boolean;
}

export class PostChatSession {
  private history: ByokMessage[] = [];
  private current: ChatEngine | null = null;
  private fixed = false;
  private last: Omit<ChatAnswer, 'text'> | null = null;
  private answerMs = 0;
  private article: ByokArticleInput | null = null;
  private context: string | null = null;
  private turn: { question: string; partial: string; web: boolean; abort: AbortController } | null = null;
  private draft = '';
  /** Web access for the next question (the user's own key only); it travels with the question. */
  private webNext = false;
  private failure = '';
  private savedId: string | null = null;
  private savedCount = 0;
  /** The note's saved chat being read; a question waits for it. */
  private seeding: Promise<void> | null = null;
  /** Bumped by reset(): a seed read before it does not land after it. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private deps: PostChatSessionDeps) {}

  get messages(): readonly ByokMessage[] {
    return this.history;
  }

  get engine(): ChatEngine | null {
    return this.current;
  }

  /** An answer in this session fixes the engine until reset(); turns seeded from the note do not. */
  get locked(): boolean {
    return this.fixed;
  }

  get atTurnLimit(): boolean {
    return this.history.filter((message) => message.role === 'user').length >= CHAT_MAX_USER_TURNS;
  }

  /** The question on its way, or null. */
  get pending(): ChatTurn | null {
    return this.turn;
  }

  /** The question box, kept while the chat UI is closed. */
  get input(): string {
    return this.draft;
  }

  /**
   * The user turned web access on for the next question (own key only). It
   * goes off once that question is sent, and comes back with the question
   * when it fails or is stopped.
   */
  get web(): boolean {
    return this.webNext;
  }

  /** Why the last question failed; '' when it did not. */
  get error(): string {
    return this.failure;
  }

  /** The saved chat this conversation continues: saving replaces it. */
  get savedCommentId(): string | null {
    return this.savedId;
  }

  /** Turns the note does not have yet. */
  get hasUnsaved(): boolean {
    return this.history.length > this.savedCount;
  }

  /** `listener` runs after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A reopened chat asks with what its opener knows now (archive id, language). */
  updateDeps(deps: PostChatSessionDeps): void {
    this.deps = deps;
  }

  setInput(text: string): void {
    if (text === this.draft) return;
    this.draft = text;
    this.emit();
  }

  setWeb(on: boolean): void {
    if (on === this.webNext) return;
    this.webNext = on;
    this.emit();
  }

  /** False once an answer fixed the engine, or while a question is on its way. Cloud AI never searches. */
  setEngine(engine: ChatEngine): boolean {
    if (this.fixed || this.turn) return false;
    this.current = engine;
    if (engine.kind === 'cloud') this.webNext = false;
    this.emit();
    return true;
  }

  /**
   * Continues the note's saved chat: its turns become the history, counted as
   * saved, and saving replaces it. A question asked meanwhile waits for it.
   */
  seed(saved: Promise<StoredAIComment | null>): void {
    const generation = this.generation;
    const seeding: Promise<void> = saved
      .then(
        (chat) => {
          if (!chat || generation !== this.generation || this.history.length > 0) return;
          const messages = parseChatTranscript(chat.content);
          if (messages.length === 0) return;
          this.history = messages;
          this.savedCount = messages.length;
          this.savedId = chat.id;
          this.emit();
        },
        // An unreadable note starts the chat empty.
        () => undefined,
      )
      .finally(() => {
        if (this.seeding === seeding) this.seeding = null;
      });
    this.seeding = seeding;
  }

  /**
   * Asks `question` as this session's turn. It starts at once (`pending` is
   * set when this returns) and keeps going after the chat UI closes: the
   * answer lands in the history, or the error does, with the question back
   * in the box.
   */
  async send(question: string): Promise<void> {
    const text = question.trim();
    if (!text || this.turn || !this.current || this.atTurnLimit) return;
    const turn = { question: text, partial: '', web: this.webNext && this.current.kind === 'byok', abort: new AbortController() };
    this.turn = turn;
    this.draft = '';
    this.webNext = false;
    this.failure = '';
    this.emit();
    try {
      await this.ask(text, {
        signal: turn.abort.signal,
        web: turn.web,
        onText: (partial) => {
          if (this.turn !== turn) return;
          turn.partial = partial;
          this.emit();
        },
      });
    } catch (error) {
      if (this.turn !== turn) return; // stopped, or a new chat began
      this.failure = chatErrorMessage(error, this.current);
      this.giveBack(turn);
    } finally {
      if (this.turn === turn) {
        this.turn = null;
        this.emit();
      }
    }
  }

  /** Stops the answer in flight (a late Cloud AI answer is dropped); the question goes back to the box. */
  stop(): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    turn.abort.abort();
    this.giveBack(turn);
    this.emit();
  }

  /** "New chat": this conversation ends (a saved one stays in the note); a question on its way is stopped. */
  reset(): void {
    const turn = this.turn;
    this.turn = null;
    turn?.abort.abort();
    if (turn) this.giveBack(turn);
    this.generation++;
    this.seeding = null;
    this.history = [];
    this.fixed = false;
    this.last = null;
    this.answerMs = 0;
    this.failure = '';
    this.savedId = null;
    this.savedCount = 0;
    this.emit();
  }

  /**
   * `saved` (the messages the comment was built from) is in the note as
   * `commentId`: saving again replaces it. A turn that landed meanwhile stays
   * unsaved; after a New chat meanwhile, nothing changes.
   */
  markSaved(commentId: string, saved: readonly ByokMessage[]): void {
    if (saved.some((message, index) => this.history[index] !== message)) return;
    this.savedId = commentId;
    this.savedCount = saved.length;
    this.emit();
  }

  /**
   * One question. The turn is recorded only when an answer arrives and the
   * signal was not aborted (a late Cloud AI answer is dropped). `onText`
   * sees a BYOK answer as it streams, from scratch on the one model retry.
   */
  async ask(question: string, options: AskOptions = {}): Promise<ChatAnswer> {
    // A saved chat this continues is history before the first question.
    if (this.seeding) {
      await this.seeding;
      if (options.signal?.aborted) throw new ByokError('cancelled', 'The answer was stopped.');
    }
    const engine = this.current;
    const text = question.trim();
    if (!engine) throw new Error('Choose an engine first.');
    if (!text || text.length > CHAT_MAX_QUESTION_CHARS || this.atTurnLimit) throw new Error('This question cannot be sent.');
    const history = [...this.history];
    const startedAt = this.now();
    const answer = engine.kind === 'byok'
      ? await this.askByok(engine.provider, history, text, options)
      : await this.askCloud(history, text);
    if (options.signal?.aborted) throw new ByokError('cancelled', 'The answer was stopped.');
    this.history = [...history, { role: 'user', content: text }, { role: 'assistant', content: answer.text }];
    this.fixed = true;
    this.last = { model: answer.model, ...(answer.executedModel ? { executedModel: answer.executedModel } : {}) };
    this.answerMs += this.now() - startedAt;
    return answer;
  }

  /**
   * The conversation as a `chat` comment that fits `budget` (oldest turns
   * dropped first), or null with nothing to save or no room.
   */
  buildComment(budget: AICommentBudget): { meta: AICommentMeta; content: string; droppedTurns: number } | null {
    const engine = this.current;
    if (!engine || !this.last || this.history.length === 0) return null;
    const fitted = fitChatTranscript(this.history, budget);
    if (!fitted) return null;
    const cli: AICommentProviderId = engine.kind === 'byok' ? toStoredProviderId(engine.provider) : 'workers-ai';
    return {
      meta: {
        // A continued reply to a note keeps its link to the note.
        id: `${generateCommentId(cli, 'chat')}${noteReplySuffix(this.savedId)}`,
        cli,
        model: this.last.model,
        ...(this.last.executedModel ? { executedModel: this.last.executedModel } : {}),
        type: 'chat',
        generatedAt: new Date(this.now()).toISOString(),
        processingTime: this.answerMs,
        contentHash: createContentHash(this.articleInput().body),
      },
      content: fitted.content,
      droppedTurns: fitted.droppedTurns,
    };
  }

  private async askByok(provider: ByokProviderId, history: ByokMessage[], question: string, options: AskOptions): Promise<ChatAnswer> {
    const byok = this.deps.byok();
    if (!byok) throw new ByokError('invalid_key', 'Your own API keys are not available here.', { provider });
    this.context ??= buildArticleContext(this.articleInput());
    const web = options.web === true;
    const prompt = buildChatMessages({ context: this.context, history, question, outputLanguage: this.deps.outputLanguage, web });
    const result = await byok.run({
      provider,
      task: 'chat',
      run: (client, model) => {
        let partial = '';
        options.onText?.('');
        return client.generate(
          { model, ...prompt, maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS, stream: true, signal: options.signal, webSearch: web },
          {
            onDelta: (delta) => {
              partial += delta;
              options.onText?.(partial);
            },
          },
        );
      },
    });
    const text = web ? withSourceLinks(result.value.text, result.value.citations) : result.value.text;
    return { text, model: result.model, executedModel: result.value.model };
  }

  private async askCloud(history: ByokMessage[], question: string): Promise<ChatAnswer> {
    const api = this.deps.cloud();
    const archiveId = this.deps.archiveId;
    if (!api || !archiveId) throw Object.assign(new Error('Cloud AI is not available for this post.'), { code: 'ARCHIVE_NOT_FOUND' });
    // Only the history the server would keep (same trimming as its prompt builder).
    const recent = buildChatMessages({ context: '', history, question }).messages.slice(0, -1);
    const answer = await api.askChatAI({
      archiveId,
      history: recent,
      question,
      ...(this.deps.outputLanguage ? { outputLanguage: this.deps.outputLanguage } : {}),
    });
    if (typeof answer?.text !== 'string' || !answer.text.trim()) {
      throw Object.assign(new Error('Cloud AI returned an empty answer.'), { code: 'SERVER_AI_FAILED' });
    }
    return { text: answer.text.trim(), model: answer.model };
  }

  /** A question that got no answer goes back to the box with its web choice, unless something new was typed meanwhile. */
  private giveBack(turn: { question: string; web: boolean }): void {
    if (this.draft.trim()) return;
    this.draft = turn.question;
    this.webNext ||= turn.web;
  }

  private articleInput(): ByokArticleInput {
    this.article ??= this.deps.article();
    return this.article;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** One sentence for a failed question: provider errors by code, Cloud AI errors by server code. */
export function chatErrorMessage(error: unknown, engine: ChatEngine | null): string {
  if (error instanceof ByokError || engine?.kind === 'byok') {
    return byokErrorMessage(error, engine?.kind === 'byok' ? engine.provider : undefined);
  }
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  if (status === 402) return t('byok.cloud.credits');
  switch (code) {
    case 'SERVER_AI_CONSENT_REQUIRED':
      return t('byok.cloud.consentRequired');
    case 'SERVER_AI_LOCAL_ONLY':
      return t('byok.cloud.localOnly');
    case 'PAYWALL_REQUIRED':
    case 'INSUFFICIENT_CREDITS':
      return t('byok.cloud.credits');
    case 'CHAT_AI_RATE_LIMITED':
      return t('byok.cloud.rateLimited');
    case 'UNSUPPORTED_ARCHIVE':
      return t('byok.cloud.unsupported');
    case 'ARCHIVE_NOT_FOUND':
      return t('byok.cloud.notFound');
    default:
      return t('byok.cloud.failed');
  }
}
