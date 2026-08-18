export type SessionStatus = 'active' | 'closed';

export type SubagentStatus = 'running' | 'completed' | 'error' | 'interrupted';

export type AutoApproveSeverity = 'off' | 'none' | 'low' | 'medium' | 'high';

export interface Session {
  id: string;
  workspaceId: string;  // FK to workspace
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
  autoApproveSeverity?: AutoApproveSeverity | null;  // Auto-approve risk level for permissions
  agentId?: string | null;  // Which agent ran this session. Null for non-agent sessions.
}
