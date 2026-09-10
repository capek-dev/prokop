import type { ControllerGatedAction as CapekControllerGatedAction } from '@capekai/types';
import type { ServerMessage as CapekServerMessage } from '@capekai/types/wire';
import type { ManagedWorktree } from '../shared-types/worktree';

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

export type ServerMessage = CapekServerMessage | WorktreeUpdatedMessage | WorktreeDeletedMessage | GitChangedMessage | LearningChangedMessage;

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
