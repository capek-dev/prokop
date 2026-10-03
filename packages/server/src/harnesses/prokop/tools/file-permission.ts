/**
 * Permission-ask enrichment for the Prokop file tools.
 *
 * The tools keep their ask sites, questions, and metadata.permissionKey grant
 * structure (so remembered grants behave exactly as before), but every ask is
 * enriched with the shared file-operation classification from
 * domains/permissions/file-ops: concern fields, evidence, paths, resource /
 * action, and the risk derived from the finding — the same severity the
 * Claude and Codex harness paths produce, so the capek auto-approve ceiling
 * and the client card chrome (concern chips, severity colors) see one truth.
 */

import type { PermissionAsk } from '@prokopai/sdk';
import {
  classifyFileOperation,
  concernRisk,
  type Concern,
  type ConcernsPermissionAsk,
  type FileOperation,
} from '@/domains/permissions';

/** Raw tool asks carry target; builder-produced ones do not. Both pass through. */
export type ToolPermissionAsk = ConcernsPermissionAsk & { target?: 'permission' };

export function fileConcernAsk(params: {
  operation: FileOperation;
  /** Resolved absolute path the operation touches. */
  path: string;
  /** Workspace root used for escape detection. */
  root: string;
  concern: Concern;
  /** The tool's legacy ask; question, permissionKey, and other fields pass through. */
  ask: PermissionAsk & { target?: 'permission' };
}): ToolPermissionAsk {
  const classification = classifyFileOperation({
    operation: params.operation,
    paths: [params.path],
    roots: [params.root],
  });
  const evidenceLine = classification && classification.finding.concerns.includes(params.concern)
    ? classification.finding.evidence[classification.finding.concerns.indexOf(params.concern)]!
    : params.ask.question;

  return {
    ...params.ask,
    risk: concernRisk({
      concerns: [params.concern],
      catastrophic: false,
      evidence: [],
      resolvedPaths: [],
    }),
    concerns: [params.concern],
    catastrophic: false,
    evidence: [evidenceLine],
    ...(classification
      ? { paths: classification.ask.paths, action: classification.ask.action }
      : {}),
    resource: 'file',
  };
}
