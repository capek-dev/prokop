export interface GitRepositoryState {
  branch: string | null;
  head: string | null;
  remotes: string[];
  upstream: { remote: string; branch: string } | null;
}

export interface GitCommitInput {
  root?: string;
  paths: string[];
  message: string;
  expectedBranch: string;
  expectedHead: string | null;
}

export interface GitCommitResult {
  head: string;
  /** A commit succeeded but requires manual index recovery. Never retry it. */
  warning?: string;
}

export interface GitPushPreviewInput {
  root?: string;
  remote: string;
  branch: string;
}

export interface GitPushInput extends GitPushPreviewInput {
  expectedBranch: string;
  expectedHead: string;
  force?: boolean;
  expectedRemoteHead?: string | null;
  setUpstream?: boolean;
}

export interface GitPushResult {
  head: string;
  warning?: string;
}
