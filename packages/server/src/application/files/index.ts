/**
 * Files application use cases (S5 filesystem implementation isolation).
 * Owns the route-level orchestration for every routes/files.ts operation:
 * workspace lookup, list/search/browse, preview, editable read/save, and
 * git status/diff. Pure delegation through the inward-facing
 * `FilesApplicationPort` plus path presentation mapping; no store, service,
 * Hono, or utility imports.
 */

import { isAbsolute, join, relative, resolve, sep } from 'path';
import type {
  EditableFileResponse,
  FileEntry,
  FilePreviewResponse,
  CreateFileResponse,
  DeleteFileResponse,
  GitAvailability,
  GitRepositoryState, GitCommitInput, GitCommitResult, GitPushInput, GitPushResult, GitPushPreviewInput,
  GitDiffSummary,
  GitFileDiffResponse,
  RenameFileResponse,
  SaveFileResponse,
  Workspace,
} from '@prokopai/sdk';
import type {
  FilesApplicationPort,
  GitStatusResult,
} from '../ports/files';

export interface FilesListResult {
  files: FileEntry[];
  currentPath: string;
  mode: 'browse' | 'search';
  root: string;
  isMain: boolean;
  git?: GitAvailability;
}

export interface FilesGitStatusWire {
  availability: GitAvailability;
  files: Array<{ path: string; git: GitDiffSummary }>;
  root: string;
}

export interface FilesApplication {
  gitRebaseState(workspaceId: string, root?: string): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRebaseConflict(workspaceId: string, input: { root?: string; path: string }): Promise<import('@prokopai/sdk').GitRebaseConflict>;
  gitRebaseStart(workspaceId: string, input: import('@prokopai/sdk').GitRebaseStart): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRebaseControl(workspaceId: string, input: import('@prokopai/sdk').GitRebaseControl): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRebaseResolve(workspaceId: string, input: import('@prokopai/sdk').GitRebaseResolution): Promise<import('@prokopai/sdk').GitRebaseState>;
  gitRemoveStagedAddition(workspaceId: string, path: string, root?: string): Promise<{ path: string }>;
  gitBranches(workspaceId: string, root?: string): Promise<import('@prokopai/sdk').GitBranchesResult>;
  gitHistory(workspaceId: string, input: { root?: string; head: string; offset: number }): Promise<import('@prokopai/sdk').GitHistoryResult>;
  gitCommitDetails(workspaceId: string, input: { root?: string; head: string }): Promise<import('@prokopai/sdk').GitCommitDetails>;
  gitBranchPushReview(workspaceId: string, input: import('@prokopai/sdk').GitBranchPushTarget): Promise<import('@prokopai/sdk').GitBranchPushReview>;
  gitBranchAction(workspaceId: string, input: import('@prokopai/sdk').GitBranchAction): Promise<{ warning?: string }>;
  list(
    workspaceId: string,
    options: {
      path: string;
      search?: string;
      limit?: number;
      showHidden?: boolean;
      root?: string;
      signal?: AbortSignal;
    },
  ): Promise<FilesListResult>;
  gitRepository(workspaceId: string, rootQuery?: string): Promise<GitRepositoryState>;
  gitCommit(workspaceId: string, input: GitCommitInput): Promise<GitCommitResult>;
  gitPush(workspaceId: string, input: GitPushInput): Promise<GitPushResult>;
  gitPushPreview(workspaceId: string, input: GitPushPreviewInput): Promise<{ remoteHead: string | null }>;
  gitStatus(workspaceId: string, rootQuery?: string): Promise<FilesGitStatusWire>;
  gitDiff(workspaceId: string, path: string, rootQuery?: string): Promise<GitFileDiffResponse>;
  gitAdd(workspaceId: string, path: string, rootQuery?: string): Promise<{ path: string }>;
  previewFile(workspaceId: string, path: string, rootQuery?: string): Promise<FilePreviewResponse>;
  readEditableFile(workspaceId: string, path: string, rootQuery?: string): Promise<EditableFileResponse>;
  saveFile(
    workspaceId: string,
    input: { path: string; content: string; expectedRevision: string; root?: string; force?: boolean },
  ): Promise<SaveFileResponse>;
  listTreePaths(
    workspaceId: string,
    input: { root?: string; showHidden?: boolean },
  ): Promise<{ root: string; isMain: boolean; paths: string[]; truncated: boolean }>;
  createFileEntry(
    workspaceId: string,
    input: { path: string; kind?: 'file' | 'directory'; root?: string; createParents?: boolean },
  ): Promise<CreateFileResponse>;
  renameFileEntry(
    workspaceId: string,
    input: { from: string; to: string; root?: string; overwrite?: boolean },
  ): Promise<RenameFileResponse>;
  deleteFileEntry(
    workspaceId: string,
    input: { path: string; root?: string; recursive?: boolean },
  ): Promise<DeleteFileResponse>;
  /** Raw directory listing for the home-browse endpoints. */
  listDirectoryOnly(dirPath: string, showHidden?: boolean): Promise<FileEntry[]>;
  /** Expands a `~`-prefixed input through the C6 workspace path policy. */
  expandPathFor(inputPath: string): string;
}

