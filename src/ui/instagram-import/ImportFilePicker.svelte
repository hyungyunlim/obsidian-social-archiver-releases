<script lang="ts">
  /**
   * ImportFilePicker — drag-drop + browse UI for selecting .zip parts.
   *
   * Validates extension only; deeper validation (manifest shape, checksums)
   * happens in `ImportOrchestrator.preflight` upstream. PRD §5.3 pre-flight.
   */

  import type { StartImportFile } from '../../types/import';

  type Props = {
    onFilesSelected: (files: StartImportFile[]) => void | Promise<void>;
  };

  let { onFilesSelected }: Props = $props();

  let isDragOver = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  function isZipFile(file: File): boolean {
    return /\.zip$/i.test(file.name);
  }

  function toStartImportFiles(fileList: FileList | File[]): StartImportFile[] {
    const arr = Array.from(fileList);
    return arr.filter(isZipFile).map((f) => ({ name: f.name, blob: f }));
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    isDragOver = false;
    if (!e.dataTransfer?.files) return;
    const files = toStartImportFiles(e.dataTransfer.files);
    if (files.length === 0) return;
    void onFilesSelected(files);
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave(): void {
    isDragOver = false;
  }

  function handleBrowse(): void {
    inputEl?.click();
  }

  function handleInputChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (!target.files) return;
    const files = toStartImportFiles(target.files);
    if (files.length === 0) return;
    void onFilesSelected(files);
    // Clear so the user can re-select the same file
    target.value = '';
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleBrowse();
    }
  }
</script>

<div
  class="sa-ig-picker"
  class:sa-ig-picker--over={isDragOver}
  role="button"
  tabindex="0"
  aria-label="Drop Instagram export .zip files here, or press Enter to browse"
  ondrop={handleDrop}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  onclick={handleBrowse}
  onkeydown={handleKeyDown}
>
  <div class="sa-ig-picker__icon" aria-hidden="true">&#x2B06;</div>
  <div class="sa-ig-picker__text">
    <strong>Drop .zip parts here</strong>
    <span>or click to browse</span>
  </div>
  <input
    bind:this={inputEl}
    type="file"
    accept=".zip,application/zip"
    multiple
    class="sa-ig-picker__input"
    onchange={handleInputChange}
    aria-label="Choose Instagram export .zip files"
  />
</div>

<style>
  .sa-ig-picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem 1rem;
    border: 2px dashed var(--background-modifier-border, #ccc);
    border-radius: var(--radius-m, 8px);
    background: var(--background-secondary, transparent);
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
    min-height: 44px;
  }

  .sa-ig-picker:hover,
  .sa-ig-picker:focus-visible {
    outline: none;
    border-color: var(--interactive-accent, #3b82f6);
  }

  .sa-ig-picker--over {
    border-color: var(--interactive-accent, #3b82f6);
    background: var(--background-modifier-hover, transparent);
  }

  .sa-ig-picker__icon {
    font-size: 1.5rem;
  }

  .sa-ig-picker__text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
    text-align: center;
  }

  .sa-ig-picker__text strong {
    font-weight: var(--font-bold, 600);
  }

  .sa-ig-picker__text span {
    color: var(--text-muted, #777);
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-picker__input {
    display: none;
  }
</style>
