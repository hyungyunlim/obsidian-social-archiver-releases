/**
 * Which notes are open in an editor (prd-plugin-my-posts-two-way-sync §5.2,
 * §5.3): pull never rewrites an open note, and push waits longer while one is
 * being typed in, then goes as soon as the user leaves it.
 */

import type { EventRef, TFile, Workspace, WorkspaceLeaf } from 'obsidian';

const LOG_PREFIX = '[Social Archiver] [EditorPresence]';

function leafPath(leaf: WorkspaceLeaf): string | undefined {
  return (leaf.view as { file?: TFile | null }).file?.path;
}

/** Any markdown leaf (editing or reading view) shows this file. */
export function isFileOpenInEditor(workspace: Workspace, path: string): boolean {
  return workspace.getLeavesOfType('markdown').some((leaf) => leafPath(leaf) === path);
}

export class EditorPresence {
  private openPaths = new Set<string>();
  private activePath: string | null = null;
  private refs: EventRef[] = [];
  private readonly listeners = new Set<(path: string) => void>();

  constructor(private readonly workspace: Workspace) {}

  start(): void {
    if (this.refs.length > 0) return;
    this.snapshot();
    const update = (): void => this.update();
    this.refs = [
      this.workspace.on('layout-change', update),
      this.workspace.on('active-leaf-change', update),
      this.workspace.on('file-open', update),
    ];
  }

  dispose(): void {
    for (const ref of this.refs) this.workspace.offref(ref);
    this.refs = [];
    this.listeners.clear();
    this.openPaths.clear();
    this.activePath = null;
  }

  isOpen(path: string): boolean {
    return isFileOpenInEditor(this.workspace, path);
  }

  /** path left every markdown leaf, or the active leaf moved off it (§5.2 "탭을 닫거나 다른 노트로 옮기면"). */
  onLeave(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private snapshot(): void {
    this.openPaths = new Set(
      this.workspace.getLeavesOfType('markdown').map(leafPath).filter((path): path is string => !!path),
    );
    const active = this.workspace.getActiveFile()?.path ?? null;
    this.activePath = active && this.openPaths.has(active) ? active : null;
  }

  private update(): void {
    const before = this.openPaths;
    const beforeActive = this.activePath;
    this.snapshot();
    const left = new Set([...before].filter((path) => !this.openPaths.has(path)));
    if (beforeActive && beforeActive !== this.activePath) left.add(beforeActive);
    for (const path of left) {
      for (const listener of [...this.listeners]) {
        try {
          listener(path);
        } catch (error) {
          console.error(`${LOG_PREFIX} leave listener failed for ${path}:`, error);
        }
      }
    }
  }
}
