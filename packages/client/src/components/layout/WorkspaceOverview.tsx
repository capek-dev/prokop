import React, { useMemo, useState, useCallback } from 'react';
import { Bot, Folder, Box, ChevronRight, Plus, Tag, Archive, MoreHorizontal, Layers } from 'lucide-react';
import type { Agent, Session, Workspace } from '@prokopai/sdk';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SessionMenuButton, type ChildrenMap, type SessionDerivedValuesMap } from './SessionMenuButton';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { OverviewGroupSelector } from './OverviewGroupSelector';
import { useTagCollapseState } from '@/hooks/useTagCollapseState';
import { useWorkspaceCollapseState } from '@/hooks/useWorkspaceCollapseState';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import type { StoreActions } from '@/hooks/useOverviewGroups';
import { getCreateSessionOptions } from '@/lib/sessionCreate';
import type { CreateSessionOptions } from '@/lib/sessionCreate';
import { getWorkspaceDisplayName, isAgentHomeWorkspace } from '@/lib/workspaceKind';

interface WorkspaceOverviewProps {
  sessionsByWorkspace: Record<string, Session[]>;
  tagGroupsByWorkspace: Record<string, Map<string, Session[]>>;
  orderedTagNamesByWorkspace: Record<string, string[]>;
  allWorkspaceTagsByWorkspace: Record<string, string[]>;
  childrenMap: ChildrenMap;
  sessionDerivedValues: SessionDerivedValuesMap;
  currentSession: Session | null;
  currentSessionId: string | null;
  workspaceIds: string[];
  workspaces: Workspace[];
  agents: Agent[];
  activeWorkspace: Workspace | null;
  isHydrated: boolean;
  groups: OverviewGroup[];
  activeGroup: OverviewGroup | null;
  groupActions: StoreActions;
  serverId: string;
  onResumeSession: (sessionId: string) => void;
  onOpenAlongside?: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onReopenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onRegenerateSessionTitle?: (sessionId: string) => void;
  onCreateSessionInWorkspace: (workspaceId: string, options?: CreateSessionOptions) => void;
  onAddTag?: (sessionId: string, tag: string) => void;
  onRemoveTag?: (sessionId: string, tag: string) => void;
  connected: boolean;
  hasMoreByWorkspace?: Record<string, boolean>;
  loadingMoreWorkspace?: string | null;
  onLoadMoreWorkspace?: (workspaceId: string) => void;
}

