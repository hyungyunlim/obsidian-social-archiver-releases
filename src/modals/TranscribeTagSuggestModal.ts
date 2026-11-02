import { type App, type MetadataCache, SuggestModal } from 'obsidian';
import { buildTagScopeChoices, normalizeTagName, type TagScopeChoice } from '../utils/tags';

/**
 * Picks the tag a batch transcription is scoped to. Lists the vault's tags
 * plus the parents of nested ones, so `#recipes` can be chosen to cover
 * `#recipes/korean` even when `#recipes` itself is never used.
 */
export class TranscribeTagSuggestModal extends SuggestModal<TagScopeChoice> {
  private readonly choices: TagScopeChoice[];

  constructor(app: App, private readonly onChoose: (tag: string) => void) {
    super(app);
    // ponytail: getTags() is missing from obsidian.d.ts but is what the core tag pane reads.
    const cache = app.metadataCache as MetadataCache & { getTags?: () => Record<string, number> };
    this.choices = buildTagScopeChoices(cache.getTags?.() ?? {});
    this.setPlaceholder('Transcribe videos in notes with this tag');
    this.emptyStateText = this.choices.length === 0 ? 'No tags in this vault.' : 'No matching tag.';
  }

  getSuggestions(query: string): TagScopeChoice[] {
    const q = normalizeTagName(query).toLowerCase();
    return q ? this.choices.filter((choice) => choice.tag.toLowerCase().includes(q)) : this.choices;
  }

  renderSuggestion(choice: TagScopeChoice, el: HTMLElement): void {
    el.addClass('mod-complex');
    el.createDiv({ cls: 'suggestion-content', text: `#${choice.tag}` });
    el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair', text: String(choice.count) });
  }

  onChooseSuggestion(choice: TagScopeChoice): void {
    this.onChoose(choice.tag);
  }
}
