import { setIcon } from 'obsidian';

export function createReaderCollapsibleSection(parent: HTMLElement, title: string): HTMLElement {
  const details = parent.createEl('details', { cls: 'sa-reader-mode-comments-section' });
  details.open = true;

  const summary = details.createEl('summary', { cls: 'sa-reader-mode-comments-section-summary' });
  summary.createSpan({ cls: 'sa-reader-mode-comments-section-title', text: title });
  const icon = summary.createSpan({ cls: 'sa-reader-mode-comments-section-chevron' });
  setIcon(icon, 'chevron-down');

  return details.createDiv({ cls: 'sa-reader-mode-comments-section-body' });
}