export function createFilesApplication(port: FilesApplicationPort, onGitChanged?: (workspaceId: string, root: string) => void): FilesApplication {
  function resolveWorkspace(workspaceId: string): Workspace {
    const workspace = port.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    return workspace;
  }

  /** The exact pre-slice repo-relative to selected-root-relative conversion
   * from the /git/status route handler. */
  function toRootRelativeFiles(
    gitStatus: GitStatusResult,
    selectedRoot: string,
  ): Array<{ path: string; git: GitDiffSummary }> {
    const resolvedRoot = resolve(selectedRoot);
    const gitRoot = gitStatus.availability.root;
    return Array.from(gitStatus.files.entries())
      .filter(([, summary]) => summary.status !== 'ignored')
      .flatMap(([filePath, summary]) => {
        let rootRelative: string | null = filePath;
        if (gitRoot) {
          const abs = resolve(gitRoot, filePath.split('/').join(sep));
          const rel = relative(resolvedRoot, abs);
          // Skip files outside the selected root.
          if (rel.startsWith('..') || isAbsolute(rel)) rootRelative = null;
          else rootRelative = rel.split(sep).join('/');
        }
        if (rootRelative === null) return [];
        return [{ path: rootRelative, git: summary }];
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  function writeRoot(workspaceId: string, rootQuery?: string): string {
    const { root } = port.resolveRoot(resolveWorkspace(workspaceId), rootQuery);
    if (rootQuery !== undefined && (!rootQuery || resolve(root) !== resolve(port.expandPathFor(rootQuery)))) {
      throw new Error('Path outside workspace');
    }
    return root;
  }

  async function rebaseMutation<T>(workspaceId: string, rootQuery: string | undefined, run: (root: string) => Promise<T>): Promise<T> {
    const root = writeRoot(workspaceId, rootQuery);
    try { return await run(root); }
    finally { try { onGitChanged?.(workspaceId, root); } catch { /* Refresh on reconnect. */ } }
  }

  return {
    gitRebaseState: (id, root) => port.gitRebaseState(writeRoot(id, root)),
    gitRebaseConflict: (id, input) => port.gitRebaseConflict(writeRoot(id, input.root), input.path),
    gitRebaseStart: (id, input) => rebaseMutation(id, input.root, (root) => port.gitRebaseStart(root, input)),
    gitRebaseControl: (id, input) => rebaseMutation(id, input.root, (root) => port.gitRebaseControl(root, input)),
    gitRebaseResolve: (id, input) => rebaseMutation(id, input.root, (root) => port.gitRebaseResolve(root, input)),
    async gitRemoveStagedAddition(workspaceId, path, rootQuery) {
      const root = writeRoot(workspaceId, rootQuery);
      const result = await port.gitRemoveStagedAddition(root, path);
      try { onGitChanged?.(workspaceId, root); } catch { /* Client also refreshes on success. */ }
      return result;
    },
    gitBranches: (workspaceId, root) => port.gitBranches(writeRoot(workspaceId, root)),
    gitHistory: (workspaceId, input) => port.gitHistory(writeRoot(workspaceId, input.root), input.head, input.offset),
    gitCommitDetails: (workspaceId, input) => port.gitCommitDetails(writeRoot(workspaceId, input.root), input.head),
    gitBranchPushReview: (workspaceId, input) => port.gitBranchPushReview(writeRoot(workspaceId, input.root), input),
    async gitBranchAction(workspaceId, input) {
      const root = writeRoot(workspaceId, input.root);
      try { return await port.gitBranchAction(root, input); }
      finally {
        // Fetch/switch hooks can fail after partial changes. Always invalidate,
        // and never turn a successful mutation into failure on delivery errors.
        try { onGitChanged?.(workspaceId, root); } catch { /* Refresh on reconnect. */ }
      }
    },
    gitRepository: (workspaceId, rootQuery) => port.gitRepository(writeRoot(workspaceId, rootQuery)),
    gitPushPreview: (workspaceId, input) => port.gitPushPreview(writeRoot(workspaceId, input.root), input),
    async gitCommit(workspaceId, input) {
      const root = writeRoot(workspaceId, input.root);
      const result = await port.gitCommit(root, input);
      try { onGitChanged?.(workspaceId, root); }
      catch { result.warning ??= 'Commit succeeded, but live refresh failed. Refresh Git state before continuing.'; }
      return result;
    },
    async gitPush(workspaceId, input) {
      const root = writeRoot(workspaceId, input.root);
      const result = await port.gitPush(root, input);
      try { onGitChanged?.(workspaceId, root); }
      catch { result.warning ??= 'Push succeeded, but live refresh failed. Refresh Git state before continuing.'; }
      return result;
    },
    async list(workspaceId, options) {
      const workspace = resolveWorkspace(workspaceId);
      const { root, isMain } = port.resolveRoot(workspace, options.root);

      try {
        if (options.search) {
          const files = await port.searchFiles(
            root,
            options.search,
            options.limit ?? 20,
            options.showHidden ?? true,
            options.signal,
          );
          return { files, currentPath: '', mode: 'search', root, isMain };
        }

        const fullPath = join(root, options.path);

        if (!port.isPathWithinWorkspace(fullPath, workspace.path, workspace.additionalPaths)) {
          throw new Error('Path outside workspace');
        }

        const files = await port.listDirectory(fullPath, options.showHidden ?? true);

        let gitStatus: GitStatusResult | null;
        try {
          gitStatus = await port.gitStatus(root);
        } catch {
          gitStatus = null;
        }

        const filesWithGit = gitStatus
          ? port.attachGitStatusToEntries(files, fullPath, gitStatus)
          : files;

        return {
          files: filesWithGit,
          currentPath: options.path,
          mode: 'browse',
          root,
          isMain,
          git: gitStatus?.availability,
        };
      } catch {
        throw new Error('Path not found');
      }
    },

    async gitStatus(workspaceId, rootQuery) {
      const workspace = resolveWorkspace(workspaceId);
      const { root } = port.resolveRoot(workspace, rootQuery);

      try {
        const gitStatus = await port.gitStatus(root);
        return {
          availability: gitStatus.availability,
          files: toRootRelativeFiles(gitStatus, root),
          root,
        };
      } catch {
        return {
          availability: { available: false, reason: 'git_error' } as GitAvailability,
          files: [],
          root,
        };
      }
    },

    async gitAdd(workspaceId, path, rootQuery) {
      const workspace = resolveWorkspace(workspaceId);
      const { root } = port.resolveRoot(workspace, rootQuery);
      // Read-only root resolution can fall back to main. Mutations must never
      // redirect an unavailable or unauthorized selected root to another checkout.
      if (rootQuery !== undefined
        && (!rootQuery || resolve(root) !== resolve(port.expandPathFor(rootQuery)))) {
        throw new Error('Path outside workspace');
      }
      return port.gitAdd(root, path);
    },

    async gitDiff(workspaceId, path, rootQuery) {
      const workspace = resolveWorkspace(workspaceId);
      const { root } = port.resolveRoot(workspace, rootQuery);
      return port.gitDiff(root, path, workspace.additionalPaths);
    },

    async previewFile(workspaceId, path, rootQuery) {
      const workspace = resolveWorkspace(workspaceId);
      const { root } = port.resolveRoot(workspace, rootQuery);
      return port.previewFile(root, path, workspace.additionalPaths);
    },

    readEditableFile(workspaceId, path, rootQuery) {
      const workspace = resolveWorkspace(workspaceId);
      return port.readEditableFile(workspace, path, rootQuery);
    },

    saveFile(workspaceId, input) {
      const workspace = resolveWorkspace(workspaceId);
      return port.saveFile(workspace, input);
    },

    listTreePaths(workspaceId, input) {
      const workspace = resolveWorkspace(workspaceId);
      return port.listTreePaths(workspace, input);
    },

    createFileEntry(workspaceId, input) {
      const workspace = resolveWorkspace(workspaceId);
      return port.createFileEntry(workspace, input);
    },

    renameFileEntry(workspaceId, input) {
      const workspace = resolveWorkspace(workspaceId);
      return port.renameFileEntry(workspace, input);
    },

    deleteFileEntry(workspaceId, input) {
      const workspace = resolveWorkspace(workspaceId);
      return port.deleteFileEntry(workspace, input);
    },

    listDirectoryOnly(dirPath, showHidden) {
      return port.listDirectory(dirPath, showHidden);
    },

    expandPathFor(inputPath) {
      return port.expandPathFor(inputPath);
    },
  };
}
