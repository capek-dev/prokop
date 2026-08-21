import { useState } from 'react';
import { FolderOpen, Plus, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { OverviewGroupDialog } from '@/components/modals/OverviewGroupDialog';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';
import type { Workspace } from '@prokopai/sdk';

interface WorkspaceGroupMembershipMenuProps {
  workspace: Workspace;
  serverId: string;
}

export function WorkspaceGroupMembershipMenu({
  workspace,
  serverId,
}: WorkspaceGroupMembershipMenuProps) {
  const document = useOverviewGroupsStore((s) => s.document);
  const actions = useOverviewGroupsStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const serverGroups = document.groups.filter((g) => g.serverId === serverId);
  const isInAnyGroup = serverGroups.some((g) =>
    g.workspaceIds.includes(workspace.id),
  );

  const handleToggle = (
    groupId: string,
    e: React.MouseEvent | React.KeyboardEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    actions.toggleWorkspace(groupId, workspace.id);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1 rounded hover:bg-secondary transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            title={
              isInAnyGroup
                ? 'In overview groups'
                : 'Add to overview group'
            }
          >
            <FolderOpen
              className={`size-4 ${isInAnyGroup ? 'fill-primary text-primary' : 'text-muted-foreground'}`}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-52"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Add to group
          </div>
          {serverGroups.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">
              No groups yet
            </div>
          ) : (
            serverGroups.map((group) => {
              const checked = group.workspaceIds.includes(workspace.id);
              return (
                <DropdownMenuItem
                  key={group.id}
                  className="gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleToggle(group.id, e);
                  }}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {}}
                    className="pointer-events-none"
                  />
                  <Check
                    className={`size-3.5 ${checked ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span className="truncate">{group.name}</span>
                </DropdownMenuItem>
              );
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowCreateDialog(true);
            }}
          >
            <Plus className="size-4" />
            Create group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showCreateDialog && (
        <OverviewGroupDialog
          open={true}
          onOpenChange={(open) => { if (!open) setShowCreateDialog(false); }}
          mode="create"
          serverId={serverId}
          groups={serverGroups}
          workspaces={[workspace]}
          preselectedWorkspaceId={workspace.id}
          actions={actions}
        />
      )}
    </>
  );
}
