import type { Agent, ProkopaiClient } from '@prokopai/sdk';
import { useState, useEffect, useRef } from 'react';
import { Bot, Check, ChevronsUpDown, Folder, Box, Plus, MoreHorizontal, Trash2, Pencil, FolderInput, FolderSymlink, Loader2, Server } from 'lucide-react';
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
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { getSelectableWorkspaces, getWorkspaceDisplayName, isAgentHomeWorkspace } from '@/lib/workspaceKind';
import { cn } from '@/lib/utils';
import { sortWorkspaces } from '@/lib/workspaceOrder';
import { useUIStore } from '@/stores/uiStore';
import { WorkspaceOrderControl } from './WorkspaceOrderControl';
import type { HostWorkspaces } from '@/hooks/useHostWorkspaces';

interface WorkspaceSelectionProps {
  workspaces: Workspace[];
  agents: Agent[];
  activeWorkspace: Workspace | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  /** Name of this machine; shown as the first group heading when other machines are listed. */
  currentHostName?: string;
  /** Workspaces on other saved machines; picking one switches machines in one step. */
  otherHosts?: HostWorkspaces[];
  /** `workspace` is null when the machine needs pairing first. */
  onSelectHostWorkspace?: (serverId: string, workspace: Workspace | null) => void;
  /** Lets the parent fetch other machines' workspaces only while the menu is open. */
  onOpenChange?: (open: boolean) => void;
  /** Approvals and questions waiting on each other machine, by server id. */
  waitingByHost?: Record<string, number>;
  sdkClient?: ProkopaiClient | null;
  isCreatingWorkspace?: boolean;
  deletingWorkspaceId?: string | null;
  isUpdatingWorkspace?: Record<string, boolean>;
}

