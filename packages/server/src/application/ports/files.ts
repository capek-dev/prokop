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
import type { EditableFileResponse, SaveFileResponse } from '@prokopai/sdk';

export interface EditableFileWorkspaceLike {
  path: string;
  additionalPaths: string[];
}

export interface GitStatusResult {
  availability: GitAvailability;
  files: Map<string, GitDiffSummary>;
}

export interface FilesApplicationPort {
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
