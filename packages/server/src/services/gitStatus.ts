/**
 * Compatibility forwarder (S5 filesystem isolation). The git status/diff
 * implementation moved to `infrastructure/filesystem/git-status.ts`; every
 * export identity (including `_internal` for the parsing tests) stays
 * unchanged. The diff operation is built over the injected C6 workspace
 * containment, exactly like the pre-slice policy path.
 */

import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import { createGitStatus } from '@/infrastructure/filesystem/git-status';

export {
  _internal,
  attachGitStatusToEntries,
  clearGitStatusCache,
  getGitStatus,
  parseUnifiedDiff,
} from '@/infrastructure/filesystem/git-status';
export type { GitStatusResult } from '@/infrastructure/filesystem/git-status';

const gitOps = createGitStatus(workspacePathPolicyPort);
export const getGitFileDiff = gitOps.getGitFileDiff;
