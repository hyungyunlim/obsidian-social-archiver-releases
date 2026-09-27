import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setRequestUrlHandler } from 'obsidian';
import {
  checkReleaseNotes,
  fetchReleaseNoteUpdates,
  toReleaseNoteLocale,
  type ReleaseNoteUpdate,
  type ReleaseNoteUpdates,
  type ReleaseNotesCheck,
} from '../releaseNoteUpdates';

function update(version: string): ReleaseNoteUpdate {
  return {
    id: `obsidian-${version.replaceAll('.', '-')}`,
    version,
    dateLabel: 'Sep 27, 2026',
    title: `Title ${version}`,
    summary: 'Summary',
    highlights: ['One'],
    important: false,
    url: `https://social-archive.org/release-notes?platform=obsidian#${version}`,
  };
}

function setup(overrides: Partial<ReleaseNotesCheck> = {}, response: ReleaseNoteUpdates | null = null) {
  const check = {
    currentVersion: '4.7.11',
    lastSeenVersion: '4.7.9',
    enabled: true,
    alwaysShow: false,
    locale: 'en',
    fetchUpdates: vi.fn(async () => response),
    saveLastSeen: vi.fn(async () => {}),
    show: vi.fn(),
    ...overrides,
  } satisfies ReleaseNotesCheck;
  return check;
}

describe('checkReleaseNotes', () => {
  it('asks the hub for everything since the last version seen and records it on close', async () => {
    const check = setup({}, { entries: [update('4.7.10'), update('4.7.11')], seenThrough: '4.7.11' });

    await checkReleaseNotes(check);

    expect(check.fetchUpdates).toHaveBeenCalledWith({ from: '4.7.9', to: '4.7.11', locale: 'en' });
    expect(check.show).toHaveBeenCalledWith([update('4.7.10'), update('4.7.11')], expect.any(Function));
    expect(check.saveLastSeen).not.toHaveBeenCalled();

    const onClose = check.show.mock.calls[0][1] as () => void;
    onClose();
    expect(check.saveLastSeen).toHaveBeenCalledWith('4.7.11');
  });

  it('records where the hub stopped when it has not published this version yet', async () => {
    const check = setup({}, { entries: [update('4.7.10')], seenThrough: '4.7.10' });

    await checkReleaseNotes(check);
    (check.show.mock.calls[0][1] as () => void)();

    expect(check.saveLastSeen).toHaveBeenCalledWith('4.7.10');
  });

  it('does nothing when the version has not changed', async () => {
    const check = setup({ lastSeenVersion: '4.7.11' });

    await checkReleaseNotes(check);

    expect(check.fetchUpdates).not.toHaveBeenCalled();
    expect(check.saveLastSeen).not.toHaveBeenCalled();
  });

  it('skips staging builds, which have no hub entries', async () => {
    const check = setup({ currentVersion: '1.0.3-staging' });

    await checkReleaseNotes(check);

    expect(check.fetchUpdates).not.toHaveBeenCalled();
    expect(check.saveLastSeen).not.toHaveBeenCalled();
  });

  it('asks for the running version only when the recorded one is a staging build', async () => {
    const check = setup(
      { lastSeenVersion: '1.0.3-staging' },
      { entries: [update('4.7.11')], seenThrough: '4.7.11' }
    );

    await checkReleaseNotes(check);

    expect(check.fetchUpdates).toHaveBeenCalledWith({ from: undefined, to: '4.7.11', locale: 'en' });
    expect(check.show).toHaveBeenCalledTimes(1);
  });

  it('records a fresh install without showing anything', async () => {
    const check = setup({ lastSeenVersion: '' });

    await checkReleaseNotes(check);

    expect(check.fetchUpdates).not.toHaveBeenCalled();
    expect(check.saveLastSeen).toHaveBeenCalledWith('4.7.11');
  });

  it('records the version silently when the modal is turned off', async () => {
    const check = setup({ enabled: false });

    await checkReleaseNotes(check);

    expect(check.fetchUpdates).not.toHaveBeenCalled();
    expect(check.saveLastSeen).toHaveBeenCalledWith('4.7.11');
  });

  it('keeps the last version seen when offline, so the next load retries', async () => {
    const check = setup({}, null);

    await checkReleaseNotes(check);

    expect(check.show).not.toHaveBeenCalled();
    expect(check.saveLastSeen).not.toHaveBeenCalled();
  });

  it('records what the hub says when there is nothing to show', async () => {
    const check = setup({}, { entries: [], seenThrough: '4.7.11' });

    await checkReleaseNotes(check);

    expect(check.show).not.toHaveBeenCalled();
    expect(check.saveLastSeen).toHaveBeenCalledWith('4.7.11');
  });

  it('shows the running version on every load in debug mode without recording it', async () => {
    const check = setup(
      { alwaysShow: true, lastSeenVersion: '4.7.11' },
      { entries: [update('4.7.11')], seenThrough: '4.7.11' }
    );

    await checkReleaseNotes(check);

    expect(check.fetchUpdates).toHaveBeenCalledWith({ to: '4.7.11', locale: 'en' });
    expect(check.show).toHaveBeenCalledTimes(1);
    (check.show.mock.calls[0][1] as () => void)();
    expect(check.saveLastSeen).not.toHaveBeenCalled();
  });
});

describe('fetchReleaseNoteUpdates', () => {
  afterEach(() => __setRequestUrlHandler(null));

  it('requests the obsidian entries in the given locale and keeps well-formed ones', async () => {
    let requested = '';
    __setRequestUrlHandler(async (params) => {
      requested = params.url;
      const json = { entries: [update('4.7.10'), { title: 'broken' }], seenThrough: '4.7.10' };
      return { status: 200, headers: {}, text: JSON.stringify(json), json, arrayBuffer: new ArrayBuffer(0) };
    });

    const result = await fetchReleaseNoteUpdates({ from: '4.7.9', to: '4.7.10', locale: 'ko' });

    const url = new URL(requested);
    expect(url.origin + url.pathname).toBe('https://social-archive.org/release-notes/obsidian/updates.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({ to: '4.7.10', lang: 'ko', from: '4.7.9' });
    expect(result).toEqual({ entries: [update('4.7.10')], seenThrough: '4.7.10' });
  });

  it('returns null on an error status or a failed request', async () => {
    __setRequestUrlHandler(async () => ({
      status: 404, headers: {}, text: '', json: null, arrayBuffer: new ArrayBuffer(0),
    }));
    expect(await fetchReleaseNoteUpdates({ to: '4.7.10', locale: 'en' })).toBeNull();

    __setRequestUrlHandler(async () => {
      throw new Error('offline');
    });
    expect(await fetchReleaseNoteUpdates({ to: '4.7.10', locale: 'en' })).toBeNull();
  });
});

describe('toReleaseNoteLocale', () => {
  it('maps Obsidian language codes onto the hub locales', () => {
    expect(toReleaseNoteLocale('ko')).toBe('ko');
    expect(toReleaseNoteLocale('ja')).toBe('ja');
    expect(toReleaseNoteLocale('zh-TW')).toBe('en');
  });
});
