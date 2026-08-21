import { memo } from 'react';
import { Eye, Pencil } from 'lucide-react';
import type { FileEntry } from '@prokopai/sdk';
import type { DefaultFileOpenMode } from '@/stores/uiStore';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
} from '@/components/ui/context-menu';

export type FileOpenMode = 'preview' | 'edit';

export interface FileEntryActionTarget {
  entry: FileEntry;
  root?: string;
}

export interface FileEntryActions {
  open: (target: FileEntryActionTarget, mode?: FileOpenMode) => void;
}

interface FileEntryContextMenuProps {
  target: FileEntryActionTarget;
  actions: FileEntryActions;
  children: React.ReactNode;
  className?: string;
}

/**
 * Disabled when the entry is a directory (file-only actions in this checkpoint)
 * or when the Changes entry status is 'deleted' (no disk file to edit).
 */
function isEditDisabled(target: FileEntryActionTarget): boolean {
  if (target.entry.type === 'directory') return true;
  return target.entry.git?.status === 'deleted';
}

function isPreviewDisabled(target: FileEntryActionTarget): boolean {
  return target.entry.type === 'directory';
}

function FileEntryContextMenuImpl({
  target,
  actions,
  children,
  className,
}: FileEntryContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild className={className}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={isPreviewDisabled(target)}
            onClick={() => actions.open(target, 'preview')}
          >
            <Eye className="size-4" />
            Open Preview
          </ContextMenuItem>
          <ContextMenuItem
            disabled={isEditDisabled(target)}
            onClick={() => actions.open(target, 'edit')}
          >
            <Pencil className="size-4" />
            Open Edit
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const FileEntryContextMenu = memo(FileEntryContextMenuImpl);

/**
 * Re-export DefaultFileOpenMode as FileOpenMode for callers that need the
 * type without importing from the store.
 */
export type { DefaultFileOpenMode };
