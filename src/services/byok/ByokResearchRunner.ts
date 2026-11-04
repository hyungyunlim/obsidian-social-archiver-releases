/**
 * Research a post and save the report as a `research` AI comment.
 *
 * Quick: one pass on an engine the plugin runs itself — a provider key (with
 * web search) or, on desktop, an installed CLI — through AICommentService's
 * `research` type. Deep (OpenAI, Gemini): a background job on the provider.
 * Its handle stays on this device (`byok.deepResearch.v1`, never data.json),
 * is polled every 15 s, resumed when the plugin loads and cancelled after an
 * hour; a failure offers "Run again", which resolves the model anew.
 */
import {
  ARTICLE_CONTEXT_MAX_CHARS,
  ByokError,
  RESEARCH_MAX_FOCUS_CHARS,
  buildArticleContext,
  buildResearchPrompt,
  byokErrorToJobErrorCode,
  excerptForBudget,
  fitTextToBudget,
  formatResearchReport,
  toStoredProviderId,
  BYOK_PROVIDERS,
  type ByokDeepResearchHandle,
  type ByokGenerateResult,
  type ByokKeyValueStore,
} from '../../vendor/byok-ai-core';
import {
  AICommentError,
  createContentHash,
  generateCommentId,
  type AICommentEngineId,
  type AICommentMeta,
  type AICommentOptions,
  type AICommentProgress,
  type AICommentResult,
  type AIOutputLanguage,
} from '../../types/ai-comment';
import type { AICommentTarget } from '../ai-comment/AICommentSaver';
import type { ByokService } from './ByokService';
import { buildPostArticleInput } from './postArticleInput';
import { byokErrorMessage } from './byokText';
import { t } from '../../i18n';

export const DEEP_RESEARCH_STORE_KEY = 'byok.deepResearch.v1';
export const DEEP_RESEARCH_POLL_MS = 15_000;
/** Gemini's own limit; OpenAI jobs past it are cancelled too. */
export const DEEP_RESEARCH_TIMEOUT_MS = 60 * 60_000;

export type DeepResearchProvider = ByokDeepResearchHandle['provider'];

export interface DeepResearchRecord {
  localId: string;
  /** The note the report is saved to; a renamed note is found by `archiveId`. */
  filePath: string;
  archiveId: string | null;
  handle: ByokDeepResearchHandle;
  /** The model asked for (the handle's is the one the provider reported). */
  model?: string;
  focus?: string;
  outputLanguage?: AIOutputLanguage;
  /** Epoch ms. */
  startedAt: number;
}

export interface ResearchNoticeAction {
  label: string;
  run: () => void;
}

export interface ByokResearchRunnerDeps {
  byok: () => ByokService | null;
  /** Device-local key-value store (Obsidian localStorage). */
  store: ByokKeyValueStore;
  /** A fresh AICommentService's generateComment: the CLI and provider-key `research` runs. */
  generateComment: (content: string, options: AICommentOptions) => Promise<AICommentResult>;
  /** The note a deep research saves to, or null when it is gone. */
  resolveTarget: (record: DeepResearchRecord) => Promise<AICommentTarget | null>;
  notify: (message: string, action?: ResearchNoticeAction) => void;
  schedule: (callback: () => void, ms: number) => number;
  clearSchedule: (id: number) => void;
  now?: () => number;
  newId?: () => string;
}

/** A research run that cannot start or save; the message is for the user. */
export class ResearchError extends Error {
  constructor(
    readonly code: 'no_room' | 'no_text' | 'deep_running' | 'no_note',
    message: string,
  ) {
    super(message);
    this.name = 'ResearchError';
  }
}

/** One sentence for a failed research run. */
export function researchErrorMessage(error: unknown): string {
  if (error instanceof AICommentError) return error.userMessage;
  return byokErrorMessage(error);
}

export class ByokResearchRunner {
  private readonly active = new Map<string, DeepResearchRecord>();
  private readonly timers = new Map<string, number>();
  private disposed = false;

  constructor(private readonly deps: ByokResearchRunnerDeps) {}

  /** Quick research on `engine`, saved to the note. Throws AICommentError, ByokError or ResearchError. */
  async runQuick(input: {
    target: AICommentTarget;
    engine: AICommentEngineId;
    focus?: string;
    outputLanguage?: AIOutputLanguage;
    signal?: AbortSignal;
    onProgress?: (progress: AICommentProgress) => void;
  }): Promise<void> {
    const { body, ...context } = buildPostArticleInput(input.target.post);
    // A post that is only a transcript (or image text) is researched from that.
    const full = body || [context.transcript, context.ocrText].filter(Boolean).join('\n\n');
    if (!full.trim()) throw new ResearchError('no_text', t('byok.research.noText'));
    // The prompt keeps ~24k chars anyway: never trip the comment service's length check on a long article.
    const content = excerptForBudget(full, ARTICLE_CONTEXT_MAX_CHARS * 3).text;
    const focus = clipFocus(input.focus);
    const result = await this.deps.generateComment(content, {
      cli: input.engine,
      type: 'research',
      ...(focus ? { customPrompt: focus } : {}),
      ...(input.outputLanguage ? { outputLanguage: input.outputLanguage } : {}),
      researchContext: body ? context : { ...context, transcript: undefined, ocrText: undefined },
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });
    if (input.signal?.aborted) throw new ByokError('cancelled', 'Research was cancelled.');
    if ((await this.saveReport(input.target, result.meta, result.content)) === 'no_room') {
      throw new ResearchError('no_room', t('byok.noRoom'));
    }
  }

