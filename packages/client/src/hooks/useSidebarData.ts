import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import type { Session, Workspace, SavedServer, QuickConnection } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useAskStore, type PendingAskRequest } from '@/stores/askStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useServerContext } from '@/contexts/ServerContext';
import type { ChildrenMap, SessionDerivedValuesMap } from '@/components/layout/SessionMenuButton';

export interface UseSidebarDataReturn {
  // Store subscriptions
  allSessions: Session[];
  currentSession: Session | null;
  currentSessionId: string | null;
  streamingSessionIds: Set<string>;
  pendingAskRequests: PendingAskRequest[];
  connected: boolean;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;

  // Server context
  servers: SavedServer[];
  quickConnections: QuickConnection[];
  addToQuickConnections: (serverId: string, serverName: string, workspaceId?: string, workspaceName?: string) => void;
  removeFromQuickConnections: (id: string) => void;

  // Derived values
  activeServer: SavedServer | null;
  childrenMap: ChildrenMap;
  sessionDerivedValues: SessionDerivedValuesMap;
  sessions: Session[];
  activeSessions: Session[];
  archivedSessions: Session[];
  scheduledSessionsByJob: Map<string, Session[]>;
  tagGroups: Map<string, Session[]>;
  orderedTagNames: string[];
}

export const useSidebarData = (): UseSidebarDataReturn => {
  // Read from stores
  const allSessions = useSessionStore(s => s.sessions);
  const streamingSessionIds = useConnectionStore(s => s.streamingSessionIds);
  const pendingAskRequests = useAskStore(s => s.pendingRequests);
  const connected = useConnectionStore(s => s.connected);
  const workspaces = useServerDataStore(s => s.workspaces);
  const activeWorkspace = useServerDataStore(s => s.activeWorkspace);

  // Derive currentSession from URL params (sessionId from nested route)
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const sessionIdFromUrl = params?.sessionId as string | undefined;

  const currentSession = useMemo(
    () => sessionIdFromUrl ? allSessions.find(s => s.id === sessionIdFromUrl) ?? null : null,
    [sessionIdFromUrl, allSessions],
  );
  const currentSessionId = currentSession?.id ?? null;

  // Derive activeServer from ServerContext and URL params
  const { servers, quickConnections, addToQuickConnections, removeFromQuickConnections } = useServerContext();
  const activeServer = serverId ? servers.find(s => s.id === serverId) ?? null : null;

  // Derive workspaceSessions (was the old `sessions` prop)
  const sessions = useMemo(
    () => allSessions.filter(s => s.workspaceId === activeWorkspace?.id),
    [allSessions, activeWorkspace?.id],
  );

  // Precompute childrenMap from allSessions for overview mode compatibility
  const childrenMap = useMemo((): ChildrenMap => {
    const map = new Map<string, Session[]>();
    for (const session of allSessions) {
      if (session.parentId) {
        const existing = map.get(session.parentId) ?? [];
        existing.push(session);
        map.set(session.parentId, existing);
      }
    }
    return map;
  }, [allSessions]);

  // Precompute derived values from allSessions for overview mode compatibility
  const sessionDerivedValues = useMemo((): SessionDerivedValuesMap => {
    // Build a parent lookup for walking up to root ancestors
    const parentMap = new Map<string, string>();
    for (const session of allSessions) {
      if (session.parentId) {
        parentMap.set(session.id, session.parentId);
      }
    }

    const pendingPermissionSessionIds = new Set<string>();
    for (const p of pendingAskRequests) {
      if (p.ask.type !== 'permission') {
        continue;
      }
      // Add the sessionId and originSessionId directly
      pendingPermissionSessionIds.add(p.sessionId);
      if (p.originSessionId) {
        pendingPermissionSessionIds.add(p.originSessionId);
      }
      // Walk up to root ancestor and ensure root also has the badge
      for (const sid of [p.sessionId, p.originSessionId]) {
        if (!sid) continue;
        let current = parentMap.get(sid);
        while (current) {
          pendingPermissionSessionIds.add(current);
          current = parentMap.get(current);
        }
      }
    }

    const derived = new Map<string, { isStreaming: boolean; hasPendingPermission: boolean; isRunning: boolean }>();
    for (const session of allSessions) {
      const isStreaming = streamingSessionIds.has(session.id);
      const hasPendingPermission = pendingPermissionSessionIds.has(session.id);
      const isCurrentSession = session.id === currentSessionId;
      const isRunning = (isCurrentSession && isStreaming) || session.subagentStatus === 'running' || !!session.runningAt;
      derived.set(session.id, { isStreaming, hasPendingPermission, isRunning });
    }
    return derived;
  }, [allSessions, streamingSessionIds, pendingAskRequests, currentSessionId]);

  // Separate active, archived, and scheduled sessions (only root sessions, no parent)
  const { activeSessions, archivedSessions, scheduledSessionsByJob } = useMemo(() => {
    const rootSessions = sessions.filter((s) => !s.parentId);
    const scheduled = rootSessions.filter((s) => s.metadata?.scheduledJobId);
    const scheduledJobIds = new Set(scheduled.map((s) => s.metadata?.scheduledJobId as string));

    // Group scheduled sessions by job ID
    const byJob = new Map<string, Session[]>();
    for (const s of scheduled) {
      const jobId = s.metadata?.scheduledJobId as string;
      const existing = byJob.get(jobId) ?? [];
      existing.push(s);
      byJob.set(jobId, existing);
    }

    return {
      activeSessions: rootSessions.filter(
        (s) => s.status === 'active' && !scheduledJobIds.has(s.metadata?.scheduledJobId as string),
      ),
      archivedSessions: rootSessions.filter((s) => s.status === 'closed'),
      scheduledSessionsByJob: byJob,
    };
  }, [sessions]);

  // Derive tag groups from activeSessions
  const tagGroups = useMemo((): Map<string, Session[]> => {
    const groups = new Map<string, Session[]>();
    const ungrouped: Session[] = [];

    for (const session of activeSessions) {
      const primaryTag = session.tags?.[0];
      if (primaryTag) {
        const existing = groups.get(primaryTag) ?? [];
        existing.push(session);
        groups.set(primaryTag, existing);
      } else {
        ungrouped.push(session);
      }
    }

    if (ungrouped.length > 0) {
      groups.set('__ungrouped__', ungrouped);
    }

    return groups;
  }, [activeSessions]);

  // Derive ordered tag names (sorted by most recently updated session in group)
  const orderedTagNames = useMemo((): string[] => {
    const entries: { tag: string; lastUpdated: number }[] = [];
    for (const [tag, sessions] of tagGroups) {
      if (tag === '__ungrouped__') continue;
      let latest = 0;
      for (const s of sessions) {
        const ts = new Date(s.updatedAt).getTime();
        if (ts > latest) latest = ts;
      }
      entries.push({ tag, lastUpdated: latest });
    }
    entries.sort((a, b) => b.lastUpdated - a.lastUpdated);
    return entries.map(e => e.tag);
  }, [tagGroups]);

  return {
    allSessions,
    currentSession,
    currentSessionId,
    streamingSessionIds,
    pendingAskRequests,
    connected,
    workspaces,
    activeWorkspace,
    servers,
    quickConnections,
    addToQuickConnections,
    removeFromQuickConnections,
    activeServer,
    childrenMap,
    sessionDerivedValues,
    sessions,
    activeSessions,
    archivedSessions,
    scheduledSessionsByJob,
    tagGroups,
    orderedTagNames,
  };
};
