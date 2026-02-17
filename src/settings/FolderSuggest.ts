import { AbstractInputSuggest, App, TFolder } from 'obsidian';

/**
 * FolderSuggest - Provides folder autocomplete for text inputs
 * Extends AbstractInputSuggest to show folder suggestions
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private input: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.input = inputEl;
  }

  getSuggestions(query: string): TFolder[] {
    const folders: TFolder[] = [];
    const lowerCaseQuery = query.toLowerCase();

    // Get all folders from vault
    this.app.vault.getAllLoadedFiles().forEach((file) => {
      // Check if it's a folder
      if (file instanceof TFolder) {
        // Filter folders that match the query
        if (file.path.toLowerCase().includes(lowerCaseQuery)) {
          folders.push(file);
        }
      }
    });

    return folders;
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.input.value = folder.path;
    this.input.trigger('input');
    this.close();
  }
}
