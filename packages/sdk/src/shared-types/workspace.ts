import type {
  Workspace as RuntimeWorkspace,
  WorkspaceSettings as RuntimeWorkspaceSettings,
} from '@capekai/types/workspace';
import type { WorkspaceLearningSettings } from './learning';

export * from '@capekai/types/workspace';

/** Product settings remain outside the neutral runtime contracts. */
export interface WorkspaceSettings extends RuntimeWorkspaceSettings {
  learning?: WorkspaceLearningSettings;
  /** Independent of workspace learning. Absent on legacy workspaces means allowed. */
  allowPersonalLearning?: boolean;
}

export interface Workspace extends RuntimeWorkspace {
  settings: WorkspaceSettings;
  /** Latest user/assistant message creation time (epoch ms), null when empty. */
  lastConversationAt?: number | null;
}
