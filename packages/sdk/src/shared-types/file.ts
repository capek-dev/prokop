export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted';

export interface GitDiffSummary {
  status: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
  additions?: number;
  deletions?: number;
  oldPath?: string;
}

export interface GitAvailability {
  available: boolean;
  reason?: 'git_not_installed' | 'not_a_git_repo' | 'git_error';
  root?: string;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  extension?: string;
  git?: GitDiffSummary;
}

export interface FileListResponse {
  files: FileEntry[];
  currentPath: string;
  mode: 'browse' | 'search';
  git?: GitAvailability;
}

export interface FileSearchResult {
  files: FileEntry[];
  query: string;
  total: number;
  truncated: boolean;
}

export type FilePreviewKind =
  | 'code'
  | 'text'
  | 'markdown'
  | 'binary'
  | 'unsupported'
  | 'too_large';

export interface FilePreviewBase {
  path: string;
  name: string;
  extension?: string;
  size: number;
  kind: FilePreviewKind;
  readOnly: true;
  mimeType?: string;
  language?: string;
}

export interface FilePreviewContentResponse extends FilePreviewBase {
  kind: 'code' | 'text' | 'markdown';
  content: string;
}

export interface FilePreviewBinaryResponse extends FilePreviewBase {
  kind: 'binary';
  reason: string;
}

export interface FilePreviewUnsupportedResponse extends FilePreviewBase {
  kind: 'unsupported';
  reason: string;
}

export interface FilePreviewTooLargeResponse extends FilePreviewBase {
  kind: 'too_large';
  reason: string;
  maxBytes: number;
}

export type FilePreviewResponse =
  | FilePreviewContentResponse
  | FilePreviewBinaryResponse
  | FilePreviewUnsupportedResponse
  | FilePreviewTooLargeResponse;

export type GitFileDiffUnavailableReason =
  | 'git_not_installed'
  | 'not_a_git_repo'
  | 'not_changed'
  | 'path_outside_workspace'
  | 'file_not_found'
  | 'binary'
  | 'git_error';

export interface GitDiffChange {
  type: 'added' | 'removed' | 'context';
  content: string;
  lineNumber?: number;
  newLineNumber?: number;
}

export interface GitDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: GitDiffChange[];
}

export interface GitFileDiffResponse {
  path: string;
  diffAvailable: boolean;
  reason?: GitFileDiffUnavailableReason;
  status?: GitDiffSummary;
  hunks: GitDiffHunk[];
  additions: number;
  deletions: number;
  language?: string;
}

export interface FileRevisionConflictDetails {
  path: string;
  expectedRevision: string;
  actualRevision: string;
  currentContent: string;
}

export interface EditableFileResponse {
  path: string;
  name: string;
  extension?: string;
  size: number;
  content: string;
  revision: string;
  readOnly: false;
  mimeType?: string;
  language?: string;
  encoding: 'utf-8';
}

export interface SaveFileRequest {
  path: string;
  content: string;
  expectedRevision: string;
  root?: string;
  force?: boolean;
}

export interface SaveFileResponse {
  path: string;
  revision: string;
  size: number;
  modifiedAt: string;
}

export interface CreateFileRequest {
  /** Workspace-root-relative target path using forward slashes. */
  path: string;
  kind?: 'file' | 'directory';
  root?: string;
  /** Create missing parent directories (defaults to true). */
  createParents?: boolean;
}

export interface RenameFileRequest {
  /** Workspace-root-relative source path. */
  from: string;
  /** Workspace-root-relative destination path (also covers moves). */
  to: string;
  root?: string;
  /** Replace an existing destination file (directories are never replaced). */
  overwrite?: boolean;
}

export interface DeleteFileRequest {
  path: string;
  root?: string;
  /** Required to remove a non-empty directory. */
  recursive?: boolean;
}

/**
 * GET /api/workspaces/:id/files/tree
 * Full recursive relative-path listing for one workspace root, consumed by
 * path-first tree renderers. `truncated` reports hitting the entry cap.
 */
export interface FileTreeResponse {
  root: string;
  isMain: boolean;
  /** Every visible file and directory path, POSIX separators, presorted. */
  paths: string[];
  truncated: boolean;
}

/** Shared mutation result shape for file create/rename/delete. */
export interface FileMutationResult {
  path: string;
  /** Present when a previous entry was replaced or moved. */
  from?: string;
}

export type CreateFileResponse = FileMutationResult;
export type RenameFileResponse = FileMutationResult;
export type DeleteFileResponse = { path: string; recursive: boolean };
