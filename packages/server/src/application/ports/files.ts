/**
 * Inward-facing filesystem application port (S5 filesystem implementation
 * isolation). Structural contracts only; no store, service, or Hono types
 * cross this boundary. The files application use cases orchestrate every
 * routes/files.ts operation through this port; the Jean2 adapter
 * (`adapters/jean2/files.ts`) fills it with the infrastructure filesystem
 * implementations over the C6 workspace path policy.
 */

import type {
  FileEntry,
  FilePreviewResponse,
  GitAvailability,
  GitDiffSummary,
  GitFileDiffResponse,
  Workspace,
} from '@prokopai/sdk';
import type { EditableFileResponse, SaveFileResponse, GitRepositoryState, GitCommitInput, GitCommitResult, GitPushInput, GitPushResult, GitPushPreviewInput } from '@prokopai/sdk';
import type {
  CreateFileResponse,
  DeleteFileResponse,
  RenameFileResponse,
} from '@prokopai/sdk';

export interface EditableFileWorkspaceLike {
  path: string;
  additionalPaths: string[];
}

export interface GitStatusResult {
  availability: GitAvailability;
  files: Map<string, GitDiffSummary>;
}

export interface FilesApplicationPort {
  gitRebaseState(root: string): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRebaseConflict(root: string, path: string): Promise<import('@prokopai/sdk').GitRebaseConflict>;
  gitRebaseStart(root: string, input: import('@prokopai/sdk').GitRebaseStart): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRebaseControl(root: string, input: import('@prokopai/sdk').GitRebaseControl): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRebaseResolve(root: string, input: import('@prokopai/sdk').GitRebaseResolution): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRemoveStagedAddition(root: string, path: string): Promise<{ path: string }>;
  gitBranches(root: string): Promise<import('@prokopai/sdk').GitBranchesResult>;
  gitHistory(root: string, head: string, offset: number): Promise<import('@prokopai/sdk').GitHistoryResult>;
  gitCommitDetails(root: string, head: string): Promise<import('@prokopai/sdk').GitCommitDetails>;
  gitBranchPushReview(root: string, input: import('@prokopai/sdk').GitBranchPushTarget): Promise<import('@prokopai/sdk').GitBranchPushReview>;
  gitBranchAction(root: string, input: import('@prokopai/sdk').GitBranchAction): Promise<{ warning?: string }>;
  getWorkspace(workspaceId: string): Workspace | null;

  /** Root resolution for an optional `root` query (C6 workspace policy). */
  resolveRoot(
    workspace: EditableFileWorkspaceLike,
    rootQuery?: string,
  ): { root: string; isMain: boolean };

  /** Expands a `~`-prefixed path through the C6 workspace path policy
   * (`~` and `~/` join the active home; other inputs resolve verbatim,
   * so `~user` anchors at the process cwd exactly like the pre-slice
   * browse helper). */
  expandPathFor(inputPath: string): string;

  /** Separator-aware workspace containment (C6 workspace policy). */
  isPathWithinWorkspace(
    targetPath: string,
    workspacePath: string,
    additionalPaths?: string[],
  ): boolean;

  /** Lists directory entries; hidden handling identical to the pre-slice
   * service. */
  listDirectory(dirPath: string, showHidden?: boolean): Promise<FileEntry[]>;

  /** Search under a root with the exact fast-glob/ignore behavior. */
  searchFiles(
    rootPath: string,
    query: string,
    limit?: number,
    showHidden?: boolean,
    signal?: AbortSignal,
  ): Promise<FileEntry[]>;

  /** Preview a path under a workspace with additional roots. */
  previewFile(
    workspacePath: string,
    relativePath: string,
    additionalPaths: string[],
  ): Promise<FilePreviewResponse>;

  /** Editable read with the exact containment, realpath, and error
   * behavior. */
  readEditableFile(
    workspace: EditableFileWorkspaceLike,
    inputPath: string,
    rootQuery?: string,
  ): Promise<EditableFileResponse>;

  /** Editable save with the exact optimistic concurrency and atomic
   * rename-over-target behavior. */
  saveFile(
    workspace: EditableFileWorkspaceLike,
    input: { path: string; content: string; expectedRevision: string; root?: string; force?: boolean },
  ): Promise<SaveFileResponse>;

  /** Full recursive root-relative path listing for one workspace root. */
  listTreePaths(
    workspace: EditableFileWorkspaceLike,
    input: { root?: string; showHidden?: boolean },
  ): Promise<{ root: string; isMain: boolean; paths: string[]; truncated: boolean }>;

  /** Create an empty file or directory (with parent creation). */
  createFileEntry(
    workspace: EditableFileWorkspaceLike,
    input: { path: string; kind?: 'file' | 'directory'; root?: string; createParents?: boolean },
  ): Promise<CreateFileResponse>;

  /** Rename or move an entry within the selected root. */
  renameFileEntry(
    workspace: EditableFileWorkspaceLike,
    input: { from: string; to: string; root?: string; overwrite?: boolean },
  ): Promise<RenameFileResponse>;

  /** Delete a file or directory (recursive flag for non-empty dirs). */
  deleteFileEntry(
    workspace: EditableFileWorkspaceLike,
    input: { path: string; root?: string; recursive?: boolean },
  ): Promise<DeleteFileResponse>;

  /** Add one untracked file to the index in the authorized selected root. */
  gitAdd(workspacePath: string, relativePath: string): Promise<{ path: string }>;

  gitRepository(root: string): Promise<GitRepositoryState>;
  gitCommit(root: string, input: GitCommitInput): Promise<GitCommitResult>;
  gitPush(root: string, input: GitPushInput): Promise<GitPushResult>;
  gitPushPreview(root: string, input: GitPushPreviewInput): Promise<{ remoteHead: string | null }>;

  /** Git status for a workspace root. */
  gitStatus(workspacePath: string): Promise<GitStatusResult>;

  /** Attaches git summaries to directory entries. */
  attachGitStatusToEntries(
    entries: FileEntry[],
    listedPath: string,
    gitStatus: GitStatusResult,
  ): FileEntry[];

  /** Git diff for one path under a workspace root. */
  gitDiff(
    workspacePath: string,
    relativePath: string,
    additionalPaths?: string[],
  ): Promise<GitFileDiffResponse>;
}
