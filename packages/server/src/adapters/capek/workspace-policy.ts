import { homedir } from 'node:os';
import {
  configureWorkspacePolicy,
  type WorkspacePolicyOptions,
} from '@capekai/core/workspace';
import { SENSITIVE_FILE_PATTERNS } from '@capekai/types';

export const JEAN2_BLOCKED_PATHS = [
  '/etc/',
  '/usr/',
  '/bin/',
  '/sbin/',
  '/boot/',
  '/dev/',
  '/proc/',
  '/sys/',
  '/root/',
] as const;

export const jean2WorkspacePolicyOptions: WorkspacePolicyOptions = {
  blockedPaths: JEAN2_BLOCKED_PATHS,
  sensitivePatterns: SENSITIVE_FILE_PATTERNS,
  homeDir: homedir(),
};

/** Installs the same Prokop-owned policy for workspace helpers used outside
 * an agent execution scope. */
export function configureJean2WorkspacePolicy(): void {
  configureWorkspacePolicy(jean2WorkspacePolicyOptions);
}
