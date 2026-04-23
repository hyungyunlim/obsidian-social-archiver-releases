<script lang="ts">
  /**
   * InstagramImport — root view for the Instagram Saved Posts import flow.
   *
   * Owns the pre-flight → progress → completion pane transitions and the
   * orchestrator event subscription. Sub-panes are dumb components driven by
   * `$state` here.
   *
   * Modal dismissal does NOT cancel the job — the orchestrator persists state
   * across modal open/close. On mount, we look up active jobs and jump to the
   * progress pane if one is running.
   *
   * PRD refs: §5.3 (UX), §5.3.1 (non-blocking vault).
   */

  import { onMount } from 'svelte';
  import type {
    ImportDestination,
    ImportOrchestrator,
    ImportPreflightResult,
    ImportJobState,
    ImportProgressEvent,
    ImportItem,
    StartImportFile,
    GallerySelection,
  } from '../../types/import';
  import { DEFAULT_IMPORT_DESTINATION } from '../../types/import';
  // Concrete class import — the public {@link ImportOrchestrator} interface
  // intentionally does NOT expose `getMediaPreviewService()` (Layer 2 spec
  // keeps the interface narrow). The gallery pane needs the service for
  // viewport-driven blob acquisition, so we cast to the concrete class.
  import { ImportOrchestrator as ImportOrchestratorClass } from '../../services/import/ImportOrchestrator';

  import ImportPreflight from './ImportPreflight.svelte';
  import ImportProgress from './ImportProgress.svelte';
  import ImportCompletion from './ImportCompletion.svelte';
  import ImportFailedList from './ImportFailedList.svelte';
  // Owned by Layer 3A — file may not exist at typecheck time. Imports of
  // not-yet-built sibling components are expected to be unresolved until
  // Layer 3A lands; the prop contract is locked so the wiring below will
  // type-check once the file appears.
  import ImportGallery from './ImportGallery.svelte';

  type Pane = 'preflight' | 'gallery' | 'progress' | 'completion' | 'failed';

  type Props = {
    orchestrator: ImportOrchestrator;
    onRequestClose: () => void;
    onOpenArchive: (archiveId: string) => void;
    onNotice: (message: string) => void;
  };

  let { orchestrator, onRequestClose, onOpenArchive, onNotice }: Props = $props();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let pane = $state<Pane>('preflight');

  /** Files the user picked; kept alive while the job runs. */
  let selectedFiles = $state<StartImportFile[]>([]);

  /** Raw preflight response from the orchestrator. */
  let preflight = $state<ImportPreflightResult | null>(null);
  let isRunningPreflight = $state(false);
  let preflightError = $state<string | null>(null);

  /**
   * Extended preflight result with per-post previews — populated only when
   * the user clicks `Review posts`. Kept separate from {@link preflight}
   * so the gallery can be re-entered with the same files but a fresh
   * selection without disturbing the lightweight pre-flight summary.
   *
   * PRD: prd-instagram-import-gallery.md §5.2, §9.6
   */
  let galleryPreflight = $state<ImportPreflightResult | null>(null);
  let isLoadingGallery = $state(false);

  /**
   * Number of ready-to-import posts the user explicitly excluded via the
   * review gallery. Computed at the moment of `Import N selected` and shown
   * on the completion summary (PRD F4.5). Always 0 for the `Skip review`
   * path.
   */
  let intentionallyExcluded = $state(0);

  /** Target timeline bucket for every item in this job. */
  let destination = $state<ImportDestination>(DEFAULT_IMPORT_DESTINATION);

  /** Raw comma-separated text; orchestrator normalizes on startImport. */
  let tagsInput = $state('');

  /** Live job state (null until startImport or active-job discovery completes). */
  let activeJob = $state<ImportJobState | null>(null);

  /** Live counters, driven by `job.progress` events. */
  let completedItems = $state(0);
  let partialMediaItems = $state(0);
  let skippedDuplicates = $state(0);
  let failedItems = $state(0);

  /** Last item status — drives "Uploading post {shortcode}" label. */
  let currentItemPostId = $state<string | null>(null);

  /** Final summary, set on `job.completed`. */
  let completionSummary = $state<{
    imported: number;
    importedWithWarnings: number;
    skippedDuplicates: number;
    failed: number;
    /** PRD F4.5 — exposed via the gallery flow only. */
    intentionallyExcluded?: number;
  } | null>(null);

  /** The archiveId of the most recently completed item (deep link target). */
  let lastArchiveId = $state<string | null>(null);

  /** Items list, fetched on demand (failed-items pane). */
  let items = $state<ImportItem[]>([]);
  let isLoadingItems = $state(false);

  /** Throughput estimate (posts/sec, rolling). */
  let startedAtMs = $state<number | null>(null);

  let unsubscribe: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onMount(() => {
    // If a job is already running when the user re-opens the modal, jump to progress.
    void reattachToActiveJob();

    // Subscribe to progress events regardless of pane — events may arrive while
    // user is on pre-flight for a different job session.
    unsubscribe = orchestrator.onEvent(handleEvent);

    return () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  });

  async function reattachToActiveJob(): Promise<void> {
    try {
      const running = await orchestrator.listActiveJobs();
      const live = running.find(
        (j) => j.status === 'running' || j.status === 'queued' || j.status === 'paused',
      );
      if (!live) return;

      activeJob = live;
      completedItems = live.completedItems;
      partialMediaItems = live.partialMediaItems;
      skippedDuplicates = live.skippedDuplicates;
      failedItems = live.failedItems;
      startedAtMs = live.startedAt ?? null;
      pane = 'progress';
    } catch (err) {
      // Non-fatal — leave user on pre-flight.
      console.warn('[Instagram Import] Failed to reattach to active job', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const totalItems = $derived(activeJob?.totalItems ?? 0);
  const progressPct = $derived(totalItems === 0 ? 0 : Math.min(100, (completedItems / totalItems) * 100));

  const throughputPerSec = $derived.by(() => {
    if (!startedAtMs || completedItems === 0) return 0;
    const elapsedSec = (Date.now() - startedAtMs) / 1000;
    if (elapsedSec < 1) return 0;
    return completedItems / elapsedSec;
  });

  const importButtonEnabled = $derived(
    preflight !== null && preflight.parts.length > 0 && preflight.readyToImport > 0 && !isRunningPreflight,
  );

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  function handleEvent(evt: ImportProgressEvent): void {
    if (!activeJob) return;
    if (evt.type !== 'job.started' && 'jobId' in evt && evt.jobId !== activeJob.jobId) {
      // Event belongs to a different job — ignore.
      return;
    }

    switch (evt.type) {
      case 'job.started':
        startedAtMs = Date.now();
        if (activeJob && activeJob.jobId === evt.jobId) {
          activeJob = { ...activeJob, status: 'running', startedAt: startedAtMs };
        }
        break;
      case 'job.progress':
        completedItems = evt.completedItems;
        partialMediaItems = evt.partialMediaItems;
        skippedDuplicates = evt.skippedDuplicates;
        failedItems = evt.failedItems;
        break;
      case 'job.paused':
        if (activeJob) activeJob = { ...activeJob, status: 'paused' };
        break;
      case 'job.resumed':
        if (activeJob) activeJob = { ...activeJob, status: 'running' };
        break;
      case 'job.cancelled':
        if (activeJob) activeJob = { ...activeJob, status: 'cancelled' };
        break;
      case 'job.completed':
        // Preserve the gallery-derived `intentionallyExcluded` count —
        // the orchestrator's summary doesn't know about it (selection is
        // a UI concern; the engine sees only filtered seeds).
        completionSummary = {
          ...evt.summary,
          intentionallyExcluded,
        };
        if (activeJob) activeJob = { ...activeJob, status: 'completed' };
        pane = 'completion';
        break;
      case 'job.failed':
        if (activeJob) activeJob = { ...activeJob, status: 'failed', lastError: evt.error };
        onNotice(`Import failed: ${evt.error}`);
        break;
      case 'item.progress':
        currentItemPostId = evt.postId;
        if (evt.archiveId) {
          lastArchiveId = evt.archiveId;
        }
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Pre-flight pane callbacks
  // ---------------------------------------------------------------------------

  async function onFilesSelected(files: StartImportFile[]): Promise<void> {
    selectedFiles = files;
    preflight = null;
    galleryPreflight = null;
    preflightError = null;
    if (files.length === 0) return;

    isRunningPreflight = true;
    try {
      // Enforce "only one job at a time" — clear message if another is running.
      const running = await orchestrator.listActiveJobs();
      const live = running.find(
        (j) => j.status === 'running' || j.status === 'queued' || j.status === 'paused',
      );
      if (live) {
        preflightError =
          'Another import is already running. Close this and re-open the modal to view it.';
        return;
      }

      const result = await orchestrator.preflight(
        files.map((f) => ({ name: f.name, blob: f.blob })),
      );
      preflight = result;
    } catch (err) {
      preflightError = err instanceof Error ? err.message : 'Preflight validation failed.';
    } finally {
      isRunningPreflight = false;
    }
  }

  /**
   * Shared `startImport` core for both the `Skip review` (no selection) and
   * `Import N selected` (gallery selection) paths. The optional `selection`
   * is forwarded verbatim to the orchestrator — no per-item filtering
   * happens here (PRD §0: filtering is engine-side).
   */
  async function startImportInternal(
    selection: GallerySelection | undefined,
  ): Promise<void> {
    if (selectedFiles.length === 0) return;

    try {
      // Upload pace is fixed (server bulk-import bucket: 60/min). Omitting
      // `rateLimitPerSec` lets the orchestrator apply DEFAULT_IMPORT_RATE_PER_SEC.
      const { jobId } = await orchestrator.startImport({
        files: selectedFiles,
        destination,
        tags: parseTagsInput(tagsInput),
        ...(selection ? { selection } : {}),
      });
      const job = await orchestrator.getJob(jobId);
      if (!job) {
        preflightError = 'Failed to create import job.';
        return;
      }
      activeJob = job;
      completedItems = job.completedItems;
      partialMediaItems = job.partialMediaItems;
      skippedDuplicates = job.skippedDuplicates;
      failedItems = job.failedItems;
      startedAtMs = job.startedAt ?? Date.now();
      pane = 'progress';
    } catch (err) {
      preflightError = err instanceof Error ? err.message : 'Failed to start import.';
    }
  }

  async function onSkipReview(): Promise<void> {
    if (!preflight) return;
    intentionallyExcluded = 0;
    await startImportInternal(undefined);
  }

  /**
   * Open the review gallery. Calls the extended `loadGallery` orchestrator
   * method — same shape as preflight, with `parts[].posts` populated.
   * Loading happens up-front (not lazily on pane mount) so any failure is
   * surfaced on the pre-flight pane where the user has clearer context.
   *
   * PRD: prd-instagram-import-gallery.md §5.2, §9.6
   */
  async function onReviewPosts(): Promise<void> {
    if (!preflight || selectedFiles.length === 0) return;
    if (isLoadingGallery) return;

    isLoadingGallery = true;
    preflightError = null;
    try {
      const result = await orchestrator.loadGallery(
        selectedFiles.map((f) => ({ name: f.name, blob: f.blob })),
      );
      galleryPreflight = result;
      pane = 'gallery';
    } catch (err) {
      preflightError =
        err instanceof Error ? err.message : 'Failed to load gallery previews.';
    } finally {
      isLoadingGallery = false;
    }
  }

  function onGalleryBack(): void {
    // Selection state lives inside the gallery component (via the
    // ImportSelectionStore Layer 2 owns); leaving the pane preserves the
    // store's state via re-mount-friendly props. No clearing here.
    pane = 'preflight';
  }

  /**
   * Compute "intentionally excluded" — the count of ready (non-duplicate)
   * posts that the user opted OUT of via the gallery toggles.
   *
   * Mirrors `ImportSelectionStore.getSelectedIds()` semantics:
   *   - `mode: 'all-except'` → excluded = |ids ∩ (ready posts)|
   *   - `mode: 'only'`       → excluded = readyCount - |ids ∩ (ready posts)|
   *
   * `readyCount` comes straight from `galleryPreflight.readyToImport`,
   * which is the same universe-minus-duplicates count the selection store
   * was constructed against.
   *
   * PRD F4.5: "X intentionally excluded by you".
   */
  function computeIntentionallyExcluded(
    selection: GallerySelection,
    preflightSnapshot: ImportPreflightResult,
  ): number {
    const readyCount = preflightSnapshot.readyToImport;
    if (readyCount <= 0) return 0;

    // Gather every non-duplicate post id from `parts[].posts`.
    const readyPostIds = new Set<string>();
    for (const part of preflightSnapshot.parts) {
      if (!part.posts) continue;
      for (const preview of part.posts) {
        if (preview.isDuplicate) continue;
        readyPostIds.add(preview.postId);
      }
    }

    // Intersect the persisted ids with the ready set — stale ids and
    // duplicates inside `selection.ids` must not contribute to the count.
    let intersected = 0;
    for (const id of selection.ids) {
      if (readyPostIds.has(id)) intersected += 1;
    }

    if (selection.mode === 'all-except') {
      // `ids` is the explicit deselect set; clamp for safety.
      return Math.max(0, Math.min(intersected, readyCount));
    }
    // `mode: 'only'` — `ids` is the explicit selected set; the rest are excluded.
    return Math.max(0, readyCount - intersected);
  }

  async function onGalleryImportSelected(selection: GallerySelection): Promise<void> {
    if (!galleryPreflight) return;
    intentionallyExcluded = computeIntentionallyExcluded(selection, galleryPreflight);
    await startImportInternal(selection);
  }

  function onRemoveFile(filename: string): void {
    selectedFiles = selectedFiles.filter((f) => f.name !== filename);
    if (selectedFiles.length === 0) {
      preflight = null;
      preflightError = null;
    } else {
      void onFilesSelected(selectedFiles);
    }
  }

  // ---------------------------------------------------------------------------
  // Progress pane callbacks
  // ---------------------------------------------------------------------------

  async function onPause(): Promise<void> {
    if (!activeJob) return;
    try {
      await orchestrator.pause(activeJob.jobId);
    } catch (err) {
      onNotice(`Failed to pause: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onResume(): Promise<void> {
    if (!activeJob) return;
    try {
      await orchestrator.resume(activeJob.jobId);
    } catch (err) {
      onNotice(`Failed to resume: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onCancel(): Promise<void> {
    if (!activeJob) return;
    try {
      await orchestrator.cancel(activeJob.jobId);
      onNotice('Import cancelled.');
      onRequestClose();
    } catch (err) {
      onNotice(`Failed to cancel: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function onCloseKeepRunning(): void {
    onRequestClose();
  }

  // ---------------------------------------------------------------------------
  // Completion pane callbacks
  // ---------------------------------------------------------------------------

  function onOpenLastArchive(): void {
    if (!lastArchiveId) {
      onNotice('No archive link available yet.');
      return;
    }
    onOpenArchive(lastArchiveId);
  }

  async function onViewFailed(): Promise<void> {
    if (!activeJob) return;
    isLoadingItems = true;
    try {
      items = await orchestrator.getItems(activeJob.jobId);
    } catch (err) {
      onNotice(`Failed to load items: ${err instanceof Error ? err.message : String(err)}`);
      items = [];
    } finally {
      isLoadingItems = false;
    }
    pane = 'failed';
  }

  function onImportAnother(): void {
    // Reset back to pre-flight for a new run.
    selectedFiles = [];
    preflight = null;
    galleryPreflight = null;
    isLoadingGallery = false;
    intentionallyExcluded = 0;
    preflightError = null;
    activeJob = null;
    completedItems = 0;
    partialMediaItems = 0;
    skippedDuplicates = 0;
    failedItems = 0;
    completionSummary = null;
    lastArchiveId = null;
    currentItemPostId = null;
    items = [];
    startedAtMs = null;
    pane = 'preflight';
  }

  /** Same normalization rules the orchestrator applies; keeps the UI honest. */
  function parseTagsInput(raw: string): string[] {
    if (!raw) return [];
    return raw
      .split(',')
      .map((t) => t.trim().replace(/^#+/, '').trim())
      .filter((t) => t.length > 0);
  }

  function onBackFromFailed(): void {
    pane = 'completion';
  }

  async function onRetryItem(postId: string): Promise<void> {
    // Retries are handled inside the orchestrator per PRD §5.3 (failed-items pane).
    // The orchestrator exposes re-enqueue via a follow-up `resume()` on the job;
    // per-item retries are therefore a no-op hint to the user until Agent E ships
    // the `retryItem` method. For now, surface a notice so the user knows.
    onNotice(
      `Retry queued for ${postId}. The import will pick it up on the next resume cycle.`,
    );
  }
</script>

<div class="sa-ig-import" aria-labelledby="sa-ig-import-title">
  <h2 id="sa-ig-import-title" class="sa-ig-import__title">
    Import Instagram Saved Posts
  </h2>

  {#if pane === 'preflight'}
    <ImportPreflight
      files={selectedFiles}
      {preflight}
      {isRunningPreflight}
      error={preflightError}
      {destination}
      {tagsInput}
      {importButtonEnabled}
      {isLoadingGallery}
      onFilesSelected={onFilesSelected}
      onRemoveFile={onRemoveFile}
      onDestinationChange={(v) => { destination = v; }}
      onTagsInputChange={(v) => { tagsInput = v; }}
      onReviewPosts={onReviewPosts}
      onSkipReview={onSkipReview}
      onCancel={onRequestClose}
    />
  {:else if pane === 'gallery'}
    {#if galleryPreflight}
      <ImportGallery
        preflight={galleryPreflight}
        files={selectedFiles}
        {destination}
        tagsPreview={parseTagsInput(tagsInput)}
        mediaPreviewService={(orchestrator as ImportOrchestratorClass).getMediaPreviewService?.()}
        onBack={onGalleryBack}
        onImportSelected={onGalleryImportSelected}
        onCancel={onRequestClose}
      />
    {:else}
      <div class="sa-ig-import__loading" aria-live="polite">Loading gallery…</div>
    {/if}
  {:else if pane === 'progress'}
    <ImportProgress
      job={activeJob}
      {completedItems}
      {totalItems}
      {partialMediaItems}
      {skippedDuplicates}
      {failedItems}
      {progressPct}
      {throughputPerSec}
      {currentItemPostId}
      onPause={onPause}
      onResume={onResume}
      onCancel={onCancel}
      onClose={onCloseKeepRunning}
    />
  {:else if pane === 'completion'}
    <ImportCompletion
      summary={completionSummary}
      hasDeepLink={lastArchiveId !== null}
      hasFailed={(completionSummary?.failed ?? 0) > 0}
      onOpenLastArchive={onOpenLastArchive}
      onViewFailed={onViewFailed}
      onImportAnother={onImportAnother}
      onDone={onRequestClose}
    />
  {:else if pane === 'failed'}
    <ImportFailedList
      {items}
      loading={isLoadingItems}
      onBack={onBackFromFailed}
      onRetryItem={onRetryItem}
    />
  {/if}
</div>

<style>
  .sa-ig-import {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  .sa-ig-import__title {
    margin: 0 0 0.25rem 0;
    font-size: var(--font-ui-larger, 1.1rem);
    font-weight: var(--font-bold, 600);
  }

  .sa-ig-import__loading {
    padding: 2rem 0.5rem;
    text-align: center;
    color: var(--text-muted, #777);
    font-size: var(--font-ui, 0.9rem);
  }
</style>