interface WorkspaceManagementActions {
  onCreateVirtualWorkspace: () => void;
  onCreatePhysicalWorkspace: (path: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onUpdateWorkspacePath: (workspaceId: string, path: string) => void;
  onUpdateWorkspacePaths: (workspaceId: string, additionalPaths: string[]) => void;
}

type WorkspaceSwitcherProps = WorkspaceSelectionProps & (
  | ({ selectionOnly?: false } & WorkspaceManagementActions)
  | ({ selectionOnly: true } & Partial<Record<keyof WorkspaceManagementActions, never>>)
);

export function WorkspaceSwitcher({
  workspaces,
  agents,
  activeWorkspace,
  onSelectWorkspace,
  currentHostName,
  otherHosts = [],
  onSelectHostWorkspace,
  onOpenChange,
  waitingByHost = {},
  onCreateVirtualWorkspace,
  onCreatePhysicalWorkspace,
  onDeleteWorkspace,
  onRenameWorkspace,
  onUpdateWorkspacePath,
  onUpdateWorkspacePaths,
  sdkClient = null,
  selectionOnly = false,
  isCreatingWorkspace = false,
  deletingWorkspaceId = null,
  isUpdatingWorkspace = {},
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const order = useUIStore(s => s.workspaceOrder);
  const [activitySnapshot, setActivitySnapshot] = useState<Record<string, number | null>>({});
  // Keep conversation-driven movement out of an open menu, but retain live names/deletions.
  const selectableWorkspaces = getSelectableWorkspaces(workspaces, agents);
  const nameCounts = new Map<string, number>();
  for (const workspace of selectableWorkspaces) {
    const name = getWorkspaceDisplayName(workspace, agents);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const orderedWorkspaces = sortWorkspaces(
    open ? selectableWorkspaces.map(workspace => ({ ...workspace, lastConversationAt: activitySnapshot[workspace.id] ?? null })) : selectableWorkspaces,
    agents,
    order,
  );
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setActivitySnapshot(Object.fromEntries(workspaces.map(workspace => [workspace.id, workspace.lastConversationAt ?? null])));
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const multipleHosts = otherHosts.length > 0;
  const waitingElsewhere = otherHosts.reduce((total, host) => total + (waitingByHost[host.server.id] ?? 0), 0);
  const hostHeading = (host: HostWorkspaces) => {
    const waiting = waitingByHost[host.server.id] ?? 0;
    return [host.server.name, host.state === 'offline' ? 'offline' : null, waiting > 0 ? `${waiting} waiting` : null]
      .filter(Boolean).join(' · ');
  };
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [workspaceToMove, setWorkspaceToMove] = useState<Workspace | null>(null);
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
      onRenameWorkspace?.(renamingWorkspaceId, trimmed);
    }
    setRenamingWorkspaceId(null);
  };

  const handleRenameCancel = () => {
    setRenamingWorkspaceId(null);
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Select workspace"
          className="h-8 min-w-0 max-w-full self-start gap-1.5 px-2 font-semibold hover:bg-accent"
        >
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            {isAgentHomeWorkspace(activeWorkspace) ? (
              <Bot className="size-4 flex-shrink-0 text-muted-foreground" />
            ) : activeWorkspace?.isVirtual ? (
              <Box className="size-4 flex-shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-4 flex-shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">
              {activeWorkspace
                ? getWorkspaceDisplayName(activeWorkspace, agents)
                : 'Select workspace'}
            </span>
          </div>
          {waitingElsewhere > 0 && (
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label={`${waitingElsewhere} waiting on other machines`} role="status" />
          )}
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[min(80vh,var(--radix-popover-content-available-height))] w-[320px] overflow-hidden p-0">
        <Command className="h-auto max-h-[inherit]">
          <div className="flex items-end gap-1 pr-1">
            <div className="min-w-0 flex-1"><CommandInput placeholder="Search workspace..." /></div>
            <WorkspaceOrderControl compact />
          </div>
          <CommandList className="max-h-[min(50dvh,calc(var(--radix-popover-content-available-height)-11rem))] overflow-y-auto overscroll-contain">
            <CommandEmpty>No workspace found.</CommandEmpty>
            {[
              {
                heading: multipleHosts && currentHostName ? currentHostName : 'Workspaces',
                items: orderedWorkspaces.filter(workspace => !isAgentHomeWorkspace(workspace)),
              },
              {
                heading: 'Agents',
                items: orderedWorkspaces.filter(workspace => isAgentHomeWorkspace(workspace)),
              },
            ].map(group => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((workspace) => (
                <CommandItem
                  key={workspace.id}
                  value={workspace.id}
                  keywords={[getWorkspaceDisplayName(workspace, agents), workspace.path]}
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
                        {isAgentHomeWorkspace(workspace) ? (
                          <Bot className="size-4 flex-shrink-0 text-muted-foreground" />
                        ) : workspace.isVirtual ? (
                          <Box className="size-4 flex-shrink-0 text-muted-foreground" />
                        ) : (
                          <Folder className="size-4 flex-shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <span className="block truncate">{getWorkspaceDisplayName(workspace, agents)}</span>
                          {(nameCounts.get(getWorkspaceDisplayName(workspace, agents)) ?? 0) > 1 && (
                            <span className="block truncate text-xs text-muted-foreground" title={workspace.path}>{workspace.path}</span>
                          )}
                        </div>
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
                     {!selectionOnly && !isAgentHomeWorkspace(workspace) && (
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
                            setWorkspaceToMove(workspace);
                            setOpen(false);
                          }}
                        >
                          <FolderInput className="size-4" />
                          Change folder
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
                     )}
                  </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {otherHosts.map(host => (
              <CommandGroup
                key={host.server.id}
                heading={hostHeading(host)}
              >
                {host.state === 'unpaired' ? (
                  <CommandItem
                    value={`pair:${host.server.id}`}
                    keywords={[host.server.name]}
                    showCheck={false}
                    onSelect={() => {
                      onSelectHostWorkspace?.(host.server.id, null);
                      setOpen(false);
                    }}
                  >
                    <Server className="size-4 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate text-muted-foreground">Pair this device to see its workspaces</span>
                  </CommandItem>
                ) : host.workspaces.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {host.state === 'loading' ? 'Loading…' : host.state === 'offline' ? 'Not reachable right now.' : 'No workspaces yet.'}
                  </p>
                ) : host.workspaces.map(workspace => (
                  <CommandItem
                    key={workspace.id}
                    value={`${host.server.id}:${workspace.id}`}
                    keywords={[workspace.name, workspace.path, host.server.name]}
                    showCheck={false}
                    onSelect={() => {
                      onSelectHostWorkspace?.(host.server.id, workspace);
                      setOpen(false);
                    }}
                  >
                    {workspace.isVirtual
                      ? <Box className="size-4 flex-shrink-0 text-muted-foreground" />
                      : <Folder className="size-4 flex-shrink-0 text-muted-foreground" />}
                    <span className="truncate">{workspace.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          {!selectionOnly && <CommandList className="max-h-none shrink-0 overflow-visible border-t">
            <CommandGroup heading="Workspace actions">
              <CommandItem
                disabled={isCreatingWorkspace}
                onSelect={() => {
                  if (isCreatingWorkspace) return;
                  onCreateVirtualWorkspace?.();
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
                  setWorkspaceToMove(null);
                  setShowFolderPicker(true);
                }}
              >
                <Folder className="size-4" data-icon="inline-start" />
                Add existing folder
              </CommandItem>
            </CommandGroup>
          </CommandList>}
        </Command>
      </PopoverContent>
    </Popover>
    {!selectionOnly && <>
    <FolderPickerDialog
      open={showFolderPicker || workspaceToMove !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setShowFolderPicker(false);
          setWorkspaceToMove(null);
        }
      }}
      onSelect={(path) => {
        if (workspaceToMove) {
          onUpdateWorkspacePath?.(workspaceToMove.id, path);
          setWorkspaceToMove(null);
        } else if (!isCreatingWorkspace) {
          onCreatePhysicalWorkspace?.(path);
          setShowFolderPicker(false);
        }
      }}
      initialPath={workspaceToMove?.path}
      title={workspaceToMove ? 'Select Renamed Workspace Folder' : 'Select Workspace Folder'}
      sdkClient={sdkClient}
    />
    <WorkspaceAdditionalPathsDialog
      open={!!editingPathsWorkspace}
      onOpenChange={(o) => { if (!o) setEditingPathsWorkspace(null); }}
      workspace={editingPathsWorkspace ?? { id: '', name: '', path: '', isVirtual: false, additionalPaths: [], settings: {}, createdAt: '', updatedAt: '' }}
      onSave={(id, paths) => onUpdateWorkspacePaths?.(id, paths)}
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
          onDeleteWorkspace?.(workspaceToDelete.id);
        }
      }}
    />
    </>}
    </>
  );
}
