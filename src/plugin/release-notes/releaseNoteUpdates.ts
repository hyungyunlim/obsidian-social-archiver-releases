/**
 * "What's new" after a plugin update, read from the release hub — the same
 * entries, in the same order, that the mobile and desktop apps page through.
 * `src/release-notes.ts` is no longer shown in-app; it only fills the GitHub
 * release body.
 *
 * Contract: share-web `src/lib/server/releaseNoteUpdates.ts`.
 */

import { requestUrl } from 'obsidian';

const UPDATES_URL = 'https://social-archive.org/release-notes/obsidian/updates.json';

export type ReleaseNoteLocale = 'en' | 'ko' | 'ja';

export interface ReleaseNoteUpdate {
  id: string;
  version: string;
  dateLabel: string;
  title: string;
  summary: string;
  highlights: string[];
  important: boolean;
  /** This entry on the hub page. */
  url: string;
}

export interface ReleaseNoteUpdates {
  /** Oldest → newest; the modal opens on the last one. */
  entries: ReleaseNoteUpdate[];
  /** What to record as seen once `entries` were shown (null: nothing). */
  seenThrough: string | null;
}

export interface ReleaseNoteUpdatesQuery {
  from?: string;
  to: string;
  locale: ReleaseNoteLocale;
}

export function toReleaseNoteLocale(language: string): ReleaseNoteLocale {
  const lang = language.toLowerCase();
  return lang.startsWith('ko') ? 'ko' : lang.startsWith('ja') ? 'ja' : 'en';
}

/** Null when offline or the hub answers with anything unexpected. */
export async function fetchReleaseNoteUpdates(
  query: ReleaseNoteUpdatesQuery
): Promise<ReleaseNoteUpdates | null> {
  const params = new URLSearchParams({ to: query.to, lang: query.locale });
  if (query.from) params.set('from', query.from);

  try {
    const response = await requestUrl({ url: `${UPDATES_URL}?${params.toString()}`, throw: false });
    if (response.status !== 200) return null;
    const body = response.json as Partial<ReleaseNoteUpdates> | null;
    if (!Array.isArray(body?.entries)) return null;
    return {
      entries: body.entries.filter(
        (entry) => typeof entry?.title === 'string' && Array.isArray(entry.highlights)
      ),
      seenThrough: typeof body.seenThrough === 'string' ? body.seenThrough : null,
    };
  } catch {
    return null;
  }
}

export interface ReleaseNotesCheck {
  currentVersion: string;
  lastSeenVersion: string;
  /** Settings → "Show release notes after updates". */
  enabled: boolean;
  /** Debug: show the running version's notes on every load. */
  alwaysShow: boolean;
  locale: ReleaseNoteLocale;
  fetchUpdates: (query: ReleaseNoteUpdatesQuery) => Promise<ReleaseNoteUpdates | null>;
  saveLastSeen: (version: string) => Promise<void>;
  show: (entries: ReleaseNoteUpdate[], onClose: () => void) => void;
}

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

export async function checkReleaseNotes(check: ReleaseNotesCheck): Promise<void> {
  const { currentVersion, lastSeenVersion, locale } = check;

  // Staging builds (`1.0.3-staging`) have no hub entries.
  if (!RELEASE_VERSION.test(currentVersion)) return;

  if (check.alwaysShow) {
    const updates = await check.fetchUpdates({ to: currentVersion, locale });
    if (updates?.entries.length) check.show(updates.entries, () => {});
    return;
  }

  if (currentVersion === lastSeenVersion) return;

  // A fresh install has nothing to catch up on.
  if (!lastSeenVersion || !check.enabled) {
    await check.saveLastSeen(currentVersion);
    return;
  }

  // A staging version recorded by an older build would be rejected by the hub
  // forever; treat it as "nothing recorded" (the running version's notes).
  const from = RELEASE_VERSION.test(lastSeenVersion) ? lastSeenVersion : undefined;
  const updates = await check.fetchUpdates({ from, to: currentVersion, locale });
  // Offline: keep lastSeenVersion so the next load tries again.
  if (!updates) return;

  const { entries, seenThrough } = updates;
  if (entries.length === 0) {
    if (seenThrough) await check.saveLastSeen(seenThrough);
    return;
  }

  check.show(entries, () => {
    void check.saveLastSeen(seenThrough ?? currentVersion);
  });
}
