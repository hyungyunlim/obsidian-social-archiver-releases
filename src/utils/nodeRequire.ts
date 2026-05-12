/**
 * nodeRequire - Provides access to Node.js require in Obsidian's Electron environment
 *
 * Obsidian plugins run in Electron which provides Node.js require as a global on
 * `window`. This module reads it lazily so importing this file on mobile (where
 * Node.js require does not exist) does not crash — as long as callers guard the
 * actual invocation with Platform.isDesktop or equivalent.
 */

import { Platform } from 'obsidian';

// Lazy wrapper: resolves Node.js require on first call only.
let _cached: NodeJS.Require | undefined;

function nodeRequire(id: string): unknown {
  if (!_cached) {
    if (!Platform.isDesktopApp) {
      throw new Error('nodeRequire is desktop-only');
    }
    const electronRequire = (window as unknown as { require?: NodeJS.Require }).require;
    if (!electronRequire) {
      throw new Error('Node require not available');
    }
    _cached = electronRequire;
  }
  return _cached(id);
}

export default nodeRequire;
