import type {
  AutoApproveSeverity,
  PinnedMessage,
  Session,
  SessionStatus,
  Workspace,
  WorkspaceSettings,
} from '@prokopai/sdk';

/**
 * Inward-facing workspace ports (S4). The workspace record policy and the
 * file-access containment policy live in the workspace domain
 * (`@/domains/workspaces`); these ports carry the repository, listing,
 * pinned-message, terminal, cleanup, and directory-filesystem seams the
 * workspace use cases orchestrate. The Jean2 adapter wraps the current
 * store, terminal transport, MCP, and paths implementations.
 */

export interface WorkspaceCreateRecord {
  id: string;
  name: string;
  path: string;
  isVirtual: boolean;
  additionalPaths?: string[];
  settings?: WorkspaceSettings;
}

export interface WorkspaceRepositoryPort {
  list(): Workspace[];
  listAgentHomes(): Workspace[];
  get(id: string): Workspace | null;
  create(input: WorkspaceCreateRecord): Workspace;
  update(
    id: string,
    updates: { name?: string; path?: string; additionalPaths?: string[]; settings?: WorkspaceSettings },
  ): Workspace | null;
  delete(id: string): boolean;
  addAdditionalPath(id: string, path: string): boolean;
  removeAdditionalPath(id: string, path: string): boolean;
  autoApproveSeverity(id: string): AutoApproveSeverity;
}

/** Opaque cursor payload carried by the session listing port. */
export interface WorkspaceSessionCursor {
  version: 1;
  updatedAt: string;
  id: string;
}

export interface WorkspaceSessionPage {
  sessions: Session[];
  nextCursor: WorkspaceSessionCursor | null;
  hasMore: boolean;
  limit: number;
}

export interface WorkspaceSessionListingPort {
  listByWorkspace(
    workspaceId: string,
    options: { status?: SessionStatus; rootOnly?: boolean },
  ): Session[];
  listPageByWorkspace(
    workspaceId: string,
    options: {
      status?: SessionStatus;
      rootOnly?: boolean;
      cursor?: WorkspaceSessionCursor;
      limit: number;
    },
  ): WorkspaceSessionPage;
  encodeCursor(payload: WorkspaceSessionCursor): string;
  decodeCursor(cursor: string): WorkspaceSessionCursor | null;
  defaultPageSize: number;
  cleanupOutputDirs(sessionIds: string[]): void;
}

export interface WorkspacePinnedPort {
  list(workspaceId: string): PinnedMessage[];
  pin(input: {
    id?: string;
    workspaceId: string;
    sessionId: string;
    messageId: string;
  }): PinnedMessage;
  unpin(workspaceId: string, messageId: string): boolean;
}

/** Structural terminal session record; the Jean2 adapter maps the
 * transport terminal manager result unchanged. */
export interface WorkspaceTerminalSession {
  [key: string]: unknown;
}

export interface WorkspaceTerminalPort {
  listForWorkspace(workspacePath: string): WorkspaceTerminalSession[];
  createDetached(options: { cwd: string; workspaceId: string }): string | null;
  get(sessionId: string): WorkspaceTerminalSession | null;
  destroyById(sessionId: string): void;
  destroyForWorkspace(workspacePath: string): void;
}

export interface WorkspaceCleanupPort {
  /** MCP workspace runtime shutdown; the use case logs and continues on
   * failure exactly like the pre-S4 route. */
  mcpShutdown(workspacePath: string): Promise<void>;
  deleteScheduledJobs(workspaceId: string): number;
}

/** Directory-filesystem seam for the workspace path validation and default
 * virtual workspace creation. */
export interface WorkspaceDirectoryPort {
  mkdir(path: string): void;
  exists(path: string): boolean;
}

export interface WorkspacePathConfigPort {
  workspacesDir(): string;
  /** Expands `~` and resolves the input path (Capek workspace policy via
   * the path policy adapter; C6 step 4). */
  expandPath(path: string): string;
}
