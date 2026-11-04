import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  setIcon: vi.fn(),
}));

import { AICommentBanner, type AICommentBannerOptions } from '@/components/timeline/renderers/AICommentBanner';

function mount(overrides: Partial<AICommentBannerOptions> = {}) {
  const container = document.body.createDiv();
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  const banner = new AICommentBanner();
  banner.render(container, {
    availableClis: ['claude', 'apple'],
    defaultCli: 'claude',
    defaultType: 'factcheck',
    onGenerate,
    onDecline: vi.fn(),
    isGenerating: false,
    ...overrides,
  });
  const [typeSelect, providerSelect] = Array.from(container.querySelectorAll('select'));
  return { banner, container, onGenerate, typeSelect: typeSelect!, providerSelect: providerSelect! };
}

function pickProvider(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

const disabledValues = (select: HTMLSelectElement): string[] =>
  Array.from(select.options).filter((option) => option.disabled).map((option) => option.value);

describe('AICommentBanner — Apple Intelligence', () => {
  it('greys out the types Apple Intelligence cannot run and queues a supported one', async () => {
    const { container, onGenerate, typeSelect, providerSelect } = mount({
      hasTranscript: true,
      actionItems: [{ id: 'tags.suggest_apply', label: 'Suggest Tags' }],
    });
    expect(Array.from(providerSelect.options).map((option) => option.text)).toEqual(['Claude Code', 'Apple Intelligence']);
    expect(disabledValues(typeSelect)).toEqual([]);
    expect(typeSelect.value).toBe('comment:factcheck');

    pickProvider(providerSelect, 'apple');
    expect(disabledValues(typeSelect)).toEqual([
      'comment:factcheck',
      'comment:critique',
      'comment:sentiment',
      'comment:connections',
      'comment:translate-transcript',
    ]);
    expect(typeSelect.value).toBe('comment:summary');

    (container.querySelector('button[aria-label="Yes"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.textContent).toContain('AI comment queued'));
    expect(onGenerate).toHaveBeenCalledWith('apple', 'summary', undefined, 'auto', false);
  });

  it('re-enables every type when switching back to a CLI', () => {
    const { typeSelect, providerSelect } = mount();
    pickProvider(providerSelect, 'apple');
    pickProvider(providerSelect, 'claude');
    expect(disabledValues(typeSelect)).toEqual([]);
    expect(typeSelect.value).toBe('comment:summary');
  });

  it('starts on a supported type when Apple Intelligence is the only provider', () => {
    const { container, typeSelect } = mount({ availableClis: ['apple'], defaultCli: 'apple', defaultType: 'critique' });
    expect(typeSelect.value).toBe('comment:summary');
    expect(container.textContent).toContain('Apple Intelligence');
  });
});

describe('AICommentBanner — the user\'s own provider keys', () => {
  it('names BYOK engines by provider and keeps vault connections CLI-only', async () => {
    const { container, onGenerate, typeSelect, providerSelect } = mount({
      availableClis: ['claude', 'openai-api', 'gemini-api'],
      defaultType: 'connections',
    });
    expect(Array.from(providerSelect.options).map((option) => option.text)).toEqual([
      'Claude Code',
      'OpenAI (my key)',
      'Gemini (my key)',
    ]);

    pickProvider(providerSelect, 'openai-api');
    expect(disabledValues(typeSelect)).toEqual(['comment:connections']);
    expect(typeSelect.value).toBe('comment:summary');

    (container.querySelector('button[aria-label="Yes"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.textContent).toContain('AI comment added'));
    expect(onGenerate).toHaveBeenCalledWith('openai-api', 'summary', undefined, 'auto', false);
  });

  it('does not offer CLI setup when a key run fails as unauthenticated', async () => {
    const { container } = mount({
      availableClis: ['anthropic-api'],
      defaultCli: 'anthropic-api',
      defaultType: 'summary',
      onGenerate: vi.fn().mockRejectedValue(new Error('anthropic-api not authenticated')),
    });
    (container.querySelector('button[aria-label="Yes"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="Yes"]')).not.toBeNull());
    expect(container.textContent).not.toContain('requires authentication');
  });
});

describe('AICommentBanner — searching the web on a custom run', () => {
  const webOption = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('.acb-web-option')!;
  const webBox = (container: HTMLElement): HTMLInputElement => webOption(container).querySelector('input')!;
  const webNote = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('.acb-web-note')!;
  const yes = (container: HTMLElement): HTMLButtonElement => container.querySelector<HTMLButtonElement>('button[aria-label="Yes"]')!;
  const typePrompt = (container: HTMLElement, text: string): void => {
    const input = container.querySelector<HTMLInputElement>('.acb-prompt-input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };

  it('is offered for a custom comment with the user\'s own key, off by default, for that one run', async () => {
    const { banner, container, onGenerate, typeSelect, providerSelect } = mount({
      availableClis: ['claude', 'openai-api'],
      defaultCli: 'openai-api',
      defaultType: 'summary',
      modelWithoutWebSearch: vi.fn(async () => null),
    });
    onGenerate.mockRejectedValueOnce(new Error('OpenAI is rate limiting requests.'));
    expect(webOption(container).hasClass('sa-hidden')).toBe(true);

    pickProvider(typeSelect, 'comment:custom');
    expect(webOption(container).hasClass('sa-hidden')).toBe(false);
    expect(webBox(container).checked).toBe(false);
    expect(webNote(container).hasClass('sa-hidden')).toBe(true);

    pickProvider(providerSelect, 'claude'); // a local CLI never gets it
    expect(webOption(container).hasClass('sa-hidden')).toBe(true);
    pickProvider(providerSelect, 'openai-api');

    webBox(container).click();
    expect(webNote(container).hasClass('sa-hidden')).toBe(false);
    expect(webNote(container).textContent).toBe('Web searches may cost extra on your OpenAI account.');

    // A failed run keeps the choice, like its prompt.
    typePrompt(container, 'Check the release year');
    yes(container).click();
    await vi.waitFor(() => expect(yes(container)).not.toBeNull());
    expect(webBox(container).checked).toBe(true);

    yes(container).click();
    await vi.waitFor(() => expect(container.textContent).toContain('AI comment added'));
    expect(onGenerate).toHaveBeenNthCalledWith(1, 'openai-api', 'custom', 'Check the release year', 'auto', true);
    expect(onGenerate).toHaveBeenNthCalledWith(2, 'openai-api', 'custom', 'Check the release year', 'auto', true);

    // That run had it; the next one starts without.
    banner.setState('default');
    expect(webBox(container).checked).toBe(false);
  });

  it('is greyed out, saying why, when the key\'s comment model cannot search', async () => {
    const modelWithoutWebSearch = vi.fn(async () => 'Claude Haiku 3');
    const { container, onGenerate } = mount({
      availableClis: ['anthropic-api'],
      defaultCli: 'anthropic-api',
      defaultType: 'custom',
      modelWithoutWebSearch,
    });
    webBox(container).click(); // before the answer arrives
    await vi.waitFor(() => expect(webBox(container).disabled).toBe(true));
    expect(modelWithoutWebSearch).toHaveBeenCalledWith('anthropic-api');
    expect(webBox(container).checked).toBe(false);
    expect(webOption(container).getAttribute('title')).toBe('Claude Haiku 3 cannot search the web.');
    expect(webNote(container).textContent).toBe('Claude Haiku 3 cannot search the web.');

    typePrompt(container, 'Check the release year');
    yes(container).click();
    await vi.waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate).toHaveBeenCalledWith('anthropic-api', 'custom', 'Check the release year', 'auto', false);
  });
});
