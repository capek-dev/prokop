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

export type SessionHarness = 'prokop' | 'codex-cli';

export interface CodexModel {
  model: string;
  name: string;
  supportedEfforts: string[];
  defaultEffort: string;
  isDefault: boolean;
}

export interface CodexModelSelection {
  model: string;
  effort: string;
}

export interface Session extends CapekSession {
  /** Persisted execution owner; missing values from older hosts mean Prokop. */
  harness?: SessionHarness;
  workspaceRootId?: string | null;
  worktree?: SessionWorktreeBinding | null;
}
