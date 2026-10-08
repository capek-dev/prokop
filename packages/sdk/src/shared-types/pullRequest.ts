export type PullRequestProvider = 'github' | 'azure';
export type PullRequestState = 'open' | 'closed' | 'merged';
export type PullRequestVote =
  | 'comment'
  | 'approve'
  | 'request-changes'
  | 'approve-with-suggestions'
  | 'wait'
  | 'reset';
export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase' | 'rebase-merge';

export interface PullRequestRepository {
  /** Canonical provider/host/repository identity, revalidated against the remote on every request. */
  key: string;
  remote: string;
  provider: PullRequestProvider;
  host: string;
  owner: string;
  name: string;
  project?: string;
  url: string;
}
export interface PullRequestScope {
  root?: string;
  remote: string;
  repositoryKey: string;
}
export interface PullRequestConnection {
  repository: PullRequestRepository;
  status: 'connected' | 'unavailable';
  accountId?: string;
  accountName?: string;
  message?: string;
  /** Server-side shell command that fixes an unavailable connection, for example a tenant sign-in. */
  command?: string;
}
export interface PullRequestDiscovery {
  connections: PullRequestConnection[];
  branch: string | null;
}
export interface PullRequestActor {
  id: string;
  name: string;
}
export interface PullRequestSummary {
  number: number;
  title: string;
  body: string;
  url: string;
  author: PullRequestActor;
  state: PullRequestState;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  head: string;
  base: string;
  updatedAt: string;
  requestedReviewerIds?: string[];
}
export interface PullRequestComment {
  id: string;
  author: PullRequestActor;
  body: string;
  createdAt: string;
}
export interface PullRequestThread {
  id: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  resolved: boolean;
  outdated: boolean;
  canResolve: boolean;
  comments: PullRequestComment[];
}
export interface PullRequestReviewer extends PullRequestActor {
  vote: string;
}
export interface PullRequestCheck {
  name: string;
  state: string;
  url?: string;
}
export interface PullRequestDetail extends PullRequestSummary {
  accountId: string;
  reviewers: PullRequestReviewer[];
  checks: PullRequestCheck[];
  comments: PullRequestComment[];
  threads: PullRequestThread[];
  mergeability: 'mergeable' | 'conflicting' | 'unknown';
  mergeMethods: PullRequestMergeMethod[];
  warnings: string[];
  /** Azure review positions refer to a particular push iteration. */
  iteration?: number;
  autoMerge?: boolean;
}
export interface PullRequestList {
  items: PullRequestSummary[];
  nextPage: number | null;
  accountId: string;
}
export interface PullRequestFile {
  path: string;
  oldPath?: string;
  status: string;
  additions: number | null;
  deletions: number | null;
  changeTrackingId?: number;
}
export interface PullRequestFiles {
  files: PullRequestFile[];
  nextPage: number | null;
  head: string;
  iteration?: number;
  truncated?: boolean;
}
export interface PullRequestPatch {
  patch: string;
  unavailable?: string;
}
export interface PullRequestPosition {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  iteration?: number;
  changeTrackingId?: number;
}
export interface PullRequestCreate {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
  accountId: string;
}
export type PullRequestAction =
  | { action: 'edit'; title: string; body: string }
  | { action: 'close' | 'reopen' | 'ready' | 'draft' }
  | { action: 'merge'; method: PullRequestMergeMethod }
  | { action: 'enable-auto-merge'; method: PullRequestMergeMethod }
  | { action: 'disable-auto-merge' }
  | { action: 'comment'; body: string; position?: PullRequestPosition }
  | { action: 'review'; verdict: PullRequestVote; body: string }
  | { action: 'reviewer'; reviewer: string; remove: boolean }
  | { action: 'reply'; threadId: string; body: string }
  | { action: 'resolve'; threadId: string; resolved: boolean };
export type PullRequestMutation = PullRequestAction & { expectedHead: string; accountId: string };
