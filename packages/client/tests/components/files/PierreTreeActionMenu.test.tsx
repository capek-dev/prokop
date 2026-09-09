import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees';
import { PierreTreeActionMenu, type PierreTreeActionMenuActions } from '@/components/files/PierreTreeActionMenu';

afterEach(cleanup);
function setup(options: { untracked?: boolean; modified?: boolean; directory?: boolean; deleted?: boolean; pending?: boolean; enabled?: boolean; stagedAddition?: boolean } = {}) {
  const addToGit = vi.fn();
  const removeStagedAddition = vi.fn();
  const close = vi.fn();
  const revertModified = vi.fn();
  const actions: PierreTreeActionMenuActions = {
    openPreview: vi.fn(), openEdit: vi.fn(), copyRelative: vi.fn(), copyAbsolute: vi.fn(),
    rename: vi.fn(), del: vi.fn(), createFile: vi.fn(), createFolder: vi.fn(),
    addToGit: options.enabled === false ? undefined : addToGit,
    addingToGit: options.pending,
    removeStagedAddition: options.enabled === false ? undefined : removeStagedAddition,
    removingStagedAddition: options.pending,
    revertModified: options.enabled === false ? undefined : revertModified,
    revertingModified: options.pending,
  };
  const item = { path: 'new.txt', name: 'new.txt', kind: options.directory ? 'directory' : 'file' } as ContextMenuItem;
  const context = {
    close, anchorRect: new DOMRect(), anchorElement: document.createElement('button'), restoreFocus: vi.fn(),
  } as ContextMenuOpenContext;
  render(<PierreTreeActionMenu
    item={item} context={context} actions={actions}
    untrackedPaths={new Set(options.untracked ? ['new.txt'] : [])}
    deletedPaths={new Set(options.deleted ? ['new.txt'] : [])}
    stagedAdditionPaths={new Set(options.stagedAddition ? ['new.txt'] : [])}
    modifiedPaths={new Set(options.modified ? ['new.txt'] : [])}
  />);
  return { addToGit, close, removeStagedAddition, revertModified };
}

describe('Staged addition cleanup', () => {
  test.each([[false, 'Move to untracked'], [true, 'Remove staged addition']] as const)('offers cleanup for deleted=%s', (deleted, label) => {
    const { removeStagedAddition, close } = setup({ stagedAddition: true, deleted });
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(removeStagedAddition).toHaveBeenCalledExactlyOnceWith('new.txt');
    expect(close).toHaveBeenCalledOnce();
  });
  test.each([{}, { deleted: true }, { stagedAddition: true, directory: true }, { stagedAddition: true, enabled: false }])('hides cleanup when ineligible: %j', (options) => {
    setup(options);
    expect(screen.queryByRole('menuitem', { name: /Move to untracked|Remove staged addition/ })).toBeNull();
  });
  test('disables cleanup while pending', () => {
    setup({ stagedAddition: true, pending: true });
    expect(screen.getByRole('menuitem', { name: 'Removing from index…' })).toBeDisabled();
  });
});

describe('Revert modified file menu action', () => {
  test('offers a confirmed-action entry only for modified files', () => {
    const { revertModified, close } = setup({ modified: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revert changes…' }));
    expect(revertModified).toHaveBeenCalledExactlyOnceWith('new.txt');
    expect(close).toHaveBeenCalledOnce();
  });

  test.each([{}, { modified: true, directory: true }, { modified: true, enabled: false }])(
    'hides the action when ineligible: %j',
    (options) => {
      setup(options);
      expect(screen.queryByRole('menuitem', { name: /Revert changes/ })).toBeNull();
    },
  );

  test('disables the action while reverting', () => {
    const { revertModified } = setup({ modified: true, pending: true });
    const button = screen.getByRole('menuitem', { name: 'Reverting changes…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(revertModified).not.toHaveBeenCalled();
  });
});

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
