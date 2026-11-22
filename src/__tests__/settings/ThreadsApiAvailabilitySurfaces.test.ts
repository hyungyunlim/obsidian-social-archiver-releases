import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crossPostStrings } from '../../i18n/strings/crossPost';

/**
 * While Meta has the Threads API revoked, the server answers the status call
 * with `apiAvailable: false`. The two Svelte surfaces that offer Threads API
 * features must then stop offering them.
 *
 * ponytail: source-level checks — .svelte files are not compiled under this
 * vitest config (the svelte() plugin array is spread into an object), which is
 * why every Svelte mount test is quarantined. The decision itself lives in
 * isThreadsApiAvailable(), covered behaviourally in crosspostStatus.test.ts.
 * Switch to mount tests once the config compiles .svelte files.
 */

describe('Threads API availability — Settings › Cross-Post', () => {
  const source = readFileSync('src/settings/CrossPostSettingsTab.svelte', 'utf8');

  it('reads availability from every status it applies', () => {
    expect(source).toMatch(
      /function applyStatusToState\(status: ThreadsConnectionStatus\): void \{\s*apiAvailable = isThreadsApiAvailable\(status\);/
    );
  });

  it('renders only the unavailable note, ahead of the connected and Connect branches', () => {
    const noteBranch = source.indexOf('{:else if !apiAvailable}');
    const connectedBranch = source.indexOf('{:else if isConnected}');
    const connectButton = source.indexOf('crosspost-connect-btn');

    expect(noteBranch).toBeGreaterThan(-1);
    expect(noteBranch).toBeLessThan(connectedBranch);
    expect(noteBranch).toBeLessThan(connectButton);
    expect(source.slice(noteBranch, connectedBranch)).toContain("{t('xpost.apiUnavailable')}");
  });

  it('has the note in English and Korean', () => {
    expect(crossPostStrings['xpost.apiUnavailable'].en).toBe('Posting to Threads is unavailable for now.');
    expect(crossPostStrings['xpost.apiUnavailable'].ko).toBeTruthy();
  });
});

describe('Threads API availability — post composer', () => {
  const source = readFileSync('src/components/timeline/PostComposer.svelte', 'utf8');

  it('offers the Post & Threads mode only while the API is available', () => {
    expect(source).toContain('threadsApiAvailable = isThreadsApiAvailable(status);');
    expect(source).toMatch(
      /if \(FEATURE_CROSSPOST_ENABLED && threadsApiAvailable\) \{\s*modes\.push\(\{ id: 'post\+share\+threads'/
    );
  });

  it('drops an already-selected Threads mode back to Post & Share', () => {
    expect(source).toMatch(
      /if \(!threadsApiAvailable && postMode === 'post\+share\+threads'\) \{\s*postMode = 'post\+share';/
    );
  });
});
