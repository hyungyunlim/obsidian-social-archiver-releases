<script lang="ts">
  /**
   * Today's review in the Obsidian side panel — one card at a time, like the
   * apps, but the note is the card's back: "Open note" goes to the archive in
   * this vault. A recall question hides its answer until asked.
   *
   * Renders `ReviewSession` states and nothing else; every step goes through
   * the session so the logic stays testable without a DOM.
   */
  import { onMount } from 'svelte';
  import { t } from '../../i18n';
  import type { ReviewArchiveLabel, ReviewCardUnit } from '../../services/learning/LearningReviewClient';
  import type { PanelState } from '../../services/learning/ReviewSession';
  import { bylineOf, nameOf } from './reviewLabels';
  import type { ReviewPanelProps } from './types';

  let { session, initialDay, hasNote, openArchive, openSettings, turnOn, onchange }: ReviewPanelProps = $props();

  let panel = $state<PanelState>({ kind: 'loading' });
  let revealed = $state(false);
  let busy = $state(false);

  function show(next: PanelState): void {
    panel = next;
    revealed = false;
    onchange?.(next);
  }

  /** Called by the view when a link opens the panel on a given day. */
  export async function reload(day?: string): Promise<void> {
    show({ kind: 'loading' });
    show(await session.load(day));
  }

  onMount(() => {
    void reload(initialDay);
  });

  async function next(): Promise<void> {
    if (panel.kind !== 'active' || busy) return;
    busy = true;
    try {
      show(await session.advance(panel));
    } finally {
      busy = false;
    }
  }

  function previous(): void {
    if (panel.kind === 'active' || panel.kind === 'done') show(session.back(panel));
  }

  async function enable(): Promise<void> {
    busy = true;
    try {
      await turnOn();
      await reload();
    } finally {
      busy = false;
    }
  }

  /** One row per post: a post and its highlights are one thing to reopen. */
  function finishedList(units: readonly ReviewCardUnit[]): ReviewCardUnit[] {
    const seen = new Set<string>();
    return units.filter((unit) => {
      if (seen.has(unit.archiveId)) return false;
      seen.add(unit.archiveId);
      return true;
    });
  }

  function canOpen(archiveId: string, label: ReviewArchiveLabel | undefined): boolean {
    return hasNote(archiveId) || Boolean(label?.originalUrl);
  }
</script>

<div class="sa-review">
  <header class="sa-review-header">
    <span class="sa-review-title">{t('rv.title')}</span>
    {#if panel.kind === 'active'}
      <span class="sa-review-progress">{t('rv.progress', { index: panel.index + 1, total: panel.units.length })}</span>
    {/if}
    {#if (panel.kind === 'active' || panel.kind === 'done') && panel.streak > 0}
      <span class="sa-review-streak">{t('rv.streak', { count: panel.streak })}</span>
    {/if}
  </header>

  {#if panel.kind === 'loading'}
    <p class="sa-review-message">{t('rv.loading')}</p>
  {:else if panel.kind === 'signed-out'}
    <p class="sa-review-message">{t('rv.signedOut')}</p>
    <button type="button" onclick={openSettings}>{t('rv.openSettings')}</button>
  {:else if panel.kind === 'off'}
    <p class="sa-review-message">{t('rv.off')}</p>
    <button type="button" class="mod-cta" disabled={busy} onclick={() => void enable()}>{t('rv.turnOn')}</button>
  {:else if panel.kind === 'empty'}
    <p class="sa-review-message">{t('rv.empty')}</p>
  {:else if panel.kind === 'error'}
    <p class="sa-review-message">{t('rv.error')}</p>
    <button type="button" onclick={() => void reload()}>{t('rv.retry')}</button>
  {:else if panel.kind === 'active'}
    {@const unit = panel.units[panel.index]}
    {#if unit}
      {@const label = panel.archives[unit.archiveId]}
      {@const byline = bylineOf(label)}
      <article class="sa-review-card">
        {#if byline}
          <div class="sa-review-byline">{byline}</div>
        {/if}
        {#if label?.title}
          <div class="sa-review-card-title">{label.title}</div>
        {/if}

        {#if unit.question}
          <div class="sa-review-kicker">{t('rv.recall')}</div>
          <p class="sa-review-question">{unit.question}</p>
          {#if revealed}
            <p class="sa-review-text">{unit.text}</p>
          {:else}
            <button type="button" class="sa-review-reveal" onclick={() => (revealed = true)}>{t('rv.reveal')}</button>
          {/if}
        {:else}
          {#if unit.kind === 'highlight'}
            <div class="sa-review-kicker">{t('rv.highlight')}</div>
          {/if}
          <p class="sa-review-text" class:is-highlight={unit.kind === 'highlight'}>{unit.text}</p>
        {/if}
        {#if unit.note && (revealed || !unit.question)}
          <p class="sa-review-note">{unit.note}</p>
        {/if}

        <div class="sa-review-card-actions">
          {#if hasNote(unit.archiveId)}
            <button type="button" onclick={() => openArchive(unit.archiveId, label)}>{t('rv.openNote')}</button>
          {:else if label?.originalUrl}
            <button type="button" onclick={() => openArchive(unit.archiveId, label)}>{t('rv.openOriginal')}</button>
          {/if}
        </div>
      </article>
    {/if}

    <div class="sa-review-nav">
      <button type="button" disabled={panel.index === 0 || busy} onclick={previous}>{t('rv.previous')}</button>
      <button type="button" class="mod-cta" disabled={busy} onclick={() => void next()}>
        {panel.index + 1 === panel.units.length ? t('rv.finish') : t('rv.next')}
      </button>
    </div>
  {:else if panel.kind === 'done'}
    {@const archives = panel.archives}
    <section class="sa-review-done">
      <div class="sa-review-done-title">{t('rv.doneTitle')}</div>
      <div class="sa-review-kicker">{t('rv.todayList')}</div>
      <ul class="sa-review-list">
        {#each finishedList(panel.units) as unit (unit.archiveId)}
          <li>
            <button
              type="button"
              class="sa-review-list-item"
              disabled={!canOpen(unit.archiveId, archives[unit.archiveId])}
              onclick={() => openArchive(unit.archiveId, archives[unit.archiveId])}
            >
              {nameOf(unit, archives[unit.archiveId])}
            </button>
          </li>
        {/each}
      </ul>
      <button type="button" onclick={previous}>{t('rv.previous')}</button>
    </section>
  {/if}
</div>
