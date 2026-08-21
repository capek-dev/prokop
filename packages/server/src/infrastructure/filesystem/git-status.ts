/**
 * Filesystem infrastructure implementation (S5 filesystem isolation).
 * Git status and diff. Byte-for-byte move of the pre-slice
 * `services/gitStatus.ts` behavior: porcelain parsing, numstat parsing,
 * in-flight dedup, availability detection, directory aggregation, unified
 * diff parsing, and the exact error/status mapping. The only import change
 * is `getLanguageForPath`, which now comes from the sibling preview module
 * instead of the retired service path.
 */

import { relative, normalize, sep, resolve, join, extname } from 'path';
import { stat, readFile } from 'fs/promises';
import type { FileEntry, GitAvailability, GitDiffSummary, GitFileStatus, GitFileDiffResponse, GitDiffHunk, GitDiffChange, GitFileDiffUnavailableReason } from '@prokopai/sdk';
import { isBinaryExtension, isBinaryFile, FILE_PREVIEW_MAX_BYTES } from './binary-detection';
import { getLanguageForPath } from './file-preview';

export interface GitStatusResult {
  availability: GitAvailability;
  files: Map<string, GitDiffSummary>;
}

const inflight = new Map<string, Promise<GitStatusResult>>();

export function clearGitStatusCache(): void {
  inflight.clear();
}

function normalizePath(p: string): string {
  return p.split(sep).join('/');
}

function mapStatus(x: string, y: string): GitFileStatus {
  if (x === '?' && y === '?') return 'untracked';
  if (x === '!' && y === '!') return 'ignored';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'C' || y === 'C') return 'copied';
  if (x === 'A' || y === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  return 'modified';
}

function parsePorcelainStatus(output: string): Map<string, { status: GitFileStatus; staged: boolean; unstaged: boolean; oldPath?: string }> {
  const result = new Map<string, { status: GitFileStatus; staged: boolean; unstaged: boolean; oldPath?: string }>();

  if (!output.trim()) return result;

  for (const line of output.split('\n')) {
    if (!line) continue;

    const x = line[0];
    const y = line[1];
    const status = mapStatus(x, y);

    const staged = x !== ' ' && x !== '?';
    const unstaged = y !== ' ' && y !== '?';

    let filePath = line.slice(2).trim();
    let oldPath: string | undefined;

    if ((status === 'renamed' || status === 'copied') && filePath.includes(' -> ')) {
      const parts = filePath.split(' -> ');
      oldPath = parts[0];
      filePath = parts[1];
    }

    filePath = normalizePath(filePath);

    result.set(filePath, { status, staged, unstaged, oldPath });
  }

  return result;
}

function parseNumstat(output: string): Map<string, { additions?: number; deletions?: number }> {
  const result = new Map<string, { additions?: number; deletions?: number }>();

  if (!output.trim()) return result;

  for (const line of output.split('\n')) {
    if (!line) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const addStr = parts[0];
    const delStr = parts[1];
    const filePath = normalizePath(parts[2]);

    const additions = addStr === '-' ? undefined : parseInt(addStr, 10);
    const deletions = delStr === '-' ? undefined : parseInt(delStr, 10);

    result.set(filePath, { additions, deletions });
  }

  return result;
}

async function execGit(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();

    return { stdout: stdout.trim(), exitCode };
  } catch {
    return { stdout: '', exitCode: 1 };
  }
}

async function detectGitAvailability(workspacePath: string): Promise<GitAvailability> {
  const versionResult = await execGit(['--version']);
  if (versionResult.exitCode !== 0) {
    return { available: false, reason: 'git_not_installed' };
  }

  const rootResult = await execGit(['-C', workspacePath, 'rev-parse', '--show-toplevel']);
  if (rootResult.exitCode !== 0) {
    return { available: false, reason: 'not_a_git_repo' };
  }

  return { available: true, root: rootResult.stdout };
}

async function computeGitStatus(workspacePath: string): Promise<GitStatusResult> {
  const availability = await detectGitAvailability(workspacePath);

  if (!availability.available) {
    return { availability, files: new Map() };
  }

  try {
    const [statusResult, numstatResult, cachedNumstatResult] = await Promise.all([
      execGit(['-C', workspacePath, 'status', '--porcelain=v1', '--untracked-files=all']),
      execGit(['-C', workspacePath, 'diff', '--numstat']),
      execGit(['-C', workspacePath, 'diff', '--cached', '--numstat']),
    ]);

    const statusMap = parsePorcelainStatus(statusResult.stdout);
    const numstatMap = parseNumstat(numstatResult.stdout);
    const cachedNumstatMap = parseNumstat(cachedNumstatResult.stdout);

    const files = new Map<string, GitDiffSummary>();

    for (const [filePath, statusInfo] of statusMap) {
      const unstagedStat = numstatMap.get(filePath);
      const stagedStat = cachedNumstatMap.get(filePath);

      let additions: number | undefined;
      let deletions: number | undefined;

      if (unstagedStat || stagedStat) {
        additions = (unstagedStat?.additions ?? 0) + (stagedStat?.additions ?? 0);
        deletions = (unstagedStat?.deletions ?? 0) + (stagedStat?.deletions ?? 0);

        if (unstagedStat?.additions === undefined && stagedStat?.additions === undefined) {
          additions = undefined;
        }
        if (unstagedStat?.deletions === undefined && stagedStat?.deletions === undefined) {
          deletions = undefined;
        }
      }

      files.set(filePath, {
        status: statusInfo.status,
        staged: statusInfo.staged,
        unstaged: statusInfo.unstaged,
        additions,
        deletions,
        oldPath: statusInfo.oldPath,
      });
    }

    return { availability, files };
  } catch {
    return {
      availability: { available: false, reason: 'git_error' },
      files: new Map(),
    };
  }
}

