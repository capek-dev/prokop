import type { ControllerGatedAction as CapekControllerGatedAction } from '@capekai/types';
import type { ServerMessage as CapekServerMessage } from '@capekai/types/wire';
import type { ManagedWorktree } from '../shared-types/worktree';
import type { GitStatusResponse } from '../types/rest-responses';

export interface WorktreeUpdatedMessage {
  type: 'worktree.updated';
  worktree: ManagedWorktree;
}

export interface WorktreeDeletedMessage {
  type: 'worktree.deleted';
  worktree: ManagedWorktree;
}

export interface GitChangedMessage {
  type: 'git.changed';
  workspaceId: string;
  root: string;
}

export interface LearningChangedMessage {
  type: 'learning.changed';
  workspaceId: string;
}

export interface McpChangedMessage {
  type: 'mcp.changed';
  /** Null denotes global MCP configuration. */
  workspaceId: string | null;
}

export interface WorkspaceConversationActivityMessage {
  type: 'workspace.conversation_activity';
  workspaceId: string;
  lastConversationAt: number | null;
}

export interface FilesChangedMessage {
  type: 'files.changed';
  workspaceId: string;
}

/** Git status of one workspace root, pushed to its subscribers when it changes. */
export interface GitStatusMessage {
  type: 'git.status';
  workspaceId: string;
  /** Resolved absolute root; matches `GitStatusResponse.root`. */
  root: string;
  status: GitStatusResponse;
}

export type ServerMessage = CapekServerMessage | WorktreeUpdatedMessage | WorktreeDeletedMessage | GitChangedMessage | LearningChangedMessage | McpChangedMessage | WorkspaceConversationActivityMessage | FilesChangedMessage | GitStatusMessage;

/**
 * Prokopai extends the neutral Capek gate action union with session
 * transcript mutations. Prokop emits a strict superset: every Capek action
 * remains valid, plus the transcript actions gated only by this server.
 */
export type ControllerGatedAction =
  | CapekControllerGatedAction
  | 'session.compact'
  | 'session.revert'
  | 'session.fork';

export * from '@capekai/types/wire';