  /** True while a deep research for this note is being polled. */
  isDeepRunning(filePath: string): boolean {
    return [...this.active.values()].some((record) => record.filePath === filePath);
  }

  /** Starts deep research on the provider and polls it until the report is saved. */
  async startDeep(input: {
    target: AICommentTarget;
    provider: DeepResearchProvider;
    archiveId?: string | null;
    focus?: string;
    outputLanguage?: AIOutputLanguage;
  }): Promise<void> {
    const filePath = input.target.post.filePath;
    if (!filePath) throw new ResearchError('no_note', t('byok.research.noteMissing'));
    if (this.isDeepRunning(filePath)) throw new ResearchError('deep_running', t('byok.research.deepRunning'));
    const byok = this.deps.byok();
    if (!byok) throw new ByokError('invalid_key', 'Your own API keys are not available here.', { provider: input.provider });
    const focus = clipFocus(input.focus);
    const prompt = buildResearchPrompt({
      context: buildArticleContext(buildPostArticleInput(input.target.post)),
      focus,
      outputLanguage: input.outputLanguage,
      depth: 'deep',
    });
    const { value: handle, model } = await byok.run({
      provider: input.provider,
      task: 'deepResearch',
      run: (client, model) =>
        client.startDeepResearch({
          model,
          system: prompt.system,
          context: prompt.context,
          prompt: prompt.messages.map((message) => message.content).join('\n\n'),
        }),
    });
    const record: DeepResearchRecord = {
      localId: this.newId(),
      filePath,
      archiveId: input.archiveId ?? input.target.post.sourceArchiveId ?? null,
      handle,
      model,
      ...(focus ? { focus } : {}),
      ...(input.outputLanguage ? { outputLanguage: input.outputLanguage } : {}),
      startedAt: this.now(),
    };
    this.active.set(record.localId, record);
    await this.updateStore((records) => [...records, record]);
    this.schedulePoll(record.localId, DEEP_RESEARCH_POLL_MS);
  }

  /** On plugin load: poll every deep research this device started. */
  async resume(): Promise<void> {
    for (const record of await this.readRecords()) {
      if (this.disposed || this.active.has(record.localId)) continue;
      this.active.set(record.localId, record);
      this.schedulePoll(record.localId, 0);
    }
  }

  /** Plugin unload: stop polling. Records stay for the next load. */
  dispose(): void {
    this.disposed = true;
    for (const id of this.timers.values()) this.deps.clearSchedule(id);
    this.timers.clear();
    this.active.clear();
  }

  private schedulePoll(localId: string, ms: number): void {
    if (this.disposed) return;
    const existing = this.timers.get(localId);
    if (existing !== undefined) this.deps.clearSchedule(existing);
    this.timers.set(localId, this.deps.schedule(() => void this.poll(localId), ms));
  }

  private async poll(localId: string): Promise<void> {
    this.timers.delete(localId);
    const record = this.active.get(localId);
    const byok = this.deps.byok();
    if (!record || !byok || this.disposed) return;
    const { provider } = record.handle;
    try {
      const state = await (await byok.engine.client(provider)).pollDeepResearch(record.handle);
      if (this.disposed) return;
      if (state.status === 'completed') return await this.complete(record, state.result);
      if (state.status === 'failed' || state.status === 'cancelled') {
        return await this.fail(record, t('byok.research.deepFailed', { note: noteName(record), reason: byokErrorMessage(state.error, provider) }));
      }
      // Still running past the limit. Only a known-running job is stopped: one
      // that finished while Obsidian was closed or offline is still collected.
      if (this.now() - record.startedAt >= DEEP_RESEARCH_TIMEOUT_MS) {
        try {
          await (await byok.engine.client(provider)).cancelDeepResearch(record.handle);
        } catch {
          // Best effort: the provider stops it on its own limit too.
        }
        return await this.fail(record, t('byok.research.deepTimedOut', { note: noteName(record) }));
      }
    } catch (error) {
      // A failed poll request is not a failed job: keep going while it may pass.
      const retryable = error instanceof ByokError && byokErrorToJobErrorCode(error.code).retryable;
      if (!retryable) {
        return await this.fail(record, t('byok.research.deepFailed', { note: noteName(record), reason: byokErrorMessage(error, provider) }));
      }
    }
    this.schedulePoll(localId, DEEP_RESEARCH_POLL_MS);
  }

