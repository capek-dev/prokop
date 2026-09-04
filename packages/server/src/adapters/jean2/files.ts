/**
 * Jean2 files application port adapter (S5 filesystem isolation). Fills the
 * inward-facing `FilesApplicationPort` with the infrastructure filesystem
 * implementations over the C6 workspace path policy and the current
 * workspace store lookup.
 */

import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import type { FilesApplicationPort } from '@/application/ports/files';
import { listDirectory, searchFiles } from '@/infrastructure/filesystem/workspace-files';
import { createFilePreview } from '@/infrastructure/filesystem/file-preview';
import { createEditableFileOps } from '@/infrastructure/filesystem/file-mutations';
import { createFileTreeOps } from '@/infrastructure/filesystem/file-tree';
import {
  createGitStatus,
} from '@/infrastructure/filesystem/git-status';

const previewFile = createFilePreview(workspacePathPolicyPort);
const editableOps = createEditableFileOps(workspacePathPolicyPort);
const treeOps = createFileTreeOps(workspacePathPolicyPort);
const gitOps = createGitStatus(workspacePathPolicyPort);

interface Jean2FilesApplicationPortOptions {
  listAvailableWorktreePaths?: (workspaceId: string) => string[];
}

export function createJean2FilesApplicationPort(
  options: Jean2FilesApplicationPortOptions = {},
): FilesApplicationPort {
  return {
    getWorkspace: (workspaceId) => {
      const workspace = getWorkspace(workspaceId);
      if (!workspace) return null;

      return {
        ...workspace,
        additionalPaths: Array.from(new Set([
          ...workspace.additionalPaths,
          ...(options.listAvailableWorktreePaths?.(workspaceId) ?? []),
        ])),
      };
    },

    resolveRoot: (workspace, rootQuery) =>
      workspacePathPolicyPort.resolveRootForQuery(workspace, rootQuery),

    expandPathFor: (inputPath) => workspacePathPolicyPort.expandPath(inputPath),

    isPathWithinWorkspace: (targetPath, workspacePath, additionalPaths) =>
      workspacePathPolicyPort.isPathWithinWorkspace(targetPath, workspacePath, additionalPaths),

    listDirectory: (dirPath, showHidden) => listDirectory(dirPath, showHidden),

    searchFiles: (rootPath, query, limit, showHidden, signal) =>
      searchFiles(rootPath, query, limit, showHidden, signal),

    previewFile: (workspacePath, relativePath, additionalPaths) =>
      previewFile(workspacePath, relativePath, additionalPaths),

    readEditableFile: (workspace, inputPath, rootQuery) =>
      editableOps.readEditableFile(workspace, inputPath, rootQuery),

    saveFile: (workspace, input) => editableOps.saveFile(workspace, input),

    listTreePaths: (workspace, input) => treeOps.listTreePaths(workspace, input),

    createFileEntry: (workspace, input) => treeOps.createFileOrDirectory(workspace, input),

    renameFileEntry: (workspace, input) => treeOps.renameFileEntry(workspace, input),

    deleteFileEntry: (workspace, input) => treeOps.deleteFileEntry(workspace, input),

    gitStatus: (workspacePath) => gitOps.getGitStatus(workspacePath),

    attachGitStatusToEntries: (entries, listedPath, gitStatus) =>
      gitOps.attachGitStatusToEntries(entries, listedPath, gitStatus),

    gitDiff: (workspacePath, relativePath, additionalPaths) =>
      gitOps.getGitFileDiff(workspacePath, relativePath, additionalPaths),
  };
}