export const WorkspaceOverview = React.memo(function WorkspaceOverview({
  sessionsByWorkspace,
  tagGroupsByWorkspace,
  orderedTagNamesByWorkspace,
  allWorkspaceTagsByWorkspace,
  childrenMap,
  sessionDerivedValues,
  currentSession,
  currentSessionId,
  workspaceIds,
  workspaces,
  agents,
  activeWorkspace,
  isHydrated,
  groups,
  activeGroup,
  groupActions,
  serverId,
  onResumeSession,
  onOpenAlongside,
  onCloseSession,
  onReopenSession,
  onDeleteSession,
  onRenameSession,
  onRegenerateSessionTitle,
  onCreateSessionInWorkspace,
  onAddTag,
  onRemoveTag,
  connected,
  hasMoreByWorkspace,
  loadingMoreWorkspace,
  onLoadMoreWorkspace,
}: WorkspaceOverviewProps) {
  const { isTagOpen, toggleTag } = useTagCollapseState();
  const [archiveTagDialog, setArchiveTagDialog] = useState<{ workspaceId: string; tagName: string } | null>(null);

  const orderedWorkspaces = useMemo(() => {
    const workspaceMap = new Map(workspaces.map((w) => [w.id, w]));
    return workspaceIds
      .map((id) => workspaceMap.get(id))
      .filter((w): w is Workspace => w !== undefined);
  }, [workspaces, workspaceIds]);

  const activeWorkspaceId = activeWorkspace?.id ?? '';
  const { isWorkspaceOpen, toggleWorkspace } = useWorkspaceCollapseState(
    useMemo(() => [activeWorkspaceId], [activeWorkspaceId]),
  );

  const handleArchiveAllInTag = useCallback((workspaceId: string, tagName: string) => {
    const sessions = tagGroupsByWorkspace[workspaceId]?.get(tagName) ?? [];
    sessions.forEach(s => onCloseSession(s.id));
    setArchiveTagDialog(null);
  }, [tagGroupsByWorkspace, onCloseSession]);

  const renderSessionButton = (session: Session, workspaceId: string) => (
    <SessionMenuButton
      key={session.id}
      session={session}
      childrenMap={childrenMap}
      sessionDerivedValues={sessionDerivedValues}
      isActive={currentSession?.id === session.id}
      currentSessionId={currentSessionId}
      onResumeSession={onResumeSession}
      onOpenAlongside={onOpenAlongside}
      onCloseSession={onCloseSession}
      onReopenSession={onReopenSession}
      onDeleteSession={onDeleteSession}
      onRename={onRenameSession}
      onRegenerateTitle={onRegenerateSessionTitle}
      allWorkspaceTags={allWorkspaceTagsByWorkspace[workspaceId]}
      onAddTag={onAddTag}
      onRemoveTag={onRemoveTag}
    />
  );

  if (!isHydrated) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Overview</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-2 py-4">
            <div className="h-5 w-32 rounded bg-muted animate-pulse" />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (groups.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Overview</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-2 py-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No overview groups</p>
            <p className="text-xs text-muted-foreground">
              Create a group to choose and order the repositories shown here.
            </p>
            <OverviewGroupSelector
              serverId={serverId}
              groups={groups}
              activeGroup={activeGroup}
              workspaces={workspaces}
              agents={agents}
              isHydrated={isHydrated}
              actions={groupActions}
            />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <OverviewGroupSelector
        serverId={serverId}
        groups={groups}
        activeGroup={activeGroup}
        workspaces={workspaces}
        agents={agents}
        isHydrated={isHydrated}
        actions={groupActions}
      />

      {orderedWorkspaces.length === 0 ? (
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="px-2 py-6 text-center space-y-2">
              <Layers className="size-5 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No repositories in this group</p>
              <p className="text-xs text-muted-foreground">
                Edit this group to add repositories.
              </p>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : (
        <>
          {orderedWorkspaces.map((workspace) => {
            const isCurrentSessionWorkspace = currentSession?.workspaceId === workspace.id;
            const activeSessions = sessionsByWorkspace[workspace.id] || [];
            const tagGroups = tagGroupsByWorkspace[workspace.id] ?? new Map<string, Session[]>();
            const orderedTagNames = orderedTagNamesByWorkspace[workspace.id] ?? [];
            const ungroupedSessions = tagGroups.get('__ungrouped__') ?? [];
            const hasTags = orderedTagNames.length > 0;
            const isWsOpen = isWorkspaceOpen(workspace.id);

            return (
              <Collapsible
                key={workspace.id}
                open={isWsOpen}
                onOpenChange={(open) => toggleWorkspace(workspace.id, open)}
                className="group/collapsible"
              >
                <SidebarGroup>
                  <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between">
                      <span className="flex min-w-0 items-center gap-2">
                        <ChevronRight className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        {isAgentHomeWorkspace(workspace) ? (
                          <Bot className="size-3.5 shrink-0" />
                        ) : workspace.isVirtual ? (
                          <Box className="size-3.5 shrink-0" />
                        ) : (
                          <Folder className="size-3.5 shrink-0" />
                        )}
                        <span className={isCurrentSessionWorkspace ? 'truncate text-sidebar-foreground font-medium' : 'truncate'}>
                          {getWorkspaceDisplayName(workspace, agents)}
                        </span>
                      </span>
                      <Badge
                        variant="secondary"
                        aria-label={`${activeSessions.length} sessions`}
                      >
                        {activeSessions.length}
                      </Badge>
                    </CollapsibleTrigger>
                  </SidebarGroupLabel>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            onClick={(event) => onCreateSessionInWorkspace(
                              workspace.id,
                              getCreateSessionOptions(event),
                            )}
                            disabled={!connected}
                            className="w-full"
                          >
                            <Plus className="size-4" data-icon="inline-start" />
                            <span>New Chat</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                      <SidebarSeparator />
                      {isWsOpen && (
                        <>
                          {activeSessions.length === 0 ? (
                            <div className="px-2 py-1 text-xs text-muted-foreground">
                              (no active sessions)
                            </div>
                          ) : hasTags ? (
                            <>
                              {orderedTagNames.map(tagName => {
                                const sessions = tagGroups.get(tagName) ?? [];
                                const isTagGroupOpen = isTagOpen(tagName);
                                return (
                                  <Collapsible key={tagName} open={isTagGroupOpen} onOpenChange={(open) => toggleTag(tagName, open)} className="group/tag-collapsible">
                                    <div className="flex items-center px-2 py-1 text-xs font-medium text-muted-foreground">
                                      <CollapsibleTrigger asChild>
                                        <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                                          <ChevronRight className="size-3 transition-transform group-data-[state=open]/tag-collapsible:rotate-90" />
                                          <Tag className="size-3" />
                                          {tagName}
                                        </button>
                                      </CollapsibleTrigger>
                                      <Badge variant="secondary" className="ml-auto text-[10px]">{sessions.length}</Badge>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button
                                            type="button"
                                            onClick={e => e.stopPropagation()}
                                            className="p-0.5 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-opacity opacity-0 group-hover/tag-collapsible:opacity-100"
                                            title="Tag actions"
                                          >
                                            <MoreHorizontal className="size-3.5" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="min-w-48">
                                          <DropdownMenuItem onClick={e => { e.stopPropagation(); setArchiveTagDialog({ workspaceId: workspace.id, tagName }); }}>
                                            <Archive className="size-4" />
                                            Archive all
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                    {isTagGroupOpen && (
                                      <CollapsibleContent>
                                        <SidebarMenu>
                                          {sessions.map(session => renderSessionButton(session, workspace.id))}
                                        </SidebarMenu>
                                      </CollapsibleContent>
                                    )}
                                  </Collapsible>
                                );
                              })}
                              {ungroupedSessions.length > 0 && (
                                <SidebarMenu>
                                  {ungroupedSessions.map(session => renderSessionButton(session, workspace.id))}
                                </SidebarMenu>
                              )}
                            </>
                          ) : (
                            <SidebarMenu>
                              {activeSessions.map(session => renderSessionButton(session, workspace.id))}
                            </SidebarMenu>
                          )}
                          {hasMoreByWorkspace?.[workspace.id] && onLoadMoreWorkspace && (
                            <div className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => onLoadMoreWorkspace(workspace.id)}
                                disabled={loadingMoreWorkspace === workspace.id}
                                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center py-1.5 rounded-md hover:bg-sidebar-accent disabled:opacity-50"
                              >
                                {loadingMoreWorkspace === workspace.id ? 'Loading more...' : 'Load more sessions'}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            );
          })}
        </>
      )}

      <ConfirmationDialog
        open={archiveTagDialog !== null}
        onOpenChange={(open) => { if (!open) setArchiveTagDialog(null); }}
        title={`Archive all sessions in "${archiveTagDialog?.tagName ?? ''}"?`}
        description={(() => {
          const count = archiveTagDialog
            ? (tagGroupsByWorkspace[archiveTagDialog.workspaceId]?.get(archiveTagDialog.tagName)?.length ?? 0)
            : 0;
          return `This will archive ${count} session${count === 1 ? '' : 's'} with the tag "${archiveTagDialog?.tagName ?? ''}".`;
        })()}
        confirmLabel="Archive all"
        onConfirm={() => archiveTagDialog && handleArchiveAllInTag(archiveTagDialog.workspaceId, archiveTagDialog.tagName)}
      />
    </>
  );
});
