import { describe, expect, it } from 'vitest';
import { cliExecutorConfigDir, vaultExecutorKey } from '../../../plugin/executor/cliExecutorConfigDir';

describe('cliExecutorConfigDir', () => {
  it('lives under the OS app-data directory, never inside the vault', () => {
    expect(cliExecutorConfigDir({ platform: 'darwin', homedir: '/Users/me', env: {}, vaultKey: 'v1' })).toBe(
      '/Users/me/Library/Application Support/obsidian-social-archiver/cli-executor/v1',
    );
    expect(cliExecutorConfigDir({ platform: 'win32', homedir: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, vaultKey: 'v1' })).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\obsidian-social-archiver\\cli-executor\\v1',
    );
    expect(cliExecutorConfigDir({ platform: 'win32', homedir: 'C:\\Users\\me', env: {}, vaultKey: 'v1' })).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\obsidian-social-archiver\\cli-executor\\v1',
    );
    expect(cliExecutorConfigDir({ platform: 'linux', homedir: '/home/me', env: { XDG_CONFIG_HOME: '/xdg' }, vaultKey: 'v1' })).toBe(
      '/xdg/obsidian-social-archiver/cli-executor/v1',
    );
    expect(cliExecutorConfigDir({ platform: 'linux', homedir: '/home/me', env: {}, vaultKey: 'v1' })).toBe(
      '/home/me/.config/obsidian-social-archiver/cli-executor/v1',
    );
  });
});

describe('vaultExecutorKey', () => {
  it('uses the sync client id when the vault has one', () => {
    expect(vaultExecutorKey('My Vault', 'client_abc')).toBe('client_abc');
  });

  it('derives a slug plus hash otherwise, distinct per name', () => {
    const a = vaultExecutorKey('My Vault', '');
    const b = vaultExecutorKey('My Vault 2', null);
    expect(a).toMatch(/^My-Vault-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(vaultExecutorKey('///', undefined)).toMatch(/^vault-[0-9a-f]{8}$/);
  });
});
