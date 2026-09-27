import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  setIcon: vi.fn(),
}));

import { AICommentBanner, type AICommentBannerOptions } from '@/components/timeline/renderers/AICommentBanner';

function mount(overrides: Partial<AICommentBannerOptions> = {}) {
  const container = document.body.createDiv();
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  new AICommentBanner().render(container, {
    availableClis: ['claude', 'apple'],
    defaultCli: 'claude',
    defaultType: 'factcheck',
    onGenerate,
    onDecline: vi.fn(),
    isGenerating: false,
    ...overrides,
  });
  const [typeSelect, providerSelect] = Array.from(container.querySelectorAll('select'));
  return { container, onGenerate, typeSelect: typeSelect!, providerSelect: providerSelect! };
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
    expect(onGenerate).toHaveBeenCalledWith('apple', 'summary', undefined, 'auto');
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
