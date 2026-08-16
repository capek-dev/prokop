import type { AutoApproveSeverity, Workspace, WorkspaceSettings } from '@jean2/sdk';

/**
 * Workspace domain: workspace record policy.
 *
 * Owns what a workspace record looks like: the default settings merge
 * (`autoApproveSeverity: 'low'`), the raw-row mapping, the agent-home
 * classification used by the listing filters, the auto-approve severity
 * fallback, and the record name default. The SQLite repository
 * (`store/workspaces.ts`) applies these rules; the HTTP use cases apply the
 * route-level input rules (path expansion and existence validation).
 */

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  autoApproveSeverity: 'low',
};

/** Merge raw stored settings over the defaults; malformed JSON falls back to
 * the defaults exactly like the pre-domain store. */
export function parseWorkspaceSettings(raw: string | null): WorkspaceSettings {
  if (!raw) return { ...DEFAULT_WORKSPACE_SETTINGS };
  try {
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_WORKSPACE_SETTINGS };
  }
}

/** Structural row shape produced by the SQLite repository. The domain never
 * imports the store or SQL. */
export interface WorkspaceRecordRow {
  id: string;
  name: string;
  path: string;
  is_virtual: number;
  settings: string | null;
  created_at: string;
  updated_at: string;
}

export function mapWorkspaceRecord(
  row: WorkspaceRecordRow,
  additionalPaths?: string[],
): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    isVirtual: row.is_virtual === 1,
    additionalPaths: additionalPaths ?? [],
    settings: parseWorkspaceSettings(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The listing filter: regular listings exclude agent-home workspaces; the
 * agent-home listing includes only them. */
export function isAgentHomeWorkspace(settings: WorkspaceSettings): boolean {
  return settings?.isAgentHome === true;
}

/** Auto-approve severity fallback: 'low' when the workspace or its setting
 * is missing. */
export function autoApproveSeverityOf(
  workspace: { settings?: WorkspaceSettings } | null | undefined,
): AutoApproveSeverity {
  return workspace?.settings?.autoApproveSeverity ?? 'low';
}

/** Route-level default for the workspace name. */
export function workspaceNameOrDefault(name: string | undefined | null): string {
  return name || 'New Workspace';
}
