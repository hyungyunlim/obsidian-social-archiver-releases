/**
 * Where the delegated CLI executor keeps its identity and pending-upload
 * stores. Deliberately OUTSIDE the vault: plugin data inside `.obsidian` is
 * carried to other machines by Obsidian Sync / iCloud, and two machines
 * sharing one `executor-identity.json` would register as the same executor.
 * Keyed per vault so two vaults on one machine get two executors.
 */
export interface ConfigDirInputs {
  platform: NodeJS.Platform;
  homedir: string;
  env: NodeJS.ProcessEnv;
  vaultKey: string;
}

const APP_DIR = 'obsidian-social-archiver';

export function cliExecutorConfigDir({ platform, homedir, env, vaultKey }: ConfigDirInputs): string {
  const join = (...parts: string[]): string => parts.join(platform === 'win32' ? '\\' : '/');
  if (platform === 'darwin') return join(homedir, 'Library', 'Application Support', APP_DIR, 'cli-executor', vaultKey);
  if (platform === 'win32') {
    const appData = env.APPDATA && env.APPDATA.length > 0 ? env.APPDATA : join(homedir, 'AppData', 'Roaming');
    return join(appData, APP_DIR, 'cli-executor', vaultKey);
  }
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(homedir, '.config');
  return join(xdg, APP_DIR, 'cli-executor', vaultKey);
}

/**
 * Stable per-vault key: the sync client id when the vault has one, else the
 * vault name reduced to a safe slug plus a short hash so two vaults with the
 * same display name still differ.
 */
export function vaultExecutorKey(vaultName: string, syncClientId: string | undefined | null): string {
  if (syncClientId && syncClientId.length > 0) return syncClientId.replace(/[^A-Za-z0-9._-]/g, '_');
  const slug = vaultName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vault';
  return `${slug}-${fnv1a(vaultName)}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
