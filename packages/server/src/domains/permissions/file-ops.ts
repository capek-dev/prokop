/**
 * Shared file-operation classification (permissions v2).
 *
 * One policy definition point for non-shell file operations, consumed
 * identically by the Prokop file tools (edit, write-file, read-file, grep,
 * glob, file-to-markdown via the enrichment helper) and by the native-harness
 * permission policies (Claude Read/Edit/Write/Glob/Grep, Codex apply_patch).
 * Mirrors classifyShellCommand: returns the Finding plus the ask to show when
 * the mode ceiling says ask. Decision authority stays with
 * shouldAutoApproveAsk / requiresHumanReview; the ask's legacy risk is derived
 * from the Finding (ask.ts), so every severity consumer agrees.
 *
 * Catastrophic detection stays in the shell analyzer (destructive-command
 * bases); file deletions surface as the destructive concern.
 */

import type { Concern, Finding } from './concerns';
import {
  concernRisk,
  grantScopesForFinding,
  type ConcernsPermissionAsk,
} from './ask';
import { effectivePath, isOutsideRoot, isSensitivePath } from './paths';

export type FileOperation = 'read' | 'search' | 'edit' | 'write' | 'delete';

const OPERATION_ACTIONS: Record<FileOperation, 'read' | 'write' | 'delete'> = {
  read: 'read',
  search: 'read',
  edit: 'write',
  write: 'write',
  delete: 'delete',
};

const OPERATION_LABELS: Record<FileOperation, string> = {
  read: 'read',
  search: 'search',
  edit: 'edit',
  write: 'write',
  delete: 'delete',
};

export interface FileOperationClassification {
  finding: Finding;
  ask: ConcernsPermissionAsk;
}

/**
 * Classify a file operation. Undefined means malformed input (the caller
 * denies or keeps its legacy ask); a classification is returned for every
 * valid input — the CALLER decides auto vs ask through
 * requiresHumanReview / shouldAutoApproveAsk, because the mode lives on the
 * session, not here. `roots` are the allowed roots (workspace root plus any
 * additional allowed paths); escape means outside ALL of them. Symlinked
 * ancestors are resolved through effectivePath so an existing symlink cannot
 * hide an outside-root target.
 */
export function classifyFileOperation(params: {
  operation: FileOperation;
  /** Resolved absolute paths the operation touches. */
  paths: readonly string[];
  /** Allowed roots (workspace root and any additional allowed paths). */
  roots: readonly string[];
  /** Optional search pattern (grep/glob) analyzed for sensitive content. */
  pattern?: string;
}): FileOperationClassification | undefined {
  const paths = params.paths.filter(
    (path) => typeof path === 'string' && path.length > 0 && !path.includes('\0') && path.length <= 4096,
  );
  if (paths.length === 0 || paths.length > 100) return undefined;
  const roots = params.roots.filter((root) => typeof root === 'string' && root.length > 0);
  if (roots.length === 0) return undefined;

  const concerns: Concern[] = [];
  const evidence: string[] = [];
  const effective = paths.map(effectivePath);

  if (effective.some((target) => roots.every((root) => isOutsideRoot(target, root)))) {
    concerns.push('escape');
    evidence.push('touches paths outside the allowed roots');
  }
  if (
    paths.some(isSensitivePath)
    || effective.some(isSensitivePath)
    || (params.pattern != null && isSensitivePath(params.pattern))
  ) {
    concerns.push('sensitive');
    evidence.push('touches sensitive files (credentials, keys, environment)');
  }
  if (params.operation === 'delete') {
    concerns.push('destructive');
    evidence.push('deletes files');
  }

  const finding: Finding = {
    concerns,
    catastrophic: false,
    evidence,
    resolvedPaths: [...paths],
  };

  const ask: ConcernsPermissionAsk = {
    type: 'permission',
    question: `Allow this ${OPERATION_LABELS[params.operation]} operation?`,
    description: (evidence[0] ?? paths[0]!).slice(0, 1000),
    resource: 'file',
    action: OPERATION_ACTIONS[params.operation],
    risk: concernRisk(finding),
    concerns,
    catastrophic: false,
    evidence,
    allowedScopes: grantScopesForFinding(finding),
    paths: [...paths],
    metadata: { operation: params.operation },
  };

  return { finding, ask };
}
