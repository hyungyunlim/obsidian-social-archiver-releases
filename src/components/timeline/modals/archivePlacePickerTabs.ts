export type ArchivePlacePickerView = 'existing' | 'search';

export interface ArchivePlacePickerTabs {
  setActive(view: ArchivePlacePickerView): void;
}

const VIEWS: readonly ArchivePlacePickerView[] = ['existing', 'search'];

const VIEW_LABELS = {
  existing: 'Existing',
  search: 'Search',
} as const satisfies Record<ArchivePlacePickerView, string>;

export function createArchivePlacePickerTabs(
  parent: HTMLElement,
  onSelect: (view: ArchivePlacePickerView) => void,
): ArchivePlacePickerTabs {
  const tablist = parent.createDiv({ cls: 'sa-place-picker-tabs' });
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Place source');
  const tabs = new Map<ArchivePlacePickerView, HTMLButtonElement>();

  const setActive = (active: ArchivePlacePickerView): void => {
    for (const [view, tab] of tabs) {
      const selected = view === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  };

  const activate = (view: ArchivePlacePickerView, focus: boolean): void => {
    setActive(view);
    onSelect(view);
    if (focus) tabs.get(view)?.focus();
  };

  for (const view of VIEWS) {
    const tab = tablist.createEl('button', {
      text: VIEW_LABELS[view],
      cls: 'sa-place-picker-tab',
    });
    tab.type = 'button';
    tab.id = `sa-place-picker-tab-${view}`;
    tab.dataset.view = view;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'sa-place-picker-panel');
    tab.addEventListener('click', () => activate(view, false));
    tab.addEventListener('keydown', (event) => {
      const index = VIEWS.indexOf(view);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? VIEWS.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % VIEWS.length
          : event.key === 'ArrowLeft' ? (index - 1 + VIEWS.length) % VIEWS.length : -1;
      if (nextIndex < 0) return;
      event.preventDefault();
      const nextView = VIEWS[nextIndex];
      if (nextView) activate(nextView, true);
    });
    tabs.set(view, tab);
  }
  setActive('existing');
  return { setActive };
}
