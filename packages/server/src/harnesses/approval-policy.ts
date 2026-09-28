import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';

const AUTO_APPROVE_RISKS: PermissionRiskLevel[] = ['none', 'low', 'medium', 'high'];

/** Native harness approvals use the session ceiling, never critical or unknown risk. */
export function canAutoApproveHarnessTool(ask: PermissionAsk, severity: unknown): boolean {
  if (ask.type !== 'permission' || typeof ask.risk !== 'string' || typeof severity !== 'string') return false;
  const risk = AUTO_APPROVE_RISKS.indexOf(ask.risk as PermissionRiskLevel);
  const ceiling = AUTO_APPROVE_RISKS.indexOf(severity as PermissionRiskLevel);
  return risk !== -1 && ceiling !== -1 && risk <= ceiling;
}