export interface GitContainment {
  /** Separator-aware C6 workspace containment for the git diff path. */
  isPathWithinWorkspace(
    targetPath: string,
    workspacePath: string,
    additionalPaths?: string[],
  ): boolean;
}

/** Builds the git status/diff operations over the injected C6 workspace
 * containment so the infrastructure layer imports no adapters. The
 * parsing helpers stay module-level for the compat forwarder tests. */
export function createGitStatus(containment: GitContainment) {
  return {
    getGitStatus,
    attachGitStatusToEntries,
    getGitFileDiff: (workspacePath: string, relativePath: string, additionalPaths: string[] = []) =>
      getGitFileDiffWithContainment(containment, workspacePath, relativePath, additionalPaths),
  };
}

export async function getGitStatus(workspacePath: string): Promise<GitStatusResult> {
  const existing = inflight.get(workspacePath);
  if (existing) return existing;

  const promise = computeGitStatus(workspacePath).finally(() => {
    inflight.delete(workspacePath);
  });
  inflight.set(workspacePath, promise);
  return promise;
}

const STATUS_PRIORITY: Record<GitFileStatus, number> = {
  conflicted: 7,
  deleted: 6,
  renamed: 5,
  added: 4,
  untracked: 3,
  modified: 2,
  copied: 1,
  ignored: 0,
};

function aggregateDirectoryStatus(
  dirRepoPath: string,
  gitFiles: Map<string, GitDiffSummary>,
): GitDiffSummary | undefined {
  const prefix = dirRepoPath + '/';
  let hasAny = false;
  let staged = false;
  let unstaged = false;
  let additions = 0;
  let deletions = 0;
  let additionsDefined = false;
  let deletionsDefined = false;
  let highestStatus: GitFileStatus = 'modified';
  let highestPriority = -1;

  for (const [filePath, summary] of gitFiles) {
    if (!filePath.startsWith(prefix)) continue;

    hasAny = true;
    if (summary.staged) staged = true;
    if (summary.unstaged) unstaged = true;

    if (summary.additions !== undefined) {
      additions += summary.additions;
      additionsDefined = true;
    }
    if (summary.deletions !== undefined) {
      deletions += summary.deletions;
      deletionsDefined = true;
    }

    const priority = STATUS_PRIORITY[summary.status];
    if (priority > highestPriority) {
      highestPriority = priority;
      highestStatus = summary.status;
    }
  }

  if (!hasAny) return undefined;

  return {
    status: highestStatus,
    staged,
    unstaged,
    additions: additionsDefined ? additions : undefined,
    deletions: deletionsDefined ? deletions : undefined,
  };
}

export function attachGitStatusToEntries(
  entries: FileEntry[],
  listedPath: string,
  gitStatus: GitStatusResult,
): FileEntry[] {
  if (!gitStatus.availability.available || !gitStatus.availability.root) {
    return entries;
  }

  const gitRoot = gitStatus.availability.root;

  const prefix = normalizePath(relative(gitRoot, normalize(listedPath)));
  if (prefix.startsWith('..')) {
    return entries;
  }

  return entries.map((entry) => {
    const entryRepoPath = prefix ? `${prefix}/${entry.path}` : entry.path;

    if (entry.type === 'file') {
      const fileStatus = gitStatus.files.get(entryRepoPath);
      if (fileStatus) {
        return { ...entry, git: fileStatus };
      }
      return entry;
    }

    const dirStatus = aggregateDirectoryStatus(entryRepoPath, gitStatus.files);
    if (dirStatus) {
      return { ...entry, git: dirStatus };
    }

    const exactMatch = gitStatus.files.get(entryRepoPath);
    if (exactMatch) {
      return { ...entry, git: exactMatch };
    }

    return entry;
  });
}

