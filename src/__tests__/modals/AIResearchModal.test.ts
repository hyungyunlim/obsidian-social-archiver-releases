import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

const notices: string[] = [];

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  class Notice {
    constructor(message: string) {
      notices.push(message);
    }
  }
  return { ...actual, Notice };
});

import { AIResearchModal, researchEngineOptions } from '../../modals/AIResearchModal';
import { ResearchError, type ByokResearchRunner } from '../../services/byok/ByokResearchRunner';
import type { AICommentTarget } from '../../services/ai-comment/AICommentSaver';
import type { ByokService } from '../../services/byok/ByokService';
import type { PostData } from '../../types/post';
import type { AICli } from '../../utils/ai-cli';

const target = { post: { filePath: 'Social Archives/post.md' } as PostData, budget: vi.fn(), save: vi.fn() } as unknown as AICommentTarget;
const byok = (providers: string[]) => ({ readyProviders: () => providers }) as unknown as ByokService;

function open(providers: string[], clis: AICli[] = []) {
  const runner = { runQuick: vi.fn(async () => undefined), startDeep: vi.fn(async () => undefined) };
  const onClosed = vi.fn();
  const modal = new AIResearchModal({} as App, {
    target,
    runner: runner as unknown as ByokResearchRunner,
    byok: byok(providers),
    detectClis: async () => clis,
    archiveId: 'archive-1',
    outputLanguage: 'ko',
    openSettings: vi.fn(),
    onClosed,
  });
  modal.open();
  return { modal, runner, onClosed };
}

const $ = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};
const deepRadio = () => $<HTMLInputElement>('input[value="deep"]');

async function chooseEngine(id: string): Promise<void> {
  const select = $<HTMLSelectElement>('.sa-ai-research-modal select');
  select.value = id;
  select.dispatchEvent(new Event('change'));
}

describe('AIResearchModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    notices.length = 0;
  });

  it('lists own keys, then installed CLIs; deep only for OpenAI and Gemini keys', () => {
    expect(researchEngineOptions(byok(['openai', 'anthropic']), ['claude']).map(({ id, label, deep }) => [id, label, deep])).toEqual([
      ['openai-api', 'OpenAI (my key)', 'openai'],
      ['anthropic-api', 'Anthropic (my key)', null],
      ['claude', 'Claude Code', null],
    ]);
  });

  it('runs quick research with the focus and closes once it is saved', async () => {
    const { runner, onClosed } = open(['anthropic'], ['claude']);
    await vi.waitFor(() => expect(document.querySelector('.sa-ai-research-form')).not.toBeNull());
    await chooseEngine('claude');
    expect(deepRadio().disabled).toBe(true);
    $<HTMLTextAreaElement>('.sa-ai-research-focus').value = 'the dates';
    $<HTMLButtonElement>('.sa-ai-research-modal .mod-cta').click();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalled());
    expect(runner.runQuick).toHaveBeenCalledWith(expect.objectContaining({ target, engine: 'claude', focus: 'the dates', outputLanguage: 'ko' }));
    expect(notices).toEqual(['Research saved to the note.']);
  });

  it('starts deep research in the background and closes', async () => {
    const { runner, onClosed } = open(['gemini']);
    await vi.waitFor(() => expect(document.querySelector('.sa-ai-research-form')).not.toBeNull());
    deepRadio().checked = true;
    deepRadio().dispatchEvent(new Event('change'));
    expect($('.sa-ai-research-form .sa-ai-research-note').textContent).toContain('A background job on Gemini');
    $<HTMLButtonElement>('.sa-ai-research-modal .mod-cta').click();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalled());
    expect(runner.startDeep).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', archiveId: 'archive-1' }));
    expect(runner.runQuick).not.toHaveBeenCalled();
  });

  it('shows why a run could not save and stays open', async () => {
    const { runner, onClosed } = open(['openai']);
    runner.runQuick.mockRejectedValueOnce(new ResearchError('no_room', 'This note has too much AI comment text.'));
    await vi.waitFor(() => expect(document.querySelector('.sa-ai-research-form')).not.toBeNull());
    $<HTMLButtonElement>('.sa-ai-research-modal .mod-cta').click();
    await vi.waitFor(() => expect($('.sa-ai-chat-error').textContent).toBe('This note has too much AI comment text.'));
    expect(onClosed).not.toHaveBeenCalled();
    expect($<HTMLButtonElement>('.sa-ai-research-modal .mod-cta').textContent).toBe('Run research');
  });

  it('points to settings when nothing can research', async () => {
    open([]);
    await vi.waitFor(() => expect(document.querySelector('.sa-ai-chat-no-engine')).not.toBeNull());
    expect($('.sa-ai-chat-no-engine').textContent).toContain('install Claude Code');
  });
});
