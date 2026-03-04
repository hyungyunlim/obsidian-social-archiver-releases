#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PLUGIN_ID = 'social-archiver';

function printUsage() {
  console.log(`Usage:
  node scripts/archive-social.mjs --url <social-url> [--vault <vault-name>] [--config <obsidian.json path>] [--dry-run]
  npm run archive:social -- --url <social-url> [--vault <vault-name>] [--config <obsidian.json path>] [--dry-run]

Options:
  --url <url>       URL to archive (or pass as first positional argument)
  --vault <name>    Vault name (folder name). If omitted, launcher auto-selects.
  --config <path>   Path to obsidian.json
  --list            List vaults with Social Archiver installed and exit
  --dry-run         Print URI only (do not open Obsidian)
  --help            Show this help

Environment:
  OBSIDIAN_CONFIG_PATH   Override obsidian.json path
`);
}

function parseArgs(argv) {
  const args = {
    url: '',
    vault: '',
    config: '',
    list: false,
    dryRun: false,
    help: false,
  };

  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--list') {
      args.list = true;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--url') {
      i += 1;
      args.url = argv[i] || '';
      continue;
    }
    if (token.startsWith('--url=')) {
      args.url = token.slice('--url='.length);
      continue;
    }
    if (token === '--vault') {
      i += 1;
      args.vault = argv[i] || '';
      continue;
    }
    if (token.startsWith('--vault=')) {
      args.vault = token.slice('--vault='.length);
      continue;
    }
    if (token === '--config') {
      i += 1;
      args.config = argv[i] || '';
      continue;
    }
    if (token.startsWith('--config=')) {
      args.config = token.slice('--config='.length);
      continue;
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`);
    }

    positionals.push(token);
  }

  if (!args.url && positionals.length > 0) {
    args.url = positionals[0];
  }

  args.url = args.url.trim();
  args.vault = args.vault.trim();
  args.config = args.config.trim();

  return args;
}

function resolveDefaultConfigCandidates() {
  const home = os.homedir();

  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')];
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    return [
      path.join(appData, 'obsidian', 'obsidian.json'),
      path.join(appData, 'Obsidian', 'obsidian.json'),
    ];
  }

  const xdg = process.env.XDG_CONFIG_HOME;
  const candidates = [];
  if (xdg) {
    candidates.push(path.join(xdg, 'obsidian', 'obsidian.json'));
  }
  candidates.push(path.join(home, '.config', 'obsidian', 'obsidian.json'));
  return candidates;
}

function resolveConfigPath(cliConfigPath) {
  if (cliConfigPath) {
    const abs = path.resolve(cliConfigPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`obsidian.json not found: ${abs}`);
    }
    return abs;
  }

  const envPath = process.env.OBSIDIAN_CONFIG_PATH;
  if (envPath) {
    const abs = path.resolve(envPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`OBSIDIAN_CONFIG_PATH does not exist: ${abs}`);
    }
    return abs;
  }

  const candidates = resolveDefaultConfigCandidates();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not find obsidian.json in default locations. Checked:\n- ${candidates.join('\n- ')}`
    );
  }
  return found;
}

function loadVaults(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const data = JSON.parse(raw);
  const vaultMap = data?.vaults;

  if (!vaultMap || typeof vaultMap !== 'object') {
    throw new Error(`Invalid obsidian.json format: missing vaults object (${configPath})`);
  }

  const vaults = [];
  for (const value of Object.values(vaultMap)) {
    if (!value || typeof value !== 'object') continue;
    if (typeof value.path !== 'string' || !value.path) continue;

    const vaultPath = value.path;
    const vaultName = path.basename(vaultPath);
    vaults.push({ name: vaultName, path: vaultPath });
  }

  return vaults;
}

function hasSocialArchiver(vaultPath) {
  const manifestPath = path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID, 'manifest.json');
  return fs.existsSync(manifestPath);
}

function chooseVaultMac(vaultNames) {
  const escaped = vaultNames.map((name) => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const script = [
    `set vaults to {${escaped.join(', ')}}`,
    'set selected to choose from list vaults with title "Social Archiver" with prompt "Select vault" default items {item 1 of vaults} without multiple selections allowed',
    'if selected is false then return ""',
    'return item 1 of selected',
  ];

  const result = spawnSync('osascript', script.flatMap((line) => ['-e', line]), {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`Vault picker failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }

  const selected = (result.stdout || '').trim();
  return selected || '';
}

function findVaultByName(vaults, wanted) {
  const exact = vaults.find((vault) => vault.name === wanted);
  if (exact) return exact;

  const lower = wanted.toLowerCase();
  return vaults.find((vault) => vault.name.toLowerCase() === lower) || null;
}

function selectVault(vaults, requestedVaultName) {
  if (vaults.length === 0) {
    throw new Error('No vault found with Social Archiver installed.');
  }

  const duplicateNames = new Set();
  const seen = new Set();
  for (const vault of vaults) {
    if (seen.has(vault.name)) duplicateNames.add(vault.name);
    seen.add(vault.name);
  }
  if (duplicateNames.size > 0) {
    throw new Error(
      `Duplicate vault names detected: ${Array.from(duplicateNames).join(', ')}. Please use unique vault names.`
    );
  }

  if (requestedVaultName) {
    const match = findVaultByName(vaults, requestedVaultName);
    if (!match) {
      throw new Error(`Vault not found: ${requestedVaultName}`);
    }
    return match;
  }

  if (vaults.length === 1) {
    return vaults[0];
  }

  if (process.platform === 'darwin') {
    const selectedName = chooseVaultMac(vaults.map((vault) => vault.name));
    if (!selectedName) {
      throw new Error('Vault selection cancelled.');
    }

    const match = findVaultByName(vaults, selectedName);
    if (!match) {
      throw new Error(`Selected vault not found: ${selectedName}`);
    }

    return match;
  }

  const lines = vaults.map((vault) => `- ${vault.name} (${vault.path})`).join('\n');
  throw new Error(`Multiple vaults found. Re-run with --vault.\n${lines}`);
}

function buildObsidianUri(vaultName, url) {
  const params = new URLSearchParams({
    vault: vaultName,
    url,
  });
  return `obsidian://social-archive?${params.toString()}`;
}

function openUri(uri) {
  let result;

  if (process.platform === 'darwin') {
    result = spawnSync('open', [uri], { stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    result = spawnSync('cmd', ['/c', 'start', '', uri], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    result = spawnSync('xdg-open', [uri], { stdio: 'ignore' });
  }

  if (result.status !== 0) {
    throw new Error(`Failed to open URI: ${uri}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
      printUsage();
      return;
    }

    const configPath = resolveConfigPath(args.config);
    const allVaults = loadVaults(configPath);
    const supportedVaults = allVaults.filter((vault) => hasSocialArchiver(vault.path));

    if (args.list) {
      if (supportedVaults.length === 0) {
        console.log('No vault with Social Archiver installed.');
        return;
      }

      for (const vault of supportedVaults) {
        console.log(`${vault.name}\t${vault.path}`);
      }
      return;
    }

    if (!args.url) {
      throw new Error('Missing URL. Use --url <social-url>.');
    }

    const selectedVault = selectVault(supportedVaults, args.vault);
    const uri = buildObsidianUri(selectedVault.name, args.url);

    if (args.dryRun) {
      console.log(uri);
      return;
    }

    openUri(uri);
    console.log(`Opened Social Archiver for vault: ${selectedVault.name}`);
  } catch (error) {
    console.error(`[archive-social] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

main();
