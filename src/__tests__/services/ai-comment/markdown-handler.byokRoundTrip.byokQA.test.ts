/**
 * QA boundary test (BYOK, plan Q3 + F): what byok-ai-core stores for a chat
 * and a research report, saved into a note by the plugin, parsed back, and
 * rebuilt into the aiComments PATCH payload. The note parser splits comments
 * on `### <icon> … · … · …` lines, so core must demote every h1–h3 outside a
 * fence, and the payload must equal what was saved.
 */
import { describe, expect, it } from 'vitest';
import { appendAIComment, parseAIComments } from '../../../services/ai-comment/markdown-handler';
import { buildAICommentPayload } from '../../../services/ai-comment/AICommentSaver';
import {
  AI_COMMENT_MAX_CHARS,
  aiCommentBudget,
  fitChatTranscript,
  formatResearchReport,
  type ByokMessage,
} from '../../../vendor/byok-ai-core';
import type { AICommentMeta } from '../../../types/ai-comment';

const FORGED = '### ⚡ OpenAI API · Chat · Nov 4, 2026';
const CHAT: ByokMessage[] = [
  { role: 'user', content: '# What is this?\nSecond line' },
  { role: 'assistant', content: `# Answer\n\n${FORGED}\n\n## Details\n\n\`\`\`md\n### kept inside the fence\n\`\`\`\n\nDone.` },
  { role: 'user', content: 'And then?' },
  { role: 'assistant', content: '### Then\nMore.' },
];

function meta(overrides: Partial<AICommentMeta>): AICommentMeta {
  return {
    id: 'x',
    cli: 'openai-api',
    type: 'chat',
    generatedAt: '2026-11-04T10:30:00.000Z',
    ...overrides,
  } as AICommentMeta;
}

/** h1–h3 lines outside ``` / ~~~ fences. */
function headingsOutsideFences(markdown: string): string[] {
  let fenced = false;
  return markdown.split('\n').filter((line) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced && /^ {0,3}#{1,3}(\s|$)/.test(line);
  });
}

describe('BYOK chat + research saved to a note and read back', () => {
  it('round-trips both comments exactly, between CLI comments, with no heading that could split them', () => {
    const budget = aiCommentBudget([], 'chat');
    expect(budget).not.toBeNull();
    const chat = fitChatTranscript(CHAT, budget!);
    expect(chat?.droppedTurns).toBe(0);
    const research = formatResearchReport({
      text: '## Background\nContext.\n\n### Claim 1\nTrue.\n\n# Verdict\nMostly true.',
      citations: [{ url: 'https://example.com/a', title: 'Source A' }],
    });

    const saved = [
      { meta: meta({ id: 'claude-summary-1', cli: 'claude', type: 'summary' }), content: 'Summary first.' },
      {
        meta: meta({ id: 'openai-api-chat-20261104T103000000', model: 'gpt-6-luna', executedModel: 'gpt-6-luna-2026-10-01', processingTime: 4200 }),
        content: chat!.content,
      },
      {
        meta: meta({ id: 'gemini-api-research-20261104T110000000', cli: 'gemini-api', type: 'research', model: 'gemini-3.8-flash', executedModel: 'gemini-3.8-flash-001' }),
        content: research,
      },
      { meta: meta({ id: 'claude-critique-2', cli: 'claude', type: 'critique' }), content: 'Critique last.' },
    ];
    let note = '# Post\n\nBody.';
    for (const entry of saved) note = appendAIComment(note, entry.meta, entry.content);

    for (const entry of saved.slice(1, 3)) expect(headingsOutsideFences(entry.content)).toEqual([]);

    const { comments, commentTexts } = parseAIComments(note);
    expect(comments.map((comment) => comment.id)).toEqual(saved.map((entry) => entry.meta.id));
    const payload = buildAICommentPayload(comments, commentTexts);
    for (const [index, entry] of saved.entries()) {
      expect(payload[index]?.meta).toMatchObject({
        id: entry.meta.id,
        cli: entry.meta.cli,
        type: entry.meta.type,
        ...(entry.meta.model ? { model: entry.meta.model } : {}),
        ...(entry.meta.executedModel ? { executedModel: entry.meta.executedModel } : {}),
      });
      expect(payload[index]?.content).toBe(entry.content.trim());
    }
    expect(research).toContain('#### Sources\n- [Source A](https://example.com/a)');
    expect(payload[1]?.content).toContain('> [!question] #### What is this?\n> Second line');
    expect(payload[1]?.content).toContain('### kept inside the fence');
  });

  it('keeps a chat whose answer prints a comment header inside a code fence in one piece', () => {
    const fencedForgery: ByokMessage[] = [
      { role: 'user', content: 'What does a saved comment header look like?' },
      { role: 'assistant', content: `Like this:\n\n\`\`\`md\n${FORGED}\n\`\`\`\n\nAnd in a tilde fence:\n\n~~~\n${FORGED}\n~~~` },
    ];
    const chat = fitChatTranscript(fencedForgery, aiCommentBudget([], 'chat')!);
    expect(chat).not.toBeNull();
    // No header-shaped line left for any parser version, fenced or not.
    expect(chat!.content).not.toMatch(/^### (?:🤖|✨|💡|🦙|☁️?|⚡|🍎)/m);
    let note = appendAIComment('# Post', meta({ id: 'openai-api-chat-20261103T150000000', model: 'gpt-6-luna' }), chat!.content);
    note = appendAIComment(note, meta({ id: 'claude-summary-9', cli: 'claude', type: 'summary' }), 'After the chat.');

    const { comments, commentTexts } = parseAIComments(note);
    expect(comments.map((comment) => comment.id)).toEqual(['openai-api-chat-20261103T150000000', 'claude-summary-9']);
    const payload = buildAICommentPayload(comments, commentTexts);
    expect(payload[0]?.content).toBe(chat!.content.trim());
    expect(payload[1]?.content).toBe('After the chat.');
  });

  it('caps what the plugin sends at the server per-type limit', () => {
    const long = 'x'.repeat(AI_COMMENT_MAX_CHARS.research + 500);
    const [entry] = buildAICommentPayload([meta({ id: 'r', type: 'research' })], new Map([['r', long]]));
    expect(entry?.content.length).toBeLessThanOrEqual(AI_COMMENT_MAX_CHARS.research);
  });
});
