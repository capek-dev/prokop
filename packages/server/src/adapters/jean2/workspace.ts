import { existsSync, mkdirSync } from 'fs';
import {
  addWorkspaceAdditionalPath,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceAutoApproveSeverity,
  listAgentHomeWorkspaces,
  listWorkspaces,
  removeWorkspaceAdditionalPath,
  updateWorkspace,
} from '@/infrastructure/sqlite/workspaces';
import {
  cleanupSessionsOutputDirs,
  decodeSessionCursor,
  DEFAULT_PAGE_SIZE,
  encodeSessionCursor,
  listSessionPageByWorkspace,
  listSessionsByWorkspace,
} from '@/infrastructure/sqlite/session-store';
import {
  listPinnedMessagesByWorkspace,
  pinMessage,
  unpinMessage,
} from '@/infrastructure/sqlite/pinned-messages';
import { deleteScheduledJobsByWorkspace } from '@/infrastructure/sqlite/scheduled-job-store';
import { getTerminalManager } from '@/transport/terminal';
import { shutdownWorkspace } from '@/infrastructure/mcp';
import { getWorkspacesDir } from '@/infrastructure/runtime/paths';
import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import type {
  WorkspaceCleanupPort,
  WorkspaceDirectoryPort,
  WorkspacePathConfigPort,
  WorkspacePinnedPort,
  WorkspaceRepositoryPort,
  WorkspaceSessionCursor,
  WorkspaceSessionListingPort,
  WorkspaceTerminalPort,
} from '@/application/ports/workspace';

/**
 * Jean2 workspace port adapters (S4). These wrap the current store, session
 * listing, pinned-message, terminal transport, MCP, and paths
 * implementations with their exact identities. The workspace use cases own
 * the policy; the file-access containment policy lives in the workspace
 * domain.
 */

export function createJean2WorkspaceRepositoryPort(): WorkspaceRepositoryPort {
  return {
    list: listWorkspaces,
    listAgentHomes: listAgentHomeWorkspaces,
    get: getWorkspace,
    create: createWorkspace,
    update: updateWorkspace,
    delete: deleteWorkspace,
    addAdditionalPath: addWorkspaceAdditionalPath,
    removeAdditionalPath: removeWorkspaceAdditionalPath,
    autoApproveSeverity: getWorkspaceAutoApproveSeverity,
  };
}

export function createJean2WorkspaceSessionListingPort(): WorkspaceSessionListingPort {
  return {
    listByWorkspace: (workspaceId, options) => listSessionsByWorkspace(workspaceId, options),
    listPageByWorkspace: (workspaceId, options) =>
      listSessionPageByWorkspace(workspaceId, options) as unknown as ReturnType<
        WorkspaceSessionListingPort['listPageByWorkspace']
      >,
    encodeCursor: (payload) => encodeSessionCursor(payload as never),
    decodeCursor: (cursor) => decodeSessionCursor(cursor) as WorkspaceSessionCursor | null,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    cleanupOutputDirs: cleanupSessionsOutputDirs,
  };
}

export function createJean2WorkspacePinnedPort(): WorkspacePinnedPort {
  return {
    list: listPinnedMessagesByWorkspace,
    pin: pinMessage,
    unpin: unpinMessage,
  };
}

export function createJean2WorkspaceTerminalPort(): WorkspaceTerminalPort {
  return {
    listForWorkspace: (workspacePath) =>
      getTerminalManager().listSessionsForWorkspace(workspacePath) as unknown as ReturnType<
        WorkspaceTerminalPort['listForWorkspace']
      >,
    createDetached: (options) => getTerminalManager().createSessionDetached(options),
    get: (sessionId) => getTerminalManager().getSession(sessionId) as unknown as ReturnType<
      WorkspaceTerminalPort['get']
    >,
    destroyById: (sessionId) => getTerminalManager().destroySessionById(sessionId),
    destroyForWorkspace: (workspacePath) =>
      getTerminalManager().destroySessionsForWorkspace(workspacePath),
  };
}

export function createJean2WorkspaceCleanupPort(): WorkspaceCleanupPort {
  return {
    mcpShutdown: shutdownWorkspace,
    deleteScheduledJobs: deleteScheduledJobsByWorkspace,
  };
}

export function createJean2WorkspaceDirectoryPort(): WorkspaceDirectoryPort {
  return {
    mkdir: (path) => {
      mkdirSync(path, { recursive: true });
    },
    exists: existsSync,
  };
}

export function createJean2WorkspacePathConfigPort(): WorkspacePathConfigPort {
  return {
    workspacesDir: getWorkspacesDir,
    expandPath: (path) => workspacePathPolicyPort.expandPath(path),
  };
}
