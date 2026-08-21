import type { ProkopaiClient } from '@prokopai/sdk';
import { useState, useEffect, useRef } from 'react';
import { Check, ChevronsUpDown, Folder, Box, Plus, MoreHorizontal, Trash2, Pencil, FolderSymlink, Loader2 } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { FolderPickerDialog } from '@/components/modals/FolderPickerDialog';
import { WorkspaceAdditionalPathsDialog } from '@/components/modals/WorkspaceAdditionalPathsDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onCreateVirtualWorkspace: () => void;
  onCreatePhysicalWorkspace: (path: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onUpdateWorkspacePaths: (workspaceId: string, additionalPaths: string[]) => void;
  sdkClient: ProkopaiClient | null;
  isCreatingWorkspace?: boolean;
  deletingWorkspaceId?: string | null;
  isUpdatingWorkspace?: Record<string, boolean>;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onCreateVirtualWorkspace,
  onCreatePhysicalWorkspace,
  onDeleteWorkspace,
  onRenameWorkspace,
  onUpdateWorkspacePaths,
  sdkClient,
  isCreatingWorkspace = false,
  deletingWorkspaceId = null,
  isUpdatingWorkspace = {},
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null);
  const [editingPathsWorkspace, setEditingPathsWorkspace] = useState<Workspace | null>(null);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingWorkspaceId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingWorkspaceId]);

  const handleRenameStart = (workspace: Workspace) => {
    setRenameValue(workspace.name);
    setRenamingWorkspaceId(workspace.id);
  };

  const handleRenameCommit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && renamingWorkspaceId) {
      onRenameWorkspace(renamingWorkspaceId, trimmed);
    }
    setRenamingWorkspaceId(null);
  };

  const handleRenameCancel = () => {
    setRenamingWorkspaceId(null);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select workspace"
          className="w-full justify-between h-9"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            {activeWorkspace?.isVirtual ? (
              <Box className="size-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-4 flex-shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">
              {activeWorkspace?.name || 'Select workspace'}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 max-h-[80vh]">
        <Command>
          <CommandInput placeholder="Search workspace..." />
          <CommandList className="max-h-[50vh] overflow-y-auto">
            <CommandEmpty>No workspace found.</CommandEmpty>
            <CommandGroup heading="Workspaces">
              {workspaces.map((workspace) => (
                <CommandItem
                  key={workspace.id}
                  showCheck={false}
                  onSelect={() => {
                    if (renamingWorkspaceId === workspace.id) return;
                    onSelectWorkspace(workspace);
                    setOpen(false);
                  }}
                >
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {renamingWorkspaceId === workspace.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRenameCommit();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            handleRenameCancel();
                          } else if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
                            e.stopPropagation();
                          }
                        }}
                        onBlur={handleRenameCommit}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 h-6 px-1 text-sm bg-background border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : (
                      <>
                        {workspace.isVirtual ? (
                          <Box className="size-4 flex-shrink-0 text-muted-foreground" />
                        ) : (
                          <Folder className="size-4 flex-shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{workspace.name}</span>
                      </>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <Check
                      className={cn(
                        'size-4',
                        activeWorkspace?.id === workspace.id
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="p-1 rounded hover:bg-secondary transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">Workspace actions</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameStart(workspace);
                          }}
                        >
                          <Pencil className="size-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPathsWorkspace(workspace);
                            setOpen(false);
                          }}
                        >
                          <FolderSymlink className="size-4" />
                          Additional paths
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setWorkspaceToDelete(workspace);
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                disabled={isCreatingWorkspace}
                onSelect={() => {
                  if (isCreatingWorkspace) return;
                  onCreateVirtualWorkspace();
                  setOpen(false);
                }}
              >
                {isCreatingWorkspace ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" data-icon="inline-start" />}
                Create virtual workspace
              </CommandItem>
              <CommandItem
                disabled={isCreatingWorkspace}
                onSelect={() => {
                  if (isCreatingWorkspace) return;
                  setOpen(false);
                  setShowFolderPicker(true);
                }}
              >
                <Folder className="size-4" data-icon="inline-start" />
                Add existing folder
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <FolderPickerDialog
      open={showFolderPicker}
      onOpenChange={setShowFolderPicker}
      onSelect={(path) => {
        if (isCreatingWorkspace) return;
        onCreatePhysicalWorkspace(path);
        setShowFolderPicker(false);
      }}
      title="Select Workspace Folder"
      sdkClient={sdkClient}
    />
    <WorkspaceAdditionalPathsDialog
      open={!!editingPathsWorkspace}
      onOpenChange={(o) => { if (!o) setEditingPathsWorkspace(null); }}
      workspace={editingPathsWorkspace ?? { id: '', name: '', path: '', isVirtual: false, additionalPaths: [], settings: {}, createdAt: '', updatedAt: '' }}
      onSave={onUpdateWorkspacePaths}
      sdkClient={sdkClient}
      isSaving={editingPathsWorkspace ? !!isUpdatingWorkspace[editingPathsWorkspace.id] : false}
    />
    <ConfirmationDialog
      open={workspaceToDelete !== null}
      onOpenChange={(open) => !open && setWorkspaceToDelete(null)}
      title="Delete Workspace"
      description={
        workspaceToDelete
          ? `Are you sure you want to delete "${workspaceToDelete.name}"? This will permanently remove the workspace and all associated Jean data, including sessions, messages, and temporary files. The actual files in "${workspaceToDelete.name}" on disk will not be deleted.`
          : ''
      }
      confirmLabel="Delete"
      variant="destructive"
      loading={workspaceToDelete !== null && deletingWorkspaceId === workspaceToDelete.id}
      onConfirm={() => {
        if (workspaceToDelete) {
          onDeleteWorkspace(workspaceToDelete.id);
        }
      }}
    />
    </>
  );
}
