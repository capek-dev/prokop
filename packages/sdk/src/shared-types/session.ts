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

export type SessionHarness = 'prokop' | 'codex-cli' | 'claude-cli';

export type HarnessModelChoice =
  | { harness: 'prokop'; modelId: string; providerId: string }
  | { harness: 'codex-cli'; modelId: string; effort: string }
  | { harness: 'claude-cli'; modelId: string; effort: string };

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

export interface SessionHarnessCompactionState {
  /** Native compaction in progress server-side; input stays locked. */
  pending: boolean;
  /** Native compaction outcome uncertain; input stays locked until resolved. */
  uncertain: boolean;
  /** Message id of the last successful native compaction boundary, if any. */
  boundaryMessageId: string | null;
}

export interface SessionHarnessForkState {
  /** 'any' = unrestricted; 'assistant-only' = fork target must be an
   * assistant reply; 'restricted' = refused after Goal/Compact with the
   * reason on this state. */
  mode: 'any' | 'assistant-only' | 'restricted';
  /** Human-readable reason when the mode is 'restricted'. */
  reason?: string;
}

export interface SessionHarnessState {
  compaction: SessionHarnessCompactionState;
  fork: SessionHarnessForkState;
  /** True when a native Goal outcome is uncertain and locks the input. */
  goalUncertain: boolean;
  /** Native-harness approval tool-call prefix ('codex-approval:' and
   * similar); absent on the Prokop runtime. */
  nativeApprovalPrefix?: string;
  capabilities: {
    /** Whether queued messages can be removed in this harness. */
    canRemoveQueuedMessages: boolean;
    /** Whether a running native subagent session offers a Stop control. */
    canInterruptSubagent: boolean;
    /** Whether subagent activity marks ancestor sessions as running. */
    subagentActivityPropagates: boolean;
  };
}

export interface Session extends CapekSession {
  /** Persisted execution owner; missing values from older hosts mean Prokop. */
  harness?: SessionHarness;
  /** Server-normalized harness state derived from the persisted harness and
   * its metadata; clients read these fields instead of per-harness metadata
   * keys or identity checks. */
  harnessState?: SessionHarnessState;
  workspaceRootId?: string | null;
  worktree?: SessionWorktreeBinding | null;
}
