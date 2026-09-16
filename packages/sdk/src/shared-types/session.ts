import type {
  Session as CapekSession,
} from '@capekai/types/session';
import type { SessionWorktreeBinding } from './worktree';

export type {
  AutoApproveSeverity,
  SessionStatus,
  SubagentStatus,
} from '@capekai/types/session';

export type SessionCategory = 'active' | 'archived' | 'scheduled';

export type SessionCategoryCounts = Record<SessionCategory, number>;

export interface SessionListFilter {
  status?: import('@capekai/types/session').SessionStatus;
  rootOnly?: boolean;
  category?: SessionCategory;
}

export interface Session extends CapekSession {
  workspaceRootId?: string | null;
  worktree?: SessionWorktreeBinding | null;
}
