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
  GitAvailability,
  GitDiffSummary,
  GitFileDiffResponse,
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
  gitStatus(workspaceId: string, rootQuery?: string): Promise<FilesGitStatusWire>;
  gitDiff(workspaceId: string, path: string, rootQuery?: string): Promise<GitFileDiffResponse>;
  previewFile(workspaceId: string, path: string, rootQuery?: string): Promise<FilePreviewResponse>;
  readEditableFile(workspaceId: string, path: string, rootQuery?: string): Promise<EditableFileResponse>;
  saveFile(
    workspaceId: string,
    input: { path: string; content: string; expectedRevision: string; root?: string; force?: boolean },
  ): Promise<SaveFileResponse>;
  /** Raw directory listing for the home-browse endpoints. */
  listDirectoryOnly(dirPath: string, showHidden?: boolean): Promise<FileEntry[]>;
  /** Expands a `~`-prefixed input through the C6 workspace path policy. */
  expandPathFor(inputPath: string): string;
}

export function createFilesApplication(port: FilesApplicationPort): FilesApplication {
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

  return {
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

    listDirectoryOnly(dirPath, showHidden) {
      return port.listDirectory(dirPath, showHidden);
    },

    expandPathFor(inputPath) {
      return port.expandPathFor(inputPath);
    },
  };
}
