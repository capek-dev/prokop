import type {
  Session as CapekSession,
} from '@capekai/types/session';
import type { SessionWorktreeBinding } from './worktree';

export type {
  AutoApproveSeverity,
  SessionStatus,
  SubagentStatus,
} from '@capekai/types/session';

export interface Session extends CapekSession {
  workspaceRootId?: string | null;
  worktree?: SessionWorktreeBinding | null;
}
