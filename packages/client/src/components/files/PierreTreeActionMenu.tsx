import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Copy, Eye, FilePlus2, FolderPlus, Pencil, Plus, RotateCcw, SquarePen, Trash2 } from 'lucide-react';
import type { ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees';
import { stripTrailingSlash } from './fileActionsCore';
import type { FileActionTargetInfo } from './useFileActions';

export interface PierreTreeActionMenuActions {
  openPreview: (path: string, isDir: boolean) => void;
  openEdit: (path: string) => void;
  copyRelative: (path: string) => void;
  copyAbsolute: (path: string) => void;
  rename: (target: FileActionTargetInfo) => void;
  del: (target: FileActionTargetInfo) => void;
  createFile: (parentDirPath: string) => void;
  createFolder: (parentDirPath: string) => void;
  addToGit?: (path: string) => void;
  addingToGit?: boolean;
  removeStagedAddition?: (path: string) => void;
  removingStagedAddition?: boolean;
  revertModified?: (path: string) => void;
  revertingModified?: boolean;
}

interface PierreTreeActionMenuProps {
  item: ContextMenuItem;
  context: ContextMenuOpenContext;
  actions: PierreTreeActionMenuActions;
  /** Git-deleted file paths (Changes tab): such rows only preview + copy. */
  deletedPaths?: ReadonlySet<string>;
  untrackedPaths?: ReadonlySet<string>;
  stagedAdditionPaths?: ReadonlySet<string>;
  modifiedPaths?: ReadonlySet<string>;
}

type MenuEntry =
  | { kind: 'action'; key: string; icon: LucideIcon; label: string; onSelect: () => void; disabled?: boolean }
  | { kind: 'separator'; key: string };

const MENU_WIDTH = 192; // min-w-48
const ITEM_HEIGHT = 32;
const MENU_VERTICAL_PADDING = 8; // p-1 top+bottom
const VIEWPORT_MARGIN = 8;

function buildMenuEntries(
  isDir: boolean,
  isDeleted: boolean,
  isUntracked: boolean,
  path: string,
  target: FileActionTargetInfo,
  actions: PierreTreeActionMenuActions,
  stagedAddition: boolean,
  isModified: boolean,
): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const remove = actions.removeStagedAddition;
  if (!isDir && stagedAddition && remove) {
    entries.push({ kind: 'action', key: 'git-remove-addition', icon: Trash2,
      label: actions.removingStagedAddition ? 'Removing from index…' : isDeleted ? 'Remove staged addition' : 'Move to untracked',
      disabled: actions.removingStagedAddition || actions.addingToGit,
      onSelect: () => remove(path),
    });
    entries.push({ kind: 'separator', key: 'sep-git-remove' });
  }
  const addToGit = actions.addToGit;
  if (!isDir && !isDeleted && isUntracked && addToGit) {
    entries.push({
      kind: 'action',
      key: 'git-add',
      icon: Plus,
      label: actions.addingToGit ? 'Adding to Git…' : 'Add to Git',
      disabled: actions.addingToGit,
      onSelect: () => addToGit(path),
    });
    entries.push({ kind: 'separator', key: 'sep-git' });
  }
  if (!isDir) {
    entries.push({
      kind: 'action',
      key: 'preview',
      icon: Eye,
      label: 'Open Preview',
      onSelect: () => actions.openPreview(path, false),
    });
    if (!isDeleted) {
      entries.push({
        kind: 'action',
        key: 'edit',
        icon: SquarePen,
        label: 'Open in Editor',
        onSelect: () => actions.openEdit(path),
      });
    }
  } else {
    entries.push({
      kind: 'action',
      key: 'new-file',
      icon: FilePlus2,
      label: 'New File…',
      onSelect: () => actions.createFile(path),
    });
    entries.push({
      kind: 'action',
      key: 'new-folder',
      icon: FolderPlus,
      label: 'New Folder…',
      onSelect: () => actions.createFolder(path),
    });
  }
  entries.push({ kind: 'separator', key: 'sep-copy' });
  entries.push({
    kind: 'action',
    key: 'copy-relative',
    icon: Copy,
    label: 'Copy Relative Path',
    onSelect: () => actions.copyRelative(path),
  });
  entries.push({
    kind: 'action',
    key: 'copy-absolute',
    icon: Copy,
    label: 'Copy Absolute Path',
    onSelect: () => actions.copyAbsolute(path),
  });
  if (!isDir && isModified && actions.revertModified) {
    entries.push({ kind: 'separator', key: 'sep-revert' });
    entries.push({
      kind: 'action',
      key: 'git-revert-modified',
      icon: RotateCcw,
      label: actions.revertingModified ? 'Reverting changes…' : 'Revert changes…',
      disabled: actions.revertingModified,
      onSelect: () => actions.revertModified?.(path),
    });
  }
  if (!isDeleted) {
    entries.push({ kind: 'separator', key: 'sep-mutate' });
    entries.push({
      kind: 'action',
      key: 'rename',
      icon: Pencil,
      label: 'Rename…',
      onSelect: () => actions.rename(target),
    });
    entries.push({
      kind: 'action',
      key: 'delete',
      icon: Trash2,
      label: 'Delete…',
      onSelect: () => actions.del(target),
    });
  }
  return entries;
}

/**
 * Menu surface for Pierre's light-DOM context-menu slot. Pierre anchors the
 * slot fixed at the pointer and handles outside-click dismissal; this
 * component only renders items and closes via `context.close()`.
 */
export function PierreTreeActionMenu({ item, context, actions, deletedPaths, untrackedPaths, stagedAdditionPaths, modifiedPaths }: PierreTreeActionMenuProps) {
  const isDir = item.kind === 'directory';
  const path = stripTrailingSlash(item.path);
  const isDeleted = !isDir && deletedPaths?.has(path) === true;
  const target: FileActionTargetInfo = { path, isDirectory: isDir, name: item.name };
  const entries = buildMenuEntries(isDir, isDeleted, untrackedPaths?.has(path) === true, path, target, actions, stagedAdditionPaths?.has(path) === true, modifiedPaths?.has(path) === true);

  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Separator-only length estimate is fine: clamping only needs an upper bound.
  const menuHeight = entries.length * ITEM_HEIGHT + MENU_VERTICAL_PADDING;
  const left = Math.min(context.anchorRect.left, Math.max(window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN, 0));
  const top = Math.min(context.anchorRect.top, Math.max(window.innerHeight - menuHeight - VIEWPORT_MARGIN, 0));

  useEffect(() => {
    itemRefs.current.find((el) => el && !el.disabled)?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      context.close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null && !el.disabled);
      if (buttons.length === 0) return;
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    }
  };

  const run = (onSelect: () => void) => () => {
    context.close();
    onSelect();
  };

  // Action index per entry (separators skipped) for stable ref slots.
  const actionIndexBefore = (i: number): number =>
    entries.slice(0, i).filter((entry) => entry.kind === 'action').length;

  return (
    <div
      role="menu"
      aria-label={`Actions for ${item.name}`}
      className="fixed z-50 min-w-48 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none"
      style={{ left, top }}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') {
          return <div key={entry.key} role="separator" className="-mx-1 my-1 h-px bg-border" />;
        }
        const current = actionIndexBefore(i);
        return (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            ref={(el) => {
              itemRefs.current[current] = el;
            }}
            onClick={run(entry.onSelect)}
            disabled={entry.disabled}
            className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <entry.icon className="size-4 shrink-0" />
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
