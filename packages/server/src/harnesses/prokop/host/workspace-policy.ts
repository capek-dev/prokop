import { homedir } from 'node:os';
import { configureWorkspacePolicy } from '@/infrastructure/filesystem/workspace-policy/policy';
import type { WorkspacePolicyOptions } from '@/infrastructure/filesystem/workspace-policy/contracts';
import { SENSITIVE_PATH_PATTERNS } from '@/domains/permissions/paths';

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

export const prokopWorkspacePolicyOptions: WorkspacePolicyOptions = {
  blockedPaths: JEAN2_BLOCKED_PATHS,
  sensitivePatterns: SENSITIVE_PATH_PATTERNS,
  homeDir: homedir(),
};

/** Installs the same Prokop-owned policy for workspace helpers used outside
 * an agent execution scope. */
export function configureProkopWorkspacePolicy(): void {
  configureWorkspacePolicy(prokopWorkspacePolicyOptions);
}
