#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '';

function fail(message) {
  console.error(`[verify-release-metadata] ${message}`);
  process.exit(1);
}

if (!tag) {
  fail('Tag is required. Pass as first argument or set GITHUB_REF_NAME.');
}

if (tag.startsWith('v')) {
  fail(`Tag "${tag}" is invalid. Use plain version like "2.6.1" (no "v" prefix).`);
}

const manifestPath = path.join(root, 'manifest.json');
const versionsPath = path.join(root, 'versions.json');

if (!fs.existsSync(manifestPath)) fail('manifest.json not found.');
if (!fs.existsSync(versionsPath)) fail('versions.json not found.');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));

if (manifest.version !== tag) {
  fail(`Tag "${tag}" must match manifest.json version "${manifest.version}".`);
}

if (!(tag in versions)) {
  fail(`versions.json is missing key "${tag}".`);
}

if (versions[tag] !== manifest.minAppVersion) {
  fail(
    `versions.json["${tag}"] (${versions[tag]}) must match manifest.minAppVersion (${manifest.minAppVersion}).`
  );
}

console.log('[verify-release-metadata] OK');
console.log(`- tag: ${tag}`);
console.log(`- manifest.version: ${manifest.version}`);
console.log(`- manifest.minAppVersion: ${manifest.minAppVersion}`);
console.log(`- versions.json["${tag}"]: ${versions[tag]}`);
