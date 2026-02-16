#!/usr/bin/env node

/**
 * Sync shared definitions to plugin source directories.
 *
 * This script copies files from shared/ to plugin targets:
 *
 * Platforms (shared/platforms/):
 * - src/shared/platforms/
 * - src/shared/platforms/
 * - mobile-app/src/shared/platforms/
 *
 * Icons (shared/icons/):
 * - src/constants/
 * - src/constants/
 *
 * Constants (shared/constants/):
 * - src/shared/constants/
 * - src/shared/constants/
 *
 * Each copied file gets an auto-generated header warning not to edit directly.
 *
 * Usage:
 *   node scripts/sync-shared.mjs
 *   npm run sync:shared
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * Sync targets configuration
 */
const TARGETS = [
  {
    name: 'Plugin (platforms)',
    src: 'shared/platforms',
    dest: 'src/shared/platforms',
  },
  {
    name: 'Plugin (icons)',
    src: 'shared/icons',
    dest: 'src/constants',
  },
  {
    name: 'Plugin (constants)',
    src: 'shared/constants',
    dest: 'src/shared/constants',
  },
];

/**
 * Generate auto-generated file header
 */
function generateHeader(srcPath, filename) {
  return `/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: ${srcPath}/${filename}
 * Generated: ${new Date().toISOString()}
 *
 * To modify, edit the source file in ${srcPath}/ and run:
 *   npm run sync:shared
 */

`;
}

/**
 * Sync files from source to destination
 */
function syncFiles() {
  console.log('');
  console.log('  Syncing shared definitions...');
  console.log('');

  let totalFiles = 0;

  for (const target of TARGETS) {
    const srcDir = path.join(ROOT, target.src);
    const destDir = path.join(ROOT, target.dest);

    // Check if source directory exists
    if (!fs.existsSync(srcDir)) {
      console.error(`  Source directory not found: ${srcDir}`);
      process.exit(1);
    }

    // Create destination directory
    fs.mkdirSync(destDir, { recursive: true });

    // Get all TypeScript files
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      const srcFilePath = path.join(srcDir, file);
      const destPath = path.join(destDir, file);

      // Read source file
      let content = fs.readFileSync(srcFilePath, 'utf-8');

      // Add auto-generated header
      content = generateHeader(target.src, file) + content;

      // Write to destination
      fs.writeFileSync(destPath, content);

      console.log(`    ${target.name}: ${file}`);
      totalFiles++;
    }
  }

  console.log('');
  console.log(`  Synced ${totalFiles} files to ${TARGETS.length} targets`);
  console.log('');
}

// Run sync
try {
  syncFiles();
} catch (error) {
  console.error('Sync failed:', error.message);
  process.exit(1);
}
