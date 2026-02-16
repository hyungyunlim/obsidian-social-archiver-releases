#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message) {
  console.error(`\n[check-css-source] ${message}`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function stats(file) {
  const content = read(file);
  const lines = content.split('\n');
  const maxLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    bytes: Buffer.byteLength(content),
    lines: lines.length,
    maxLine,
    content,
  };
}

const legacyEntry = stats('styles.css');
if (legacyEntry.bytes > 2048) {
  fail(`styles.css should remain a lightweight compatibility entry (current: ${legacyEntry.bytes} bytes).`);
}

const indexCss = stats('src/styles/index.css');
const expectedLegacyChunks = [
  './legacy/00-foundation.css',
  './legacy/10-archive.css',
  './legacy/20-media-gallery.css',
  './legacy/30-release-webtoon.css',
  './legacy/40-series-fullscreen.css',
  './legacy/50-timeline-series-mixed.css',
  './legacy/60-reader-mode.css',
  './legacy/70-video-cue.css',
];

if (indexCss.content.includes("@import './00-legacy.css';")) {
  fail('src/styles/index.css should not import ./00-legacy.css anymore.');
}

for (const relPath of expectedLegacyChunks) {
  const importLine = `@import '${relPath}';`;
  if (!indexCss.content.includes(importLine)) {
    fail(`src/styles/index.css is missing import: ${importLine}`);
  }
}

for (const relPath of expectedLegacyChunks) {
  const diskPath = `src/styles/${relPath.replace('./', '')}`;
  if (!fs.existsSync(path.join(root, diskPath))) {
    fail(`Missing legacy chunk file: ${diskPath}`);
  }

  const chunkStats = stats(diskPath);
  if (chunkStats.maxLine > 500) {
    fail(`${diskPath} contains oversized line (${chunkStats.maxLine} chars).`);
  }
}

if (fs.existsSync(path.join(root, 'src/styles/00-legacy.css'))) {
  fail('src/styles/00-legacy.css should be removed after chunk split.');
}

const mainTs = stats('src/main.ts').content;
if (mainTs.includes("import '../styles.css';")) {
  fail('src/main.ts should not import ../styles.css directly.');
}
if (!mainTs.includes("import './styles/index.css';")) {
  fail('src/main.ts must import ./styles/index.css.');
}

console.log('[check-css-source] OK');
console.log(`- styles.css: ${legacyEntry.bytes} bytes`);
console.log(`- src/styles/index.css: ${indexCss.lines} lines`);
for (const relPath of expectedLegacyChunks) {
  const diskPath = `src/styles/${relPath.replace('./', '')}`;
  const chunkStats = stats(diskPath);
  console.log(`- ${diskPath}: ${chunkStats.lines} lines, max line ${chunkStats.maxLine}`);
}
