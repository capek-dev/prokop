import type { PermissionRiskLevel } from './permission';
import type { AutoApproveSeverity } from './session';
import type { WorkspaceLearningSettings } from './learning';
import type { PermissionMode } from './session';

export interface WorkspaceMemorySettings {
  enabled: boolean;
  permissionRisk: PermissionRiskLevel;
}

export interface WorkspaceSkillSettings {
  managementEnabled: boolean;
  permissionRisk: PermissionRiskLevel;
}

export interface WorkspaceSessionSearchSettings {
  enabled: boolean;
  permissionRisk: PermissionRiskLevel;
  includeToolResults: boolean;
}

export interface WorkspaceWorkflowSettings {
  enabled: boolean;
}

export interface WorkspaceSchedulingSettings {
  enabled: boolean;
  permissionRisk: PermissionRiskLevel;
}

export interface WorkspacePreconfigSettings {
  /** Preconfig IDs that are selected/visible for this workspace. Null/undefined means all primary preconfigs. */
  selectedIds: string[] | null;
  /** Default preconfig ID for this workspace (used by New Chat). Null means use first primary preconfig. */
  defaultId: string | null;
}

export interface WorkspaceSettings {
  memory?: WorkspaceMemorySettings;
  skills?: WorkspaceSkillSettings;
  sessionSearch?: WorkspaceSessionSearchSettings;
  workflow?: WorkspaceWorkflowSettings;
  scheduling?: WorkspaceSchedulingSettings;
  /** @deprecated Permissions-v2 workspaces carry their own permission-mode
   * default; this legacy ladder is no longer read. */
  autoApproveSeverity?: AutoApproveSeverity | null;
  preconfigs?: WorkspacePreconfigSettings;
  isAgentHome?: boolean;
  agentId?: string;

  /** Default permission mode for new sessions in this workspace.
   * Absent (legacy rows before migration) means 'standard'. */
  permissionMode?: PermissionMode;
  learning?: WorkspaceLearningSettings;
  /** Active session groups, defaults to tagged-first when absent. */
  sessionTagOrder?: 'tagged-first' | 'untagged-first';
  /** Independent of workspace learning. Absent on legacy workspaces means allowed. */
  allowPersonalLearning?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  isVirtual: boolean;
  additionalPaths: string[];
  settings: WorkspaceSettings;
  createdAt: string;
  updatedAt: string;

  /** Latest user/assistant message creation time (epoch ms), null when empty. */
  lastConversationAt?: number | null;
}
