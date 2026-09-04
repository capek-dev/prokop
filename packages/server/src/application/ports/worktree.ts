import type {
  GitWorktreeRef,
  ManagedWorktree,
  ManagedWorktreeState,
  Session,
  Workspace,
} from '@prokopai/sdk';

export interface ManagedWorktreeRecord {
  id: string;
  name: string;
  workspaceId: string;
  repositoryId: string;
  repositoryRoot: string;
  path: string;
  branch: string | null;
  head: string | null;
  state: ManagedWorktreeState;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedWorktreeRepositoryPort {
  listByWorkspace(workspaceId: string): ManagedWorktreeRecord[];
  listByRepository(repositoryId: string): ManagedWorktreeRecord[];
  get(id: string): ManagedWorktreeRecord | null;
  create(record: ManagedWorktreeRecord): ManagedWorktreeRecord;
  update(
    id: string,
    updates: Partial<Pick<ManagedWorktreeRecord, 'branch' | 'head' | 'state'>>,
  ): ManagedWorktreeRecord | null;
}

export interface WorktreeGitStatus {
  branch: string | null;
  head: string | null;
  dirty: boolean;
  untrackedCount: number;
}

export interface WorktreeRepositoryIdentity {
  repositoryId: string;
  repositoryRoot: string;
  repositoryTopLevel: string;
  selectedRoot: string;
}

export interface WorktreeGitPort {
  inspectRepository(path: string): Promise<WorktreeRepositoryIdentity>;
  listRefs(path: string): Promise<GitWorktreeRef[]>;
  create(options: {
    repositoryPath: string;
    destinationPath: string;
    branch: string;
  }): Promise<WorktreeGitStatus>;
  status(path: string): Promise<WorktreeGitStatus>;
  remove(repositoryPath: string, worktreePath: string): Promise<void>;
}

export interface WorktreeSessionPort {
  get(id: string): Session | null;
  listByWorkspace(workspaceId: string): Session[];
  updateWorkspaceRoot(id: string, workspaceRootId: string | null): Session | null;
  hasMessages(sessionId: string): boolean;
  isRunning(session: Session): boolean;
}

export interface WorktreeWorkspacePort {
  get(id: string): Workspace | null;
}

export interface WorktreeTerminalPort {
  listForWorktree(
    worktreeId: string,
    path: string,
  ): Array<{ id?: string; cwd?: string; managedWorktreeId?: string }>;
}

export interface WorktreeEventPort {
  worktreeChanged(worktree: ManagedWorktree): void;
  sessionChanged(session: Session): void;
}

export interface WorktreeAttachmentRefreshPort {
  changed(worktreeId: string): void;
}
