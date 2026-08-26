import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Agent, Workspace } from '@prokopai/sdk';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ArrowDown, ArrowUp, Bot, Box, Folder, Plus, Trash2 } from 'lucide-react';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import {
  AGENT_HOME_LABEL,
  getWorkspaceDisplayName,
  isAgentHomeWorkspace,
} from '@/lib/workspaceKind';

interface OverviewGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  serverId: string;
  groups: OverviewGroup[];
  workspaces: Workspace[];
  agents: Agent[];
  preselectedWorkspaceId?: string | null;
  editingGroupId?: string | null;
  actions: {
    createGroup: (serverId: string, name: string, workspaceIds?: string[]) => string | null;
    renameGroup: (groupId: string, name: string) => boolean;
    setGroupWorkspaces: (groupId: string, workspaceIds: string[]) => void;
    deleteGroup: (groupId: string) => void;
  };
  onCreated?: (groupId: string) => void;
}

const NAME_LIMIT = 50;

export function OverviewGroupDialog({
  open,
  onOpenChange,
  mode,
  serverId,
  groups,
  workspaces,
  agents,
  preselectedWorkspaceId,
  editingGroupId,
  actions,
  onCreated,
}: OverviewGroupDialogProps) {
  const editingGroup = useMemo(
    () => groups.find((g) => g.id === editingGroupId) ?? null,
    [groups, editingGroupId],
  );

  const [name, setName] = useState('');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setNameError(null);
    if (mode === 'edit' && editingGroup) {
      setName(editingGroup.name);
      setSelectedWorkspaceIds(editingGroup.workspaceIds);
    } else {
      setName('');
      setSelectedWorkspaceIds(
        preselectedWorkspaceId ? [preselectedWorkspaceId] : [],
      );
    }
  }, [open, mode, editingGroup, preselectedWorkspaceId]);

  const validateName = useCallback(
    (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return 'Name is required';
      const isTaken = groups.some(
        (g) =>
          g.serverId === serverId &&
          g.name.toLowerCase() === trimmed.toLowerCase() &&
          g.id !== editingGroupId,
      );
      if (isTaken) return 'A group with this name already exists';
      return null;
    },
    [groups, serverId, editingGroupId],
  );

  const handleNameChange = (value: string) => {
    const capped = value.slice(0, NAME_LIMIT);
    setName(capped);
    if (nameError) setNameError(null);
  };

  const toggleWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceIds((previousIds) =>
      previousIds.includes(workspaceId)
        ? previousIds.filter((id) => id !== workspaceId)
        : [...previousIds, workspaceId],
    );
  };

  const availableWorkspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.id)),
    [workspaces],
  );

  const visibleSelectedWorkspaceIds = useMemo(
    () => selectedWorkspaceIds.filter((id) => availableWorkspaceIds.has(id)),
    [availableWorkspaceIds, selectedWorkspaceIds],
  );

  const moveWorkspace = (workspaceId: string, direction: -1 | 1) => {
    setSelectedWorkspaceIds((previousIds) => {
      const visibleIds = previousIds.filter((id) => availableWorkspaceIds.has(id));
      const currentVisibleIndex = visibleIds.indexOf(workspaceId);
      const targetId = visibleIds[currentVisibleIndex + direction];
      if (currentVisibleIndex === -1 || !targetId) return previousIds;

      const currentIndex = previousIds.indexOf(workspaceId);
      const targetIndex = previousIds.indexOf(targetId);
      const nextIds = [...previousIds];
      [nextIds[currentIndex], nextIds[targetIndex]] = [
        nextIds[targetIndex],
        nextIds[currentIndex],
      ];
      return nextIds;
    });
  };

  const orderedWorkspaces = useMemo(() => {
    const workspaceMap = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const selected = visibleSelectedWorkspaceIds
      .map((id) => workspaceMap.get(id))
      .filter((workspace): workspace is Workspace => workspace !== undefined);
    const selectedSet = new Set(selectedWorkspaceIds);
    return [
      ...selected,
      ...workspaces.filter((workspace) => !selectedSet.has(workspace.id)),
    ];
  }, [selectedWorkspaceIds, visibleSelectedWorkspaceIds, workspaces]);

  const handleSave = () => {
    const error = validateName(name);
    if (error) {
      setNameError(error);
      return;
    }

    const ids = selectedWorkspaceIds;

    if (mode === 'create') {
      const newId = actions.createGroup(serverId, name, ids);
      if (newId) {
        onCreated?.(newId);
        onOpenChange(false);
      } else {
        setNameError('Failed to create group');
      }
    } else if (mode === 'edit' && editingGroupId) {
      actions.renameGroup(editingGroupId, name);
      actions.setGroupWorkspaces(editingGroupId, ids);
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (!editingGroupId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    actions.deleteGroup(editingGroupId);
    onOpenChange(false);
  };

  const title = mode === 'create' ? 'Create group' : 'Manage group';
  const description =
    mode === 'create'
      ? 'Create a group and choose the workspaces and agent homes shown in Overview.'
      : 'Rename or change the workspaces and agent homes in this group.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden p-3 sm:p-4 gap-3 sm:gap-4 max-w-[calc(100vw-0.5rem)] sm:max-w-[480px] sm:max-h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="shrink-0 space-y-2">
          <Label htmlFor="overview-group-name">Group name</Label>
          <Input
            id="overview-group-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            maxLength={NAME_LIMIT}
            placeholder="e.g. Active Projects"
            aria-invalid={!!nameError}
          />
          {nameError && (
            <p className="text-xs text-destructive">{nameError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {name.length}/{NAME_LIMIT}
          </p>
        </div>

        <Separator className="shrink-0" />

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain dialog-scrollbar">
          <Label className="mb-2 block">Workspaces and agent homes</Label>
          {workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No workspaces or agent homes available on this server.
            </p>
          ) : (
            <div className="space-y-1">
              {orderedWorkspaces.map((workspace) => {
                const isSelected = selectedWorkspaceIds.includes(workspace.id);
                const selectedIndex = visibleSelectedWorkspaceIds.indexOf(workspace.id);
                const displayName = getWorkspaceDisplayName(workspace, agents);
                return (
                  <div
                    key={workspace.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <Checkbox
                      id={`overview-group-workspace-${workspace.id}`}
                      checked={isSelected}
                      onCheckedChange={() => toggleWorkspace(workspace.id)}
                    />
                    <label
                      htmlFor={`overview-group-workspace-${workspace.id}`}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                    >
                      {isAgentHomeWorkspace(workspace) ? (
                        <Bot className="size-4 text-muted-foreground" />
                      ) : workspace.isVirtual ? (
                        <Box className="size-4 text-muted-foreground" />
                      ) : (
                        <Folder className="size-4 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm">{displayName}</span>
                      {isAgentHomeWorkspace(workspace) && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {AGENT_HOME_LABEL}
                        </Badge>
                      )}
                    </label>
                    {isSelected && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveWorkspace(workspace.id, -1)}
                          disabled={selectedIndex === 0}
                          className="rounded p-1 hover:bg-secondary disabled:opacity-30"
                          aria-label={`Move ${displayName} up`}
                          title="Move up"
                        >
                          <ArrowUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWorkspace(workspace.id, 1)}
                          disabled={selectedIndex === visibleSelectedWorkspaceIds.length - 1}
                          className="rounded p-1 hover:bg-secondary disabled:opacity-30"
                          aria-label={`Move ${displayName} down`}
                          title="Move down"
                        >
                          <ArrowDown className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {mode === 'edit' && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="mr-auto"
            >
              <Trash2 className="size-4" />
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!nameError}>
            {mode === 'create' ? (
              <>
                <Plus className="size-4" />
                Create
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