export function parseUnifiedDiff(patch: string): {
  hunks: GitDiffHunk[];
  additions: number;
  deletions: number;
} {
  const hunks: GitDiffHunk[] = [];
  let additions = 0;
  let deletions = 0;

  if (!patch.trim()) return { hunks, additions, deletions };

  const lines = patch.split('\n');
  let currentHunk: GitDiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      inHunk = false;
      continue;
    }

    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      oldLineNum = parseInt(hunkHeader[1], 10);
      const oldCount = hunkHeader[2] !== undefined ? parseInt(hunkHeader[2], 10) : 1;
      newLineNum = parseInt(hunkHeader[3], 10);
      const newCount = hunkHeader[4] !== undefined ? parseInt(hunkHeader[4], 10) : 1;

      currentHunk = {
        oldStart: oldLineNum,
        oldLines: oldCount,
        newStart: newLineNum,
        newLines: newCount,
        changes: [],
      };
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentHunk) continue;

    if (line.startsWith('\\')) {
      continue;
    }

    if (line.startsWith('+')) {
      currentHunk.changes.push({
        type: 'added',
        content: line.slice(1),
        newLineNumber: newLineNum,
      });
      newLineNum++;
      additions++;
    } else if (line.startsWith('-')) {
      currentHunk.changes.push({
        type: 'removed',
        content: line.slice(1),
        lineNumber: oldLineNum,
      });
      oldLineNum++;
      deletions++;
    } else if (line.startsWith(' ') || line === '') {
      if (line === '' && !inHunk) continue;
      currentHunk.changes.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : '',
        lineNumber: oldLineNum,
        newLineNumber: newLineNum,
      });
      oldLineNum++;
      newLineNum++;
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return { hunks, additions, deletions };
}

function makeUnavailableResponse(
  relativePath: string,
  reason: GitFileDiffUnavailableReason,
): GitFileDiffResponse {
  return {
    path: relativePath,
    diffAvailable: false,
    reason,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

async function getGitFileDiffWithContainment(
  containment: GitContainment,
  workspacePath: string,
  relativePath: string,
  additionalPaths: string[] = [],
): Promise<GitFileDiffResponse> {
  const normalizedInput = relativePath.replace(/\\/g, '/');

  let fullPath: string;
  const isAbs = normalizedInput.startsWith('/');
  if (isAbs) {
    fullPath = resolve(normalizedInput);
  } else {
    fullPath = join(workspacePath, normalizedInput);
  }

  // C6 step 4: separator-aware containment instead of the naive prefix
  // check. Sibling-prefix and traversal-to-sibling paths return the exact
  // path_outside_workspace result; declared additional roots and
  // inside-root traversal remain allowed.
  if (!containment.isPathWithinWorkspace(fullPath, workspacePath, additionalPaths)) {
    return makeUnavailableResponse(relativePath, 'path_outside_workspace');
  }

  const gitStatus = await getGitStatus(workspacePath);
  if (!gitStatus.availability.available) {
    return makeUnavailableResponse(relativePath, gitStatus.availability.reason as GitFileDiffUnavailableReason);
  }

  const gitRoot = gitStatus.availability.root!;
  const repoRelativePath = normalizePath(relative(gitRoot, fullPath));

  if (repoRelativePath.startsWith('..')) {
    return makeUnavailableResponse(relativePath, 'path_outside_workspace');
  }

  const fileStatus = gitStatus.files.get(repoRelativePath);

  if (!fileStatus) {
    return makeUnavailableResponse(relativePath, 'not_changed');
  }

  const language = getLanguageForPath(relativePath);

  if (fileStatus.status === 'untracked') {
    try {
      const stats = await stat(fullPath);
      if (stats.size > FILE_PREVIEW_MAX_BYTES) {
        return makeUnavailableResponse(relativePath, 'binary');
      }

      const ext = extname(fullPath);
      if (isBinaryExtension(ext)) {
        return makeUnavailableResponse(relativePath, 'binary');
      }

      const binary = await isBinaryFile(fullPath, stats.size);
      if (binary) {
        return makeUnavailableResponse(relativePath, 'binary');
      }

      const content = await readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }

      const changes: GitDiffChange[] = lines.map((line, index) => ({
        type: 'added' as const,
        content: line,
        newLineNumber: index + 1,
      }));

      return {
        path: relativePath,
        diffAvailable: true,
        status: fileStatus,
        hunks: [{
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: lines.length,
          changes,
        }],
        additions: lines.length,
        deletions: 0,
        language,
      };
    } catch {
      return makeUnavailableResponse(relativePath, 'file_not_found');
    }
  }

  try {
    const { stdout, exitCode } = await execGit(['-C', workspacePath, 'diff', 'HEAD', '--', repoRelativePath]);

    if (exitCode !== 0) {
      return makeUnavailableResponse(relativePath, 'git_error');
    }

    if (!stdout.trim()) {
      return makeUnavailableResponse(relativePath, 'not_changed');
    }

    if (/^Binary files /.test(stdout.trim()) || /differ\s*$/.test(stdout.trim())) {
      return makeUnavailableResponse(relativePath, 'binary');
    }

    const { hunks, additions, deletions } = parseUnifiedDiff(stdout);

    if (hunks.length === 0) {
      if (stdout.includes('Binary files')) {
        return makeUnavailableResponse(relativePath, 'binary');
      }
      return makeUnavailableResponse(relativePath, 'not_changed');
    }

    return {
      path: relativePath,
      diffAvailable: true,
      status: fileStatus,
      hunks,
      additions,
      deletions,
      language,
    };
  } catch {
    return makeUnavailableResponse(relativePath, 'git_error');
  }
}

export const _internal = {
  parsePorcelainStatus,
  parseNumstat,
  aggregateDirectoryStatus,
  mapStatus,
  parseUnifiedDiff,
};
