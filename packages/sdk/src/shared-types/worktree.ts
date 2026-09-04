export type ManagedWorktreeState = 'available' | 'removing' | 'missing' | 'removed';

export interface ManagedWorktreeAttachment {
  sessionId: string;
  title: string | null;
  running: boolean;
}

export interface ManagedWorktree {
  id: string;
  name: string;
  workspaceId: string;
  repositoryId: string;
  path: string;
  branch: string | null;
  head: string | null;
  state: ManagedWorktreeState;
  dirty: boolean;
  untrackedCount: number;
  attachments: ManagedWorktreeAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionWorktreeBinding {
  id: string;
  name: string;
  branch: string | null;
  path: string;
  state: ManagedWorktreeState;
}

export type GitWorktreeRefKind = 'local' | 'remote';

export interface GitWorktreeRef {
  name: string;
  ref: string;
  kind: GitWorktreeRefKind;
  commit: string;
  current: boolean;
  checkedOut: boolean;
}

export interface CreateManagedWorktreeInput {
  name: string;
  branch: string;
}
