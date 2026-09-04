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
  /** Hard-deletes a removed record. Returns true when a row was deleted. */
  delete(id: string): boolean;
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
  /** Drops the managed-worktree reference from lingering terminal rows so a
   * removed worktree record can be purged despite the foreign key. */
  clearWorktreeReferences(worktreeId: string): void;
}

export interface WorktreeEventPort {
  worktreeChanged(worktree: ManagedWorktree): void;
  /** The record row was purged after removal; clients drop the worktree. */
  worktreeDeleted(worktree: ManagedWorktree): void;
  sessionChanged(session: Session): void;
}

export interface WorktreeAttachmentRefreshPort {
  changed(worktreeId: string): void;
}
