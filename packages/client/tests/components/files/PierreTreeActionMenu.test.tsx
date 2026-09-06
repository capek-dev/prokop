import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees';
import { PierreTreeActionMenu, type PierreTreeActionMenuActions } from '@/components/files/PierreTreeActionMenu';

afterEach(cleanup);
function setup(options: { untracked?: boolean; directory?: boolean; deleted?: boolean; pending?: boolean; enabled?: boolean } = {}) {
  const addToGit = vi.fn();
  const close = vi.fn();
  const actions: PierreTreeActionMenuActions = {
    openPreview: vi.fn(), openEdit: vi.fn(), copyRelative: vi.fn(), copyAbsolute: vi.fn(),
    rename: vi.fn(), del: vi.fn(), createFile: vi.fn(), createFolder: vi.fn(),
    addToGit: options.enabled === false ? undefined : addToGit,
    addingToGit: options.pending,
  };
  const item = { path: 'new.txt', name: 'new.txt', kind: options.directory ? 'directory' : 'file' } as ContextMenuItem;
  const context = {
    close, anchorRect: new DOMRect(), anchorElement: document.createElement('button'), restoreFocus: vi.fn(),
  } as ContextMenuOpenContext;
  render(<PierreTreeActionMenu
    item={item} context={context} actions={actions}
    untrackedPaths={new Set(options.untracked ? ['new.txt'] : [])}
    deletedPaths={new Set(options.deleted ? ['new.txt'] : [])}
  />);
  return { addToGit, close };
}

describe('Add to Git menu action', () => {
  test('adds the untracked file and closes the menu without confirmation', () => {
    const { addToGit, close } = setup({ untracked: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Git' }));
    expect(addToGit).toHaveBeenCalledExactlyOnceWith('new.txt');
    expect(close).toHaveBeenCalledOnce();
  });
  test.each([{}, { untracked: true, directory: true }, { untracked: true, deleted: true }, { untracked: true, enabled: false }])('hides unavailable actions: %j', (options) => {
    setup(options);
    expect(screen.queryByRole('menuitem', { name: 'Add to Git' })).toBeNull();
  });
  test('disables the action while adding', () => {
    const { addToGit } = setup({ untracked: true, pending: true });
    const button = screen.getByRole('menuitem', { name: 'Adding to Git…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(addToGit).not.toHaveBeenCalled();
  });
});
