export interface GitRebaseState {
  active: boolean;
  token: string | null;
  branch: string | null;
  originalHead: string | null;
  onto: string | null;
  conflicts: string[];
}
export interface GitRebaseStart {
  root?: string;
  expectedBranch: string;
  expectedHead: string;
  baseBranch: string;
  baseHead: string;
}
export interface GitRebaseControl {
  root?: string;
  action: 'continue' | 'abort';
  token: string;
}
export interface GitRebaseSide {
  text: string | null;
  binary: boolean;
  mode: string;
}
export interface GitRebaseConflict {
  path: string;
  token: string;
  /** Stage 2: base plus commits already replayed. */
  base: GitRebaseSide | null;
  /** Stage 3: feature commit currently being replayed. */
  feature: GitRebaseSide | null;
  /** Stage 1 common ancestor; omitted by older servers. */
  original?: GitRebaseSide | null;
  workingText: string | null;
}
export type GitRebaseResolution = { root?: string; path: string; token: string } & (
  | { resolution: 'text'; text: string }
  | { resolution: 'base' | 'feature' | 'delete' }
);
