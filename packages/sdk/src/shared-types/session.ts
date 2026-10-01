import type {
  Session as CapekSession,
} from '@capekai/types/session';
import type { SessionWorktreeBinding } from './worktree';

export type {
  AutoApproveSeverity,
  SessionStatus,
  SubagentStatus,
} from '@capekai/types/session';

/**
 * Permissions v2 product mode (docs/plans/unified-permissions.md). The
 * server-normalized effective mode: a stored null inherits the workspace
 * default, and the repository resolves that at read time so the wire always
 * carries a concrete value. Replaces the capek `autoApproveSeverity` ladder
 * (kept only as an inherited, unused field until the capek contract drops it).
 */
export type PermissionMode = 'standard' | 'extended' | 'full';

export type SessionCategory = 'active' | 'archived' | 'scheduled';

export type SessionCategoryCounts = Record<SessionCategory, number>;

export interface SessionListFilter {
  status?: import('@capekai/types/session').SessionStatus;
  rootOnly?: boolean;
  category?: SessionCategory;
}

export type SessionHarness = 'prokop' | 'codex-cli' | 'claude-cli';

/**
 * Harness registry entry. `available` reflects the host CLI probe; `enabled`
 * is the persisted server setting (both optional so older-server payloads
 * still parse, treating absence as available/enabled). Prokop is always
 * available and enabled.
 */
export interface HarnessStatus {
  id: SessionHarness;
  available: boolean;
  enabled?: boolean;
  version?: string | null;
  approvals?: boolean;
}

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

export interface SessionHarnessGoalProgress {
  /** What the progress number counts. */
  kind: 'turns' | 'tokens' | 'iterations';
  current: number;
  max: number | null;
}

export interface SessionHarnessGoalState {
  status: string;
  /** Codex objective / prokop and claude condition text. */
  objective: string | null;
  progress: SessionHarnessGoalProgress | null;
}

export interface SessionHarnessUsageRow {
  label: string;
  value: string;
}

export interface SessionHarnessUsageState {
  /** Context-occupancy numerator for the meter fill. */
  used: number;
  /** Denominator for the meter fill; 0 renders the unknown state. */
  contextWindow: number;
  /** Pre-computed display rows (label + formatted value). */
  rows: SessionHarnessUsageRow[];
}

export interface SessionHarnessState {
  compaction: SessionHarnessCompactionState;
  fork: SessionHarnessForkState;
  goal: SessionHarnessGoalState | null;
  usage: SessionHarnessUsageState | null;
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
  /** Effective permission mode; the repository resolves the workspace
   * default when the session stores none. Treat missing as 'standard'. */
  permissionMode?: PermissionMode | null;
  /** Server-normalized harness state derived from the persisted harness and
   * its metadata; clients read these fields instead of per-harness metadata
   * keys or identity checks. */
  harnessState?: SessionHarnessState;
  workspaceRootId?: string | null;
  worktree?: SessionWorktreeBinding | null;
}
