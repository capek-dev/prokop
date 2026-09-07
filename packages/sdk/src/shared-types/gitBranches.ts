import type { GitRepositoryState } from './git';

export interface GitBranchInfo {
  ref: string;
  name: string;
  head: string;
  kind: 'local' | 'remote';
  current: boolean;
  checkedOut: boolean;
  upstream: string | null;
  /** Relative to the last fetched upstream, not a live remote read. */
  ahead: number | null;
  behind: number | null;
}
export interface GitBranchesResult {
  repository: GitRepositoryState;
  branches: GitBranchInfo[];
}
export interface GitHistoryEntry {
  head: string;
  subject: string;
  author: string;
  date: string;
  /** ahead = local-only (push to publish); behind = upstream-only (pull to get). */
  sync?: 'ahead' | 'behind';
}
export interface GitHistoryResult {
  commits: GitHistoryEntry[];
  nextOffset: number | null;
}
export interface GitCommitDetails {
  files: string[];
  /** Diff against first parent (empty tree for the initial commit). */
  patch: string;
}
export interface GitBranchPushTarget {
  root?: string;
  sourceBranch: string;
  expectedHead: string;
  remote: string;
  branch: string;
}
export interface GitBranchPushReview {
  remoteHead: string | null;
  outgoing: GitHistoryEntry[];
  remoteOnly: GitHistoryEntry[];
  outgoingCount: number;
  remoteOnlyCount: number;
}
export type GitBranchAction = { root?: string } & (
  | { action: 'fetch'; remote: string }
  | { action: 'pull'; expectedBranch: string; expectedHead: string; remote: string; branch: string }
  | { action: 'create'; name: string; startHead: string }
  | { action: 'track'; remote: string; branch: string; name: string; expectedHead: string }
  | { action: 'switch'; name: string; expectedBranch: string | null; expectedHead: string | null; targetHead: string }
  | ({ action: 'push'; expectedRemoteHead: string | null; force: boolean } & GitBranchPushTarget)
);
