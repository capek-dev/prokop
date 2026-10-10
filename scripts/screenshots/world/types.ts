import type { Demo } from '../script';

export interface WorldSetup {
  demo: Demo;
  /** Absolute path of the demo repo inside the fake home. */
  repo: string;
  workspaceId: string;
}

/**
 * The repo as scripted tool calls name it. The server's HOME is the fake
 * home, so `~/` resolves to the real repo while transcripts show a clean
 * path instead of the temp directory.
 */
export const REPO_DISPLAY_PATH = '~/code/linkshelf';

export function repoPath(path: string): string {
  return `${REPO_DISPLAY_PATH}/${path}`;
}
