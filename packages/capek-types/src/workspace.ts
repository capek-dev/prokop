import type { PermissionRiskLevel } from './permission';
import type { AutoApproveSeverity } from './session';

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
  autoApproveSeverity?: AutoApproveSeverity | null;
  preconfigs?: WorkspacePreconfigSettings;
  isAgentHome?: boolean;
  agentId?: string;
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
}
