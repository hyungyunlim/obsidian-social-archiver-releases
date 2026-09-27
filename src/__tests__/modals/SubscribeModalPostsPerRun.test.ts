/**
 * Naver/Brunch subscribe modals feed options.maxPostsPerRun into
 * POST/PATCH /api/subscriptions, which reject values above 20.
 */

import { describe, expect, it, vi } from 'vitest';
import type { App, Modal } from 'obsidian';
import { NaverSubscribeModal } from '@/modals/NaverSubscribeModal';
import { BrunchSubscribeModal } from '@/modals/BrunchSubscribeModal';
import type { AuthorCatalogEntry } from '@/types/author-catalog';

type Submit = (options: { maxPostsPerRun: number }) => Promise<void>;

const app = {} as App;
const author = { authorName: 'Author', archiveCount: 0 } as AuthorCatalogEntry;

describe.each<[string, (onSubmit: Submit) => Modal]>([
  ['NaverSubscribeModal', (onSubmit): Modal => new NaverSubscribeModal(app, author, onSubmit, 'blog')],
  ['BrunchSubscribeModal', (onSubmit): Modal => new BrunchSubscribeModal(app, author, onSubmit)],
])('%s posts per run', (_name, createModal) => {
  it('is capped at the Worker limit of 20', async () => {
    const onSubmit = vi.fn<Submit>().mockResolvedValue(undefined);
    const modal = createModal(onSubmit);
    modal.open();

    const input = modal.contentEl.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input?.max).toBe('20');

    input!.value = '50';
    input!.dispatchEvent(new Event('change'));
    Array.from(modal.contentEl.querySelectorAll('button'))
      .find((button) => button.textContent === 'Subscribe')
      ?.click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].maxPostsPerRun).toBe(20);
  });
});
