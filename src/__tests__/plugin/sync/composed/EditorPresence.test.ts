import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from 'obsidian';
import { EditorPresence, isFileOpenInEditor } from '@/plugin/sync/composed/EditorPresence';

function fakeWorkspace(): { workspace: Workspace; show: (paths: string[], active?: string) => void } {
  let open: string[] = [];
  let active: string | null = null;
  const handlers = new Map<string, () => void>();
  const workspace = {
    getLeavesOfType: (type: string) => (type === 'markdown' ? open.map((path) => ({ view: { file: { path } } })) : []),
    getActiveFile: () => (active ? { path: active } : null),
    on: vi.fn((name: string, handler: () => void) => {
      handlers.set(name, handler);
      return name;
    }),
    offref: vi.fn((name: string) => handlers.delete(name)),
  } as unknown as Workspace;
  return {
    workspace,
    show: (paths, nextActive) => {
      open = paths;
      active = nextActive ?? null;
      handlers.get('layout-change')?.();
    },
  };
}

describe('EditorPresence', () => {
  it('knows which notes are open in a markdown leaf', () => {
    const { workspace, show } = fakeWorkspace();
    show(['a.md']);
    expect(isFileOpenInEditor(workspace, 'a.md')).toBe(true);
    expect(new EditorPresence(workspace).isOpen('b.md')).toBe(false);
  });

  it('reports a note that left every leaf, or that the active leaf moved off', () => {
    const { workspace, show } = fakeWorkspace();
    const presence = new EditorPresence(workspace);
    show(['a.md', 'b.md'], 'a.md');
    presence.start();
    const left: string[] = [];
    presence.onLeave((path) => left.push(path));

    show(['a.md', 'b.md'], 'b.md'); // switched tabs: a.md is still open but no longer active
    show(['b.md'], 'b.md'); // a.md's tab closed
    expect(left).toEqual(['a.md', 'a.md']);

    presence.dispose();
    show([], undefined);
    expect(left).toHaveLength(2);
    expect(workspace.offref).toHaveBeenCalledTimes(3);
  });
});
