<script lang="ts">
  /**
   * Today's review — one card at a time, and the card is the timeline's card.
   *
   * A unit whose archive is in this vault renders through the timeline's own
   * card (author, caption, picture, counts) and opens in the timeline's reader,
   * which steps through the rest of today's posts. A card asks before it tells
   * (reviewCardMode): a recall question, or the post's picture, comes first;
   * the words stay covered until asked. An archive that is not in this vault
   * falls back to the server's text.
   *
   * Renders `ReviewSession` states and nothing else; every step goes through
   * the session so the logic stays testable without a DOM.
   */
  import { onMount } from 'svelte';
  import { t } from '../../i18n';
  import type { ReviewArchiveLabel, ReviewCardUnit } from '../../services/learning/LearningReviewClient';
  import type { PanelState } from '../../services/learning/ReviewSession';
  import type { PostData } from '../../types/post';
  import { coversAnswer, reviewCardMode } from './reviewCardMode';
  import { bylineOf, nameOf } from './reviewLabels';
  import type { ReviewPanelProps } from './types';

  let { session, cards, initialDay, hasNote, openArchive, openSettings, turnOn, onchange }: ReviewPanelProps =
    $props();

  let panel = $state<PanelState>({ kind: 'loading' });
  let revealed = $state(false);
  let busy = $state(false);

  function show(next: PanelState): void {
    panel = next;
    revealed = false;
    // Read today's notes up front so stepping between cards never waits.
    if (next.kind === 'active') for (const archiveId of todaysArchives(next.units)) void cards.postFor(archiveId);
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

  /** Draws the timeline card into the node; a new post redraws it. */
  function timelineCard(node: HTMLElement, post: PostData) {
    void cards.renderCard(node, post);
    return {
      update(next: PostData) {
        void cards.renderCard(node, next);
      },
    };
  }

  function todaysArchives(units: readonly ReviewCardUnit[]): string[] {
    return [...new Set(units.map((unit) => unit.archiveId))];
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

  /** The reader when the post is in this vault, else the note or the original. */
  async function reopen(
    units: readonly ReviewCardUnit[],
    archiveId: string,
    label: ReviewArchiveLabel | undefined,
  ): Promise<void> {
    if (await cards.postFor(archiveId)) {
      await cards.openReader(todaysArchives(units), archiveId);
    } else {
      openArchive(archiveId, label);
    }
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
    {@const units = panel.units}
    {#if unit}
      {@const label = panel.archives[unit.archiveId]}
      {#await cards.postFor(unit.archiveId) then post}
        {@const mode = reviewCardMode(unit, post)}
        {@const covered = coversAnswer(mode) && !revealed}
        <article class="sa-review-card">
          {#if mode === 'question' || mode === 'image'}
            <div class="sa-review-prompt">
              <div class="sa-review-kicker">{t('rv.recall')}</div>
              <p class="sa-review-question">{mode === 'question' ? unit.question : t('rv.recallImage')}</p>
            </div>
          {:else if mode === 'highlight'}
            <blockquote class="sa-review-quote">
              <div class="sa-review-kicker">{t('rv.highlight')}</div>
              <p class="sa-review-text">{unit.text}</p>
              {#if unit.note}
                <p class="sa-review-note">{unit.note}</p>
              {/if}
            </blockquote>
          {/if}

          {#if post}
            <div class="sa-review-post" class:is-covered={covered} use:timelineCard={post}></div>
          {:else}
            {@const byline = bylineOf(label)}
            <div class="sa-review-fallback">
              {#if byline}
                <div class="sa-review-byline">{byline}</div>
              {/if}
              {#if label?.title}
                <div class="sa-review-card-title">{label.title}</div>
              {/if}
              {#if mode === 'open'}
                <p class="sa-review-text">{unit.text}</p>
              {/if}
            </div>
          {/if}

          {#if covered}
            <button type="button" class="sa-review-reveal mod-cta" onclick={() => (revealed = true)}>
              {t('rv.reveal')}
            </button>
          {:else if mode === 'question'}
            <div class="sa-review-answer">
              <div class="sa-review-kicker">{t('rv.gist')}</div>
              <p class="sa-review-text">{unit.text}</p>
            </div>
          {/if}

          <div class="sa-review-card-actions">
            {#if post}
              <button type="button" onclick={() => void cards.openReader(todaysArchives(units), unit.archiveId)}>
                {t('rv.openReader')}
              </button>
            {/if}
            {#if hasNote(unit.archiveId)}
              <button type="button" onclick={() => openArchive(unit.archiveId, label)}>{t('rv.openNote')}</button>
            {:else if label?.originalUrl}
              <button type="button" onclick={() => openArchive(unit.archiveId, label)}>{t('rv.openOriginal')}</button>
            {/if}
          </div>
        </article>
      {/await}
    {/if}

    <div class="sa-review-nav">
      <button type="button" disabled={panel.index === 0 || busy} onclick={previous}>{t('rv.previous')}</button>
      <button type="button" class="mod-cta" disabled={busy} onclick={() => void next()}>
        {panel.index + 1 === panel.units.length ? t('rv.finish') : t('rv.next')}
      </button>
    </div>
  {:else if panel.kind === 'done'}
    {@const archives = panel.archives}
    {@const units = panel.units}
    <section class="sa-review-done">
      <div class="sa-review-done-title">{t('rv.doneTitle')}</div>
      <div class="sa-review-kicker">{t('rv.todayList')}</div>
      <ul class="sa-review-list">
        {#each finishedList(units) as unit (unit.archiveId)}
          <li>
            <button
              type="button"
              class="sa-review-list-item"
              disabled={!canOpen(unit.archiveId, archives[unit.archiveId])}
              onclick={() => void reopen(units, unit.archiveId, archives[unit.archiveId])}
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
