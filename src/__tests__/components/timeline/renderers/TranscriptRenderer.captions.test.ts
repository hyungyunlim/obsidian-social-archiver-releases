import { Menu, Modal } from 'obsidian';
import { TranscriptRenderer, type TranscriptCaptionActions } from '@/components/timeline/renderers/TranscriptRenderer';
import type { TranscriptTabSource } from '@/types/post';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon(element: HTMLElement, icon: string): void {
      element.dataset.icon = icon;
    },
  };
});

type MenuWithItems = Menu & { items: Array<{ title: string }> };

describe('TranscriptRenderer caption-language controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('is-mobile');
  });

  const segment = (text: string) => [{ id: 0, start: 0, end: 2, text }];
  const multilang = new Map([
    ['en', segment('Hello')],
    ['ko', segment('안녕하세요')],
    ['ko:whisper', segment('위스퍼')],
    ['ko:ai', segment('번역')],
  ]);
  const sources: Record<string, TranscriptTabSource> = { en: 'original', ko: 'caption', 'ko:whisper': 'whisper', 'ko:ai': 'ai' };

  function render(captionActions?: TranscriptCaptionActions, mobile = false): HTMLElement {
    document.body.classList.toggle('is-mobile', mobile);
    const modal = new Modal(null);
    document.body.appendChild(modal.contentEl);
    new TranscriptRenderer().render(modal.contentEl, {
      segments: segment('Hello'),
      language: 'en',
      languages: [...multilang.keys()],
      multilangSegments: multilang,
      tabSources: sources,
      captionActions,
    });
    return modal.contentEl;
  }

  const actions = (): TranscriptCaptionActions => ({ onAddLanguage: vi.fn(), onSetDefault: vi.fn(), onDelete: vi.fn() });
  const tab = (root: HTMLElement, label: string) =>
    [...root.querySelectorAll<HTMLElement>('.language-tab')].find((el) => el.textContent === label)!;
  const openMenu = (el: HTMLElement): MenuWithItems | null => {
    (Menu as unknown as { last: Menu | null }).last = null;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return (Menu as unknown as { last: MenuWithItems | null }).last;
  };

  it('labels repeated languages by source', () => {
    const root = render();
    expect([...root.querySelectorAll('.language-tab')].map((el) => el.textContent))
      .toEqual(['English', 'Korean', 'Korean (Whisper)', 'Korean (AI)']);
  });

  it('shows "+" only with caption actions, and clicking it does not collapse the header', () => {
    expect(render().querySelector('.transcript-add-language')).toBeNull();
    document.body.innerHTML = '';

    const callbacks = actions();
    const root = render(callbacks);
    const content = root.querySelector<HTMLElement>('.transcript-content')!;
    const collapsedBefore = content.classList.contains('sa-hidden');

    root.querySelector<HTMLElement>('.transcript-add-language')!.click();

    expect(callbacks.onAddLanguage).toHaveBeenCalledTimes(1);
    expect(content.classList.contains('sa-hidden')).toBe(collapsedBefore);
  });

  it('offers set-default for original/caption tabs, delete for captions only, nothing for Whisper/AI', () => {
    const callbacks = actions();
    const root = render(callbacks);

    expect(openMenu(tab(root, 'English'))?.items.map((i) => i.title)).toEqual(['Set as default']);
    const captionMenu = openMenu(tab(root, 'Korean'));
    expect(captionMenu?.items.map((i) => i.title)).toEqual(['Set as default', 'Delete language']);
    expect(openMenu(tab(root, 'Korean (Whisper)'))).toBeNull();
    expect(openMenu(tab(root, 'Korean (AI)'))).toBeNull();

    (captionMenu as unknown as { select: (title: string) => boolean }).select('Delete language');
    expect(callbacks.onDelete).toHaveBeenCalledWith('ko');
  });

  it('has no tab menu without caption actions', () => {
    expect(openMenu(tab(render(), 'Korean'))).toBeNull();
  });

  it('"⋯" opens the active tab\'s menu on every platform and hides on Whisper/AI tabs', () => {
    const callbacks = actions();
    const root = render(callbacks, true);
    const menuBtn = root.querySelector<HTMLElement>('.transcript-language-menu')!;
    const showMenu = (): MenuWithItems | null => {
      (Menu as unknown as { last: Menu | null }).last = null;
      menuBtn.click();
      return (Menu as unknown as { last: MenuWithItems | null }).last;
    };

    expect(menuBtn.classList.contains('tr-lang-menu-btn-mobile')).toBe(true);
    expect(menuBtn.classList.contains('sa-hidden')).toBe(false);
    expect(showMenu()?.items.map((i) => i.title)).toEqual(['Set as default']);

    tab(root, 'KO').click();
    const captionMenu = showMenu();
    expect(captionMenu?.items.map((i) => i.title)).toEqual(['Set as default', 'Delete language']);
    (captionMenu as unknown as { select: (title: string) => boolean }).select('Set as default');
    expect(callbacks.onSetDefault).toHaveBeenCalledWith('ko');

    tab(root, 'KO W').click();
    expect(menuBtn.classList.contains('sa-hidden')).toBe(true);
    expect(showMenu()).toBeNull();
  });

  it('has no "⋯" without caption actions', () => {
    expect(render().querySelector('.transcript-language-menu')).toBeNull();
  });
});
