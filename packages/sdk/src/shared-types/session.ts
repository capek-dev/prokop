import type { SessionWorktreeBinding } from './worktree';

export type SessionStatus = 'active' | 'closed';

export type SubagentStatus = 'running' | 'completed' | 'error' | 'interrupted';

/** @deprecated Permissions-v2 hosts carry their own permission mode; this
 * legacy five-level ladder remains exported only for backward compatibility. */
export type AutoApproveSeverity = 'off' | 'none' | 'low' | 'medium' | 'high';

export interface Session {
  id: string;
  workspaceId: string;  // FK to workspace
  /** Opaque host-owned identifier for an alternate working root within the
   * workspace. Hosts resolve and authorize this identifier before execution. */
  workspaceRootId?: string | null;
  preconfigId: string | null;
  title: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
  selectedModel?: string | null;
  selectedProvider?: string | null;
  selectedVariant?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheTokens?: number;
  parentId: string | null;    // ID of parent session (null for top-level)
  agentName: string | null;   // Name of the agent/preconfig running this session
  subagentStatus?: SubagentStatus | null;  // Status for subagent sessions only
  runningAt?: string | null;  // ISO timestamp when session started running, null when not running
  compacting?: boolean;  // Whether compaction is in progress
  tags?: string[];  // User-assigned tags for grouping (default: [])
  /** @deprecated Legacy risk ceiling for permission auto-approval;
   * permissions-v2 hosts decide via their own permission mode and
   * classified asks instead. */
  autoApproveSeverity?: AutoApproveSeverity | null;
  agentId?: string | null;  // Which agent ran this session. Null for non-agent sessions.

  /** Persisted execution owner; missing values from older hosts mean Prokop. */
  harness?: SessionHarness;
  /** Effective permission mode; the repository resolves the workspace
   * default when the session stores none. Treat missing as 'standard'. */
  permissionMode?: PermissionMode | null;
  /** Server-normalized harness state derived from the persisted harness and
   * its metadata; clients read these fields instead of per-harness metadata
   * keys or identity checks. */
  harnessState?: SessionHarnessState;
  worktree?: SessionWorktreeBinding | null;
}

/**
 * Permissions v2 product mode (docs/plans/unified-permissions.md). The
 * server-normalized effective mode: a stored null inherits the workspace
 * default, and the repository resolves that at read time so the wire always
 * carries a concrete value. The legacy `autoApproveSeverity` field remains
 * available for stored-data compatibility.
 */
export type PermissionMode = 'standard' | 'extended' | 'full';

export type SessionCategory = 'active' | 'archived' | 'scheduled';

export type SessionCategoryCounts = Record<SessionCategory, number>;

export interface SessionListFilter {
  status?: SessionStatus;
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
