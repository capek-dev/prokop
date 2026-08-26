import { useState } from 'react';
import type { Agent, Workspace } from '@prokopai/sdk';
import {
  Check,
  ChevronsUpDown,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { OverviewGroupDialog } from '@/components/modals/OverviewGroupDialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import { cn } from '@/lib/utils';

interface OverviewGroupSelectorProps {
  serverId: string;
  groups: OverviewGroup[];
  activeGroup: OverviewGroup | null;
  workspaces: Workspace[];
  agents: Agent[];
  isHydrated: boolean;
  actions: {
    selectGroup: (serverId: string, groupId: string) => void;
    createGroup: (serverId: string, name: string, workspaceIds?: string[]) => string | null;
    renameGroup: (groupId: string, name: string) => boolean;
    setGroupWorkspaces: (groupId: string, workspaceIds: string[]) => void;
    deleteGroup: (groupId: string) => void;
  };
}

export function OverviewGroupSelector({
  serverId,
  groups,
  activeGroup,
  workspaces,
  agents,
  isHydrated,
  actions,
}: OverviewGroupSelectorProps) {
  const [open, setOpen] = useState(false);
  const [dialogState, setDialogState] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; groupId: string }
    | null
  >(null);
  const [groupToDelete, setGroupToDelete] = useState<OverviewGroup | null>(null);

  const handleSelect = (groupId: string) => {
    actions.selectGroup(serverId, groupId);
    setOpen(false);
  };

  const handleCreate = () => {
    setOpen(false);
    setDialogState({ mode: 'create' });
  };

  const handleEdit = (groupId: string) => {
    setOpen(false);
    setDialogState({ mode: 'edit', groupId });
  };

  const handleDelete = (group: OverviewGroup) => {
    setOpen(false);
    setGroupToDelete(group);
  };

  return (
    <>
      <div className="p-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label="Select overview group"
              className="h-9 w-full justify-between"
              disabled={!isHydrated}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Layers className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {activeGroup?.name ?? (isHydrated ? 'Select group' : 'Loading')}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="max-h-[80vh] w-[320px] p-0">
            <Command>
              <CommandInput placeholder="Search groups..." />
              <CommandList className="max-h-[50vh] overflow-y-auto">
                <CommandEmpty>No group found.</CommandEmpty>
                <CommandGroup heading="Groups">
                  {groups.map((group) => (
                    <CommandItem
                      key={group.id}
                      showCheck={false}
                      onSelect={() => handleSelect(group.id)}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Layers className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{group.name}</span>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <Check
                          className={cn(
                            'size-4',
                            activeGroup?.id === group.id
                              ? 'opacity-100'
                              : 'opacity-0',
                          )}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="rounded p-1 transition-colors hover:bg-secondary"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreHorizontal className="size-4" />
                              <span className="sr-only">Group actions</span>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-40">
                            <DropdownMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEdit(group.id);
                              }}
                            >
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDelete(group);
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
                  <CommandItem onSelect={handleCreate}>
                    <Plus className="size-4" data-icon="inline-start" />
                    Create group
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {dialogState && (
        <OverviewGroupDialog
          open={true}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDialogState(null);
          }}
          mode={dialogState.mode}
          serverId={serverId}
          groups={groups}
          workspaces={workspaces}
          agents={agents}
          editingGroupId={
            dialogState.mode === 'edit' ? dialogState.groupId : null
          }
          actions={actions}
          onCreated={(newGroupId) => {
            actions.selectGroup(serverId, newGroupId);
          }}
        />
      )}

      <ConfirmationDialog
        open={groupToDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setGroupToDelete(null);
        }}
        title="Delete overview group"
        description={
          groupToDelete
            ? `Delete "${groupToDelete.name}"? The workspaces and their sessions will not be deleted.`
            : ''
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (groupToDelete) {
            actions.deleteGroup(groupToDelete.id);
            setGroupToDelete(null);
          }
        }}
      />
    </>
  );
}
