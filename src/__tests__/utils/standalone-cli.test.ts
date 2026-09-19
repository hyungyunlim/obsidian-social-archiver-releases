import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_BUNDLE_CLI_PATH,
  StandaloneCliDetector,
  cliCandidates,
  compareVersions,
  parseCliVersion,
  parseProvidersOutput,
  type ShellExec,
} from '../../utils/standalone-cli';

vi.mock('obsidian', () => ({ Platform: { isMobile: false, isDesktop: true } }));

type Script = Record<string, { stdout?: string; stderr?: string; fail?: boolean }>;

function scriptedExec(script: Script, calls: string[] = []): ShellExec {
  return async (command) => {
    calls.push(command);
    const entry = script[command];
    if (!entry || entry.fail) throw new Error(`command failed: ${command}`);
    return { stdout: entry.stdout ?? '', stderr: entry.stderr ?? '' };
  };
}

const base = { platform: 'darwin' as const, homedir: '/Users/me', env: { PATH: '/usr/bin' }, exists: () => false };

describe('StandaloneCliDetector', () => {
  beforeEach(() => StandaloneCliDetector.resetCache());

  const brew = '/opt/homebrew/bin/social-archiver';
  const local = '/Users/me/.local/bin/social-archiver';

  it('finds the CLI on the extended PATH and reads its version', async () => {
    const calls: string[] = [];
    const exec = scriptedExec({ [`"${brew}" --version`]: { stdout: 'social-archiver 0.1.15\n' } }, calls);
    const result = await StandaloneCliDetector.detect({ ...base, exec, exists: (path) => path === brew });
    expect(result).toEqual({ available: true, path: brew, version: '0.1.15', supported: true });
    expect(calls).toEqual([`"${brew}" --version`]);
  });

  it('keeps the newest install when several are on PATH', async () => {
    // A stale Homebrew copy sits ahead of ~/.local/bin on the extended PATH.
    const exec = scriptedExec({
      [`"${brew}" --version`]: { stdout: 'social-archiver 0.1.7\n' },
      [`"${local}" --version`]: { stdout: 'social-archiver 0.1.15\n' },
    });
    const result = await StandaloneCliDetector.detect({ ...base, exec, exists: (path) => path === brew || path === local });
    expect(result).toEqual({ available: true, path: local, version: '0.1.15', supported: true });
  });

  it('runs the probe with a PATH that includes Homebrew and ~/.local/bin', async () => {
    let seenPath = '';
    const exec: ShellExec = async (_command, options) => {
      seenPath = options.env.PATH ?? '';
      return { stdout: 'social-archiver 0.1.15', stderr: '' };
    };
    await StandaloneCliDetector.detect({ ...base, exec, exists: (path) => path === brew });
    expect(seenPath).toContain('/opt/homebrew/bin');
    expect(seenPath).toContain('/Users/me/.local/bin');
    expect(seenPath).toContain('/usr/bin');
  });

  it('uses only the settings override and marks older CLIs unsupported', async () => {
    const calls: string[] = [];
    const exec = scriptedExec(
      {
        '"/custom/social-archiver" --version': { stdout: 'social-archiver 0.1.9\n' },
        [`"${brew}" --version`]: { stdout: 'social-archiver 0.1.15\n' },
      },
      calls,
    );
    const result = await StandaloneCliDetector.detect({ ...base, exec, exists: (path) => path === brew, overridePath: '/custom/social-archiver' });
    expect(result).toEqual({ available: true, path: "/custom/social-archiver", version: "0.1.9", supported: false });
    expect(calls).toEqual(['"/custom/social-archiver" --version']);
  });

  it('reports a wrong override as not found instead of another binary', async () => {
    const exec = scriptedExec({ [`"${brew}" --version`]: { stdout: 'social-archiver 0.1.15\n' } });
    const result = await StandaloneCliDetector.detect({ ...base, exec, exists: (path) => path === brew, overridePath: '/typo/social-archiver' });
    expect(result.available).toBe(false);
  });

  it('falls back to the desktop bundle CLI on macOS', async () => {
    const exec = scriptedExec({ [`"${DESKTOP_BUNDLE_CLI_PATH}" --version`]: { stdout: 'social-archiver 0.1.15' } });
    const result = await StandaloneCliDetector.detect({ ...base, exec, exists: (path) => path === DESKTOP_BUNDLE_CLI_PATH });
    expect(result.available).toBe(true);
    expect(result.path).toBe(DESKTOP_BUNDLE_CLI_PATH);
  });

  it('reports unavailable when nothing answers --version', async () => {
    const exec = scriptedExec({});
    await expect(StandaloneCliDetector.detect({ ...base, exec })).resolves.toEqual({
      available: false,
      path: null,
      version: null,
      supported: false,
    });
  });

  it('looks for .exe and .cmd shims on Windows', async () => {
    const store = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\social-archiver.exe';
    const exec = scriptedExec({ [`"${store}" --version`]: { stdout: 'social-archiver 0.1.15\r\n' } });
    const result = await StandaloneCliDetector.detect({
      platform: 'win32',
      homedir: 'C:\\Users\\me',
      env: { PATH: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps' },
      exists: (path) => path === store,
      exec,
    });
    expect(result).toEqual({ available: true, path: store, version: '0.1.15', supported: true });
    expect(cliCandidates('win32', 'C:\\a;C:\\b\\', (path) => path.endsWith('.cmd'))).toEqual([
      'C:\\a\\social-archiver.cmd',
      'C:\\b\\social-archiver.cmd',
    ]);
  });

  it('caches the answer until reset', async () => {
    let probes = 0;
    const exec: ShellExec = async () => {
      probes += 1;
      return { stdout: 'social-archiver 0.1.15', stderr: '' };
    };
    const deps = { ...base, exec, exists: (path: string) => path === brew };
    await StandaloneCliDetector.detect(deps);
    await StandaloneCliDetector.detect(deps);
    expect(probes).toBe(1);
    StandaloneCliDetector.resetCache();
    await StandaloneCliDetector.detect(deps);
    expect(probes).toBe(2);
  });

  it('parses executor --providers, including the Apple on-device fields', async () => {
    const exec = scriptedExec({
      '"/opt/homebrew/bin/social-archiver" executor --providers --format json': {
        stdout:
          '{"ok":true,"command":"social-archiver:executor","version":"0.1.15","data":{"providers":[' +
          '{"id":"claude","available":true,"authenticated":true,"version":"2.1.0","path":"/opt/homebrew/bin/claude"},' +
          '{"id":"apple","available":false,"authenticated":false,"reason":"modelNotReady","contextSize":4096}]}}\n',
      },
    });
    const providers = await StandaloneCliDetector.probeProviders('/opt/homebrew/bin/social-archiver', { ...base, exec });
    expect(providers).toEqual([
      { id: 'claude', available: true, authenticated: true, version: '2.1.0', path: '/opt/homebrew/bin/claude' },
      { id: 'apple', available: false, authenticated: false, reason: 'modelNotReady', contextSize: 4096 },
    ]);
  });
});

describe('helpers', () => {
  it('parses the --version line', () => {
    expect(parseCliVersion('social-archiver 0.1.15\n')).toBe('0.1.15');
    expect(parseCliVersion('social-archiver v0.2.0')).toBe('0.2.0');
    expect(parseCliVersion('command not found')).toBeNull();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('0.1.15', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.15', '0.1.15')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
  });

  it('ignores malformed provider output', () => {
    expect(parseProvidersOutput('')).toEqual([]);
    expect(parseProvidersOutput('{"ok":false,"error":{"code":"AUTH_REQUIRED"}}')).toEqual([]);
    expect(parseProvidersOutput('not json')).toEqual([]);
  });
});
