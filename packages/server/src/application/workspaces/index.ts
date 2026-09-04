import { join } from 'path';
import type {
  PinnedMessage,
  SessionStatus,
  Workspace,
  WorkspaceSettings,
} from '@prokopai/sdk';
import type {
  WorkspaceCleanupPort,
  WorkspaceDirectoryPort,
  WorkspacePathConfigPort,
  WorkspacePinnedPort,
  WorkspaceRepositoryPort,
  WorkspaceSessionCursor,
  WorkspaceSessionListingPort,
  WorkspaceTerminalPort,
  WorkspaceTerminalSession,
} from '../ports/workspace';
import {
  workspaceNameOrDefault,
} from '@/domains/workspaces';

/**
 * Workspace use cases (S4). Owns the route-level workspace rules: the
 * default virtual workspace auto-creation, create/update input shaping
 * (path expansion and existence validation, name default), the delete
 * cleanup ordering, terminal and session listing, and pinned-message
 * operations. Transport maps the discriminated results to HTTP statuses;
 * the use cases import neither the store nor the filesystem.
 */

export interface WorkspaceApplicationDeps {
  repository: WorkspaceRepositoryPort;
  sessions: WorkspaceSessionListingPort;
  pinned: WorkspacePinnedPort;
  terminals: WorkspaceTerminalPort;
  cleanup: WorkspaceCleanupPort;
  directory: WorkspaceDirectoryPort;
  paths: WorkspacePathConfigPort;
  worktreeRoots?: {
    listAvailablePaths(workspaceId: string): string[];
    getAvailablePath(workspaceId: string, worktreeId: string): string | null;
  };
}

export type WorkspaceListResult =
  | { kind: 'ok'; workspaces: Workspace[] }
  | { kind: 'mkdir_failed' };

export type WorkspaceCreateResult =
  | { kind: 'created'; workspace: Workspace }
  | { kind: 'path_required' }
  | { kind: 'mkdir_failed' };

export type WorkspaceUpdateResult =
  | { kind: 'ok'; workspace: Workspace }
  | { kind: 'missing' }
  | { kind: 'path_not_found' }
  | { kind: 'no_fields' };

export type WorkspaceDeleteResult =
  | { kind: 'ok'; deletedSessions: string[] }
  | { kind: 'missing' };

export type WorkspaceTerminalListResult =
  | { kind: 'ok'; sessions: WorkspaceTerminalSession[] }
  | { kind: 'missing' };

export type WorkspaceTerminalCreateResult =
  | { kind: 'ok'; session: WorkspaceTerminalSession }
  | { kind: 'missing' }
  | { kind: 'invalid_path' }
  | { kind: 'limit' };

export type WorkspaceSessionListResult =
  | { kind: 'ok'; sessions: ReturnType<WorkspaceSessionListingPort['listByWorkspace']> }
  | { kind: 'missing' };

export type WorkspaceSessionPageResult =
  | { kind: 'ok'; page: ReturnType<WorkspaceSessionListingPort['listPageByWorkspace']> }
  | { kind: 'missing' }
  | { kind: 'bad_cursor' }
  | { kind: 'bad_limit' };

export type WorkspacePinnedListResult =
  | { kind: 'ok'; pinnedMessages: PinnedMessage[] }
  | { kind: 'missing' };

export interface WorkspaceApplication {
  list(): WorkspaceListResult;
  get(id: string): Workspace | null;
  create(input: {
    name?: string;
    path?: string;
    isVirtual?: boolean;
    additionalPaths?: string[];
  }): WorkspaceCreateResult;
  update(
    id: string,
    updates: {
      name?: string;
      path?: string;
      additionalPaths?: string[];
      settings?: WorkspaceSettings;
    },
  ): WorkspaceUpdateResult;
  deleteWorkspace(id: string): Promise<WorkspaceDeleteResult>;

  listTerminals(id: string): WorkspaceTerminalListResult;
  createTerminal(
    id: string,
    cwd?: string,
    managedWorktreeId?: string,
  ): WorkspaceTerminalCreateResult;
  getTerminal(sessionId: string): WorkspaceTerminalSession | null;
  destroyTerminal(sessionId: string): void;

