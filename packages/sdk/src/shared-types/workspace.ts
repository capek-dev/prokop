import type {
  Workspace as RuntimeWorkspace,
  WorkspaceSettings as RuntimeWorkspaceSettings,
} from '@capekai/types/workspace';
import type { WorkspaceLearningSettings } from './learning';
import type { PermissionMode } from './session';

export * from '@capekai/types/workspace';

/** Product settings remain outside the neutral runtime contracts. */
export interface WorkspaceSettings extends RuntimeWorkspaceSettings {
  /** Default permission mode for new sessions in this workspace.
   * Absent (legacy rows before migration) means 'standard'. */
  permissionMode?: PermissionMode;
  learning?: WorkspaceLearningSettings;
  /** Active session groups, defaults to tagged-first when absent. */
  sessionTagOrder?: 'tagged-first' | 'untagged-first';
  /** Independent of workspace learning. Absent on legacy workspaces means allowed. */
  allowPersonalLearning?: boolean;
}

export interface Workspace extends RuntimeWorkspace {
  settings: WorkspaceSettings;
  /** Latest user/assistant message creation time (epoch ms), null when empty. */
  lastConversationAt?: number | null;
}
