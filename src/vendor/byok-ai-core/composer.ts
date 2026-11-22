/**
 * Post composer AI writing, on a draft that may never have been saved:
 * rewrite / expand / shorten / summarize a selection, continue at the cursor,
 * a typed request, or an "@AI …" request paragraph. One prompt for every
 * engine: the user's own key builds it on the device, Cloud AI builds it in
 * workers from the structured request (`POST /api/ai-actions/composer/write`,
 * validated by parseComposerAIInput). No client ever sends a system prompt,
 * so Cloud AI stays a writing helper, not a general model proxy.
 */
import type { ByokMessage } from './chat';

export const COMPOSER_AI_ACTIONS = ['rewrite', 'expand', 'shorten', 'summarize', 'continue', 'custom', 'mention'] as const;
export type ComposerAIAction = (typeof COMPOSER_AI_ACTIONS)[number];
/** Actions on a selection, in bar order. */
export const COMPOSER_SELECTION_ACTIONS = ['rewrite', 'expand', 'shorten', 'summarize'] as const;

export const COMPOSER_AI_MAX_OUTPUT_TOKENS = 2_000;
/** Context a client puts around the place: the text before and after it. */
export const COMPOSER_BEFORE_MAX_CHARS = 3_000;
export const COMPOSER_AFTER_MAX_CHARS = 1_000;
/** A mention request's context: the rest of the draft (sent as `before`). */
export const COMPOSER_DRAFT_MAX_CHARS = 8_000;
/** The longest selection one request may carry. */
export const COMPOSER_MAX_TEXT_CHARS = 8_000;
export const COMPOSER_MAX_INSTRUCTION_CHARS = 2_000;

export interface ComposerAIInput {
  readonly action: ComposerAIAction;
  /** The selected text (selection actions). */
  readonly text?: string | undefined;
  /** A typed request, or the mention's question. */
  readonly instruction?: string | undefined;
  /** The text before the place; a mention's whole draft. */
  readonly before: string;
  readonly after: string;
}

export type ComposerInputError =
  | 'ACTION_INVALID'
  | 'TEXT_REQUIRED'
  | 'TEXT_TOO_LONG'
  | 'INSTRUCTION_REQUIRED'
  | 'INSTRUCTION_TOO_LONG'
  | 'CONTEXT_TOO_LONG';

const SELECTION = new Set<string>(COMPOSER_SELECTION_ACTIONS);
const ACTIONS = new Set<string>(COMPOSER_AI_ACTIONS);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A composer request off the network (or about to go on it). Unknown fields are dropped. */
export function parseComposerAIInput(body: unknown): { ok: true; input: ComposerAIInput } | { ok: false; code: ComposerInputError } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const action = str(raw.action);
  if (!ACTIONS.has(action)) return { ok: false, code: 'ACTION_INVALID' };
  const text = str(raw.text);
  const instruction = str(raw.instruction).trim();
  const before = str(raw.before);
  const after = str(raw.after);

  if (SELECTION.has(action) && !text.trim()) return { ok: false, code: 'TEXT_REQUIRED' };
  if (text.length > COMPOSER_MAX_TEXT_CHARS) return { ok: false, code: 'TEXT_TOO_LONG' };
  if ((action === 'custom' || action === 'mention') && !instruction) return { ok: false, code: 'INSTRUCTION_REQUIRED' };
  if (instruction.length > COMPOSER_MAX_INSTRUCTION_CHARS) return { ok: false, code: 'INSTRUCTION_TOO_LONG' };
  if (before.length > COMPOSER_DRAFT_MAX_CHARS || after.length > COMPOSER_AFTER_MAX_CHARS) {
    return { ok: false, code: 'CONTEXT_TOO_LONG' };
  }
  return {
    ok: true,
    input: {
      action: action as ComposerAIAction,
      ...(text ? { text } : {}),
      ...(instruction ? { instruction } : {}),
      before,
      after,
    },
  };
}

const RULES = [
  'Write in the same language as the text.',
  'Keep Markdown formatting (bold, italic, lists, headings, links) and the paragraph structure unless the task changes it.',
  'Reply with the resulting text only: no preface, no quotation marks around it, no code fence, no explanation.',
].join(' ');

const TASKS: Record<ComposerAIAction, string> = {
  rewrite: 'Rewrite the selected text so it reads more naturally and clearly. Keep its meaning.',
  expand: 'Expand the selected text with more detail, explanation or examples. Keep its meaning; add a paragraph only where that reads better.',
  shorten: 'Make the selected text more concise. Keep the key information and the number and order of its paragraphs.',
  summarize: 'Summarize the selected text into its key points.',
  continue: 'Continue the draft at the cursor: write the next one to three sentences that follow naturally from the text before the cursor. Never repeat what is already written. Match its tone and style. If there is text after the cursor, lead into it.',
  custom: "Do what the user's instruction asks.",
  mention: "Write what the user's request asks for. It replaces the request paragraph; the rest of the draft stays as it is.",
};

/** With web search on (the user's own key only): sources go in as links the reader can follow. */
const WEB_RULE = 'You may search the web and read pages. Where something comes from a page, cite it inline as a Markdown link [title](url); never paste a bare URL.';

export function buildComposerPrompt(input: ComposerAIInput, options: { web?: boolean } = {}): { system: string; messages: ByokMessage[] } {
  const parts: string[] = [];
  if (input.action === 'mention') {
    parts.push(`Request: ${input.instruction ?? ''}`);
    if (input.before) parts.push(`The rest of my draft (context only):\n${input.before}`);
  } else if (input.text) {
    if (input.instruction) parts.push(`Instruction: ${input.instruction}`);
    parts.push(`Selected text:\n${input.text}`);
    if (input.before) parts.push(`Text before it (context only):\n${input.before.slice(-1_500)}`);
    if (input.after) parts.push(`Text after it (context only):\n${input.after.slice(0, 500)}`);
  } else {
    if (input.instruction) parts.push(`Instruction (write it at the cursor): ${input.instruction}`);
    parts.push(input.before ? `Text before the cursor:\n${input.before}` : 'The draft is empty so far.');
    if (input.after) parts.push(`Text after the cursor:\n${input.after}`);
  }
  return {
    system: `You help the user write a post in their personal archive app. ${TASKS[input.action]} ${RULES}${options.web ? ` ${WEB_RULE}` : ''}`,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  };
}
