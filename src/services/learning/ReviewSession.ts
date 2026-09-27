/**
 * ReviewSession — what the review panel shows, and what each step does.
 *
 * Returns plain state objects; the Svelte panel only renders them. Progress is
 * the same `{ day, index }` cursor the desktop keeps: local to this vault, never
 * synced (prd-learning-review §18 G-J), so another device starts the same set
 * from the top. Finishing the set records the session, which is what moves the
 * streak the apps show.
 */

import {
  LearningReviewError,
  type LearningReviewClient,
  type ReviewArchiveLabel,
  type ReviewCardUnit,
} from './LearningReviewClient';

export interface DeckProgress {
  day: string;
  index: number;
}

/** Where the cursor survives restarts — `app.loadLocalStorage` in the plugin. */
export interface ProgressStore {
  read(): unknown;
  write(progress: DeckProgress): void;
}

interface Deck {
  day: string;
  units: ReviewCardUnit[];
  archives: Record<string, ReviewArchiveLabel>;
  streak: number;
}

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'off' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; day: string }
  | ({ kind: 'active'; index: number } & Deck)
  | ({ kind: 'done' } & Deck);

export interface ReviewSessionDeps {
  client: Pick<LearningReviewClient, 'getToday' | 'getStatus' | 'recordSession'>;
  signedIn: () => boolean;
  progress: ProgressStore;
}

/** The device's local calendar day — the key the apps use for "today". */
export function localDay(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${date}`;
}

/** The stored cursor for `day`, clamped to the set; anything else starts over. */
export function resumeIndex(stored: unknown, day: string, total: number): number {
  const progress = stored as Partial<DeckProgress> | null;
  if (!progress || progress.day !== day || typeof progress.index !== 'number') return 0;
  return Math.min(Math.max(Math.floor(progress.index), 0), total);
}

function deckOf(state: Deck): Deck {
  return { day: state.day, units: state.units, archives: state.archives, streak: state.streak };
}

/** Cards still to see today — the status-bar count. */
export function remainingCards(state: PanelState): number {
  return state.kind === 'active' ? state.units.length - state.index : 0;
}

export class ReviewSession {
  constructor(private readonly deps: ReviewSessionDeps) {}

  async load(day: string = localDay()): Promise<PanelState> {
    if (!this.deps.signedIn()) return { kind: 'signed-out' };
    try {
      const [today, status] = await Promise.all([
        this.deps.client.getToday(day),
        this.deps.client.getStatus(),
      ]);
      if (!status.enabled) return { kind: 'off' };
      if (today.units.length === 0) return { kind: 'empty', day: today.day };
      const deck: Deck = { day: today.day, units: today.units, archives: today.archives, streak: status.streak };
      const index = resumeIndex(this.deps.progress.read(), today.day, today.units.length);
      return index >= today.units.length ? { kind: 'done', ...deck } : { kind: 'active', index, ...deck };
    } catch (error) {
      if (error instanceof LearningReviewError) {
        if (error.isReviewOff) return { kind: 'off' };
        if (error.code === 'UNAUTHENTICATED' || error.status === 401) return { kind: 'signed-out' };
      }
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Next card; passing the last one finishes the day and records the session. */
  async advance(state: Extract<PanelState, { kind: 'active' }>): Promise<PanelState> {
    const index = state.index + 1;
    this.deps.progress.write({ day: state.day, index });
    if (index < state.units.length) return { ...state, index };

    try {
      const streak = await this.deps.client.recordSession(state.day, state.units.length);
      return { kind: 'done', ...deckOf(state), streak };
    } catch {
      // Recorded next time the day is finished; the cards were still seen.
      return { kind: 'done', ...deckOf(state) };
    }
  }

  /** Step back one card — from the finish screen, back onto the last card. */
  back(state: Extract<PanelState, { kind: 'active' | 'done' }>): PanelState {
    const current = state.kind === 'active' ? state.index : state.units.length;
    const index = Math.max(current - 1, 0);
    this.deps.progress.write({ day: state.day, index });
    return { kind: 'active', index, ...deckOf(state) };
  }
}