  private async complete(record: DeepResearchRecord, result: ByokGenerateResult): Promise<void> {
    const target = await this.deps.resolveTarget(record);
    if (!target) {
      await this.forget(record);
      this.deps.notify(t('byok.research.noteMissing'));
      return;
    }
    const stored = toStoredProviderId(record.handle.provider);
    const now = this.now();
    const meta: AICommentMeta = {
      id: generateCommentId(stored, 'research'),
      cli: stored,
      model: record.model ?? record.handle.model,
      ...(result.model ? { executedModel: result.model } : {}),
      type: 'research',
      generatedAt: new Date(now).toISOString(),
      processingTime: now - record.startedAt,
      contentHash: createContentHash(buildPostArticleInput(target.post).body),
    };
    // Kept (not polled) until it is saved: the provider still holds the report.
    const tryAgain: ResearchNoticeAction = { label: t('byok.research.tryAgain'), run: () => this.schedulePoll(record.localId, 0) };
    try {
      const saved = await this.saveReport(target, meta, formatResearchReport({ text: result.text, citations: result.citations }));
      if (saved === 'no_room') {
        this.deps.notify(t('byok.research.deepNoRoom', { note: noteName(record) }), tryAgain);
        return;
      }
    } catch (error) {
      this.deps.notify(t('byok.research.deepFailed', { note: noteName(record), reason: researchErrorMessage(error) }), tryAgain);
      return;
    }
    await this.forget(record);
    this.deps.notify(t('byok.research.deepSaved', { note: noteName(record) }));
  }

  private async fail(record: DeepResearchRecord, message: string): Promise<void> {
    await this.forget(record);
    this.deps.notify(message, { label: t('byok.research.runAgain'), run: () => void this.runAgain(record) });
  }

  private async runAgain(record: DeepResearchRecord): Promise<void> {
    const target = await this.deps.resolveTarget(record);
    if (!target) {
      this.deps.notify(t('byok.research.noteMissing'));
      return;
    }
    try {
      await this.startDeep({
        target,
        provider: record.handle.provider,
        archiveId: record.archiveId,
        ...(record.focus ? { focus: record.focus } : {}),
        ...(record.outputLanguage ? { outputLanguage: record.outputLanguage } : {}),
      });
      this.deps.notify(t('byok.research.deepStarted', { provider: BYOK_PROVIDERS[record.handle.provider].label }));
    } catch (error) {
      this.deps.notify(t('byok.research.deepFailed', { note: noteName(record), reason: researchErrorMessage(error) }));
    }
  }

  private async saveReport(target: AICommentTarget, meta: AICommentMeta, report: string): Promise<'saved' | 'no_room'> {
    const budget = await target.budget('research');
    const content = budget ? fitTextToBudget(report, budget).content : '';
    if (!content) return 'no_room';
    await target.save(meta, content);
    return 'saved';
  }

  private async forget(record: DeepResearchRecord): Promise<void> {
    const timer = this.timers.get(record.localId);
    if (timer !== undefined) this.deps.clearSchedule(timer);
    this.timers.delete(record.localId);
    this.active.delete(record.localId);
    await this.updateStore((records) => records.filter((entry) => entry.localId !== record.localId));
  }

  private async readRecords(): Promise<DeepResearchRecord[]> {
    try {
      const raw = await this.deps.store.get(DEEP_RESEARCH_STORE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.flatMap((item) => (isRecord(item) ? [item] : [])) : [];
    } catch {
      return [];
    }
  }

  /** Read-modify-write, so records this session never loaded survive. */
  private async updateStore(change: (records: DeepResearchRecord[]) => DeepResearchRecord[]): Promise<void> {
    const records = change(await this.readRecords());
    try {
      await this.deps.store.set(DEEP_RESEARCH_STORE_KEY, records.length > 0 ? JSON.stringify(records) : null);
    } catch {
      // A full store loses resume after a restart, never the running job.
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private newId(): string {
    return this.deps.newId?.() ?? `deep-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function clipFocus(focus: string | undefined): string | undefined {
  const text = focus?.replace(/\s+/g, ' ').trim().slice(0, RESEARCH_MAX_FOCUS_CHARS);
  return text || undefined;
}

function noteName(record: DeepResearchRecord): string {
  return record.filePath.split('/').pop()?.replace(/\.md$/i, '') || record.filePath;
}

function isRecord(value: unknown): value is DeepResearchRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DeepResearchRecord>;
  const handle = record.handle as Partial<ByokDeepResearchHandle> | undefined;
  return (
    typeof record.localId === 'string' &&
    typeof record.filePath === 'string' &&
    typeof record.startedAt === 'number' &&
    (handle?.provider === 'openai' || handle?.provider === 'gemini') &&
    typeof handle.id === 'string' &&
    typeof handle.model === 'string' &&
    typeof handle.startedAt === 'number'
  );
}