  listSessions(
    id: string,
    options: { status?: SessionStatus; rootOnly?: boolean },
  ): WorkspaceSessionListResult;
  listSessionPage(
    id: string,
    options: {
      status?: SessionStatus;
      rootOnly?: boolean;
      cursorParam?: string;
      limitParam?: string;
    },
  ): WorkspaceSessionPageResult;

  listPinned(id: string): WorkspacePinnedListResult;
  pin(input: {
    workspaceId: string;
    sessionId: string;
    messageId: string;
  }): PinnedMessage;
  unpin(id: string, messageId: string): { kind: 'ok' } | { kind: 'missing' };
  encodeCursor(payload: WorkspaceSessionCursor): string;
}

export function createWorkspaceApplication(deps: WorkspaceApplicationDeps): WorkspaceApplication {
  return {
    list() {
      let workspaces = deps.repository.list();

      // Auto-create default virtual workspace if none exist
      if (workspaces.length === 0) {
        const path = join(deps.paths.workspacesDir(), crypto.randomUUID());

        // Create directory if it doesn't exist
        try {
          deps.directory.mkdir(path);
        } catch (err) {
          console.error('Failed to create workspace directory:', err);
          return { kind: 'mkdir_failed' };
        }

        const defaultWorkspace = deps.repository.create({
          id: crypto.randomUUID(),
          name: 'Virtual Workspace',
          path,
          isVirtual: true,
        });

        workspaces = [defaultWorkspace];
      }

      return { kind: 'ok', workspaces };
    },

    get(id) {
      return deps.repository.get(id);
    },

    create(input) {
      let path = input.path;

      // Auto-generate path for virtual workspaces if not provided
      if (input.isVirtual && !path) {
        path = join(deps.paths.workspacesDir(), crypto.randomUUID());
      }

      // Only reject if still no path (non-virtual workspaces require a path)
      if (!path) {
        return { kind: 'path_required' };
      }

      // Create directory if it doesn't exist
      try {
        const expandedPath = deps.paths.expandPath(path);
        deps.directory.mkdir(expandedPath);
        path = expandedPath;
      } catch (err) {
        console.error('Failed to create workspace directory:', err);
        return { kind: 'mkdir_failed' };
      }

      // Validate additional paths (must exist on disk)
      const validatedPaths: string[] = [];
      if (Array.isArray(input.additionalPaths)) {
        for (const p of input.additionalPaths) {
          const expanded = deps.paths.expandPath(p);
          if (deps.directory.exists(expanded)) {
            validatedPaths.push(expanded);
          }
        }
      }

      const workspace = deps.repository.create({
        id: crypto.randomUUID(),
        name: workspaceNameOrDefault(input.name),
        path,
        isVirtual: input.isVirtual || false,
        additionalPaths: validatedPaths,
      });

      return { kind: 'created', workspace };
    },

    update(id, updates) {
      if (
        !updates.name
        && updates.path === undefined
        && updates.additionalPaths === undefined
        && updates.settings === undefined
      ) {
        return { kind: 'no_fields' };
      }

      let validatedPath: string | undefined;
      if (updates.path !== undefined) {
        validatedPath = deps.paths.expandPath(updates.path);
        if (!deps.directory.exists(validatedPath)) {
          return { kind: 'path_not_found' };
        }
      }

      // Validate additional paths
      let validatedPaths: string[] | undefined;
      if (Array.isArray(updates.additionalPaths)) {
        validatedPaths = updates.additionalPaths
          .map((p: string) => deps.paths.expandPath(p))
          .filter((p: string) => deps.directory.exists(p));
      }

      const workspace = deps.repository.update(id, {
        name: updates.name,
        path: validatedPath,
        additionalPaths: validatedPaths,
        settings: updates.settings,
      });
      if (!workspace) {
        return { kind: 'missing' };
      }
      return { kind: 'ok', workspace };
    },

    async deleteWorkspace(id) {
      const workspace = deps.repository.get(id);
      if (!workspace) {
        return { kind: 'missing' };
      }

      // 1. Gather all session IDs for the workspace before deleting
      const sessions = deps.sessions.listByWorkspace(id, {});
      const sessionIds = sessions.map(s => s.id);

      // 2. Shutdown MCP workspace runtime state for that workspace
      try {
        await deps.cleanup.mcpShutdown(workspace.path);
      } catch (err) {
        console.warn(`[workspace cleanup] Failed to shutdown MCP workspace ${workspace.path}:`, err);
      }

      // 3. Destroy terminal sessions for every registered workspace root
      for (const root of [workspace.path, ...workspace.additionalPaths]) {
        deps.terminals.destroyForWorkspace(root);
      }

      // 4. Delete scheduled jobs for that workspace
      deps.cleanup.deleteScheduledJobs(id);

      // 5. Delete the workspace DB row (cascades to sessions, messages, etc.)
      const deleted = deps.repository.delete(id);
      if (!deleted) {
        return { kind: 'missing' };
      }

      // 6. Delete session-related temp/output directories for the workspace's
      // sessions. Use pre-collected session IDs since the DB cascade delete
      // has already removed the sessions.
      deps.sessions.cleanupOutputDirs(sessionIds);

      return { kind: 'ok', deletedSessions: sessionIds };
    },

    listTerminals(id) {
      const workspace = deps.repository.get(id);
      if (!workspace) {
        return { kind: 'missing' };
      }
      const roots = [
        workspace.path,
        ...workspace.additionalPaths,
        ...(deps.worktreeRoots?.listAvailablePaths(id) ?? []),
      ];
      const sessions = roots.flatMap(root => deps.terminals.listForWorkspace(root));
      return { kind: 'ok', sessions };
    },

    createTerminal(id, requestedCwd, managedWorktreeId) {
      const workspace = deps.repository.get(id);
      if (!workspace) {
        return { kind: 'missing' };
      }

      const cwd = requestedCwd ? deps.paths.expandPath(requestedCwd) : workspace.path;
      const managedWorktreePath = managedWorktreeId
        ? deps.worktreeRoots?.getAvailablePath(id, managedWorktreeId) ?? null
        : null;
      if (managedWorktreeId && managedWorktreePath !== cwd) {
        return { kind: 'invalid_path' };
      }
      const registeredRoots = [
        workspace.path,
        ...workspace.additionalPaths,
        ...(deps.worktreeRoots?.listAvailablePaths(id) ?? []),
      ];
      if (!registeredRoots.includes(cwd)) {
        return { kind: 'invalid_path' };
      }

      const sessionId = deps.terminals.createDetached({
        cwd,
        workspaceId: id,
        managedWorktreeId,
      });

      if (!sessionId) {
        return { kind: 'limit' };
      }

      const session = deps.terminals.get(sessionId);
      return { kind: 'ok', session: session ?? {} };
    },

    getTerminal(sessionId) {
      return deps.terminals.get(sessionId);
    },

    destroyTerminal(sessionId) {
      deps.terminals.destroyById(sessionId);
    },

    listSessions(id, options) {
      const workspace = deps.repository.get(id);
      if (!workspace) {
        return { kind: 'missing' };
      }
      const sessions = deps.sessions.listByWorkspace(id, options);
      return { kind: 'ok', sessions };
    },

    listSessionPage(id, options) {
      const workspace = deps.repository.get(id);
      if (!workspace) {
        return { kind: 'missing' };
      }

      let cursor: WorkspaceSessionCursor | null = null;
      if (options.cursorParam) {
        cursor = deps.sessions.decodeCursor(options.cursorParam);
        if (!cursor) {
          return { kind: 'bad_cursor' };
        }
      }

      let limit = deps.sessions.defaultPageSize;
      if (options.limitParam) {
        limit = parseInt(options.limitParam, 10);
        if (isNaN(limit) || limit < 1 || limit > 100) {
          return { kind: 'bad_limit' };
        }
      }

      const page = deps.sessions.listPageByWorkspace(id, {
        status: options.status,
        rootOnly: options.rootOnly,
        cursor: cursor ?? undefined,
        limit,
      });
      return { kind: 'ok', page };
    },

    listPinned(id) {
      const workspace = deps.repository.get(id);
      if (!workspace) {
        return { kind: 'missing' };
      }
      const pinnedMessages = deps.pinned.list(id);
      return { kind: 'ok', pinnedMessages };
    },

    pin(input) {
      return deps.pinned.pin(input);
    },

    unpin(id, messageId) {
      const workspace = deps.repository.get(id);
      if (!workspace) {
        return { kind: 'missing' };
      }
      deps.pinned.unpin(id, messageId);
      return { kind: 'ok' };
    },

    encodeCursor(payload) {
      return deps.sessions.encodeCursor(payload);
    },
  };
}
