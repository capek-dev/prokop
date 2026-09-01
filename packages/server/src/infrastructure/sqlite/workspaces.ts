import { getDatabase } from './database';
import type { Workspace, WorkspaceSettings, AutoApproveSeverity } from '@prokopai/sdk';
import {
  autoApproveSeverityOf,
  DEFAULT_WORKSPACE_SETTINGS,
  isAgentHomeWorkspace,
  mapWorkspaceRecord,
} from '@/domains/workspaces';

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  is_virtual: number;
  settings: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceInput {
  id: string;
  name: string;
  path: string;
  isVirtual: boolean;
  additionalPaths?: string[];
  settings?: WorkspaceSettings;
}

const DEFAULT_SETTINGS = DEFAULT_WORKSPACE_SETTINGS;

/** Resolve the auto-approve severity for a workspace, defaulting to 'low'. */
export function getWorkspaceAutoApproveSeverity(workspaceId: string): AutoApproveSeverity {
  const workspace = getWorkspace(workspaceId);
  return autoApproveSeverityOf(workspace);
}

function mapRowToWorkspace(row: WorkspaceRow, additionalPaths?: string[]): Workspace {
  return mapWorkspaceRecord(row, additionalPaths);
}

function batchLoadWorkspacePaths(workspaceIds: string[]): Map<string, string[]> {
  const db = getDatabase();
  const result = new Map<string, string[]>();
  if (workspaceIds.length === 0) return result;
  const placeholders = workspaceIds.map(() => '?').join(',');
  const rows = db.query(
    `SELECT workspace_id, path FROM workspace_paths WHERE workspace_id IN (${placeholders}) ORDER BY rowid`,
  ).all(...workspaceIds) as { workspace_id: string; path: string }[];
  for (const row of rows) {
    let paths = result.get(row.workspace_id);
    if (!paths) {
      paths = [];
      result.set(row.workspace_id, paths);
    }
    paths.push(row.path);
  }
  return result;
}

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  const db = getDatabase();
  const now = new Date().toISOString();
  const settings = input.settings ?? DEFAULT_SETTINGS;

  const workspace: Workspace = {
    id: input.id,
    name: input.name,
    path: input.path,
    isVirtual: input.isVirtual,
    additionalPaths: input.additionalPaths ?? [],
    settings,
    createdAt: now,
    updatedAt: now,
  };

  db.transaction(() => {
    db.run(`
      INSERT INTO workspaces (id, name, path, is_virtual, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      workspace.id,
      workspace.name,
      workspace.path,
      workspace.isVirtual ? 1 : 0,
      JSON.stringify(settings),
      workspace.createdAt,
      workspace.updatedAt,
    ]);

    for (const p of input.additionalPaths ?? []) {
      db.run(
        'INSERT OR IGNORE INTO workspace_paths (workspace_id, path) VALUES (?, ?)',
        [workspace.id, p],
      );
    }
  })();

  return workspace;
}

export function getWorkspace(id: string): Workspace | null {
  const db = getDatabase();
  const row = db.query('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
  if (!row) return null;
  const pathMap = batchLoadWorkspacePaths([row.id]);
  return mapRowToWorkspace(row, pathMap.get(row.id));
}

export function listWorkspaces(): Workspace[] {
  const db = getDatabase();
  const rows = db.query('SELECT * FROM workspaces ORDER BY created_at DESC').all() as WorkspaceRow[];
  const pathMap = batchLoadWorkspacePaths(rows.map(r => r.id));
  return rows.map(row => mapRowToWorkspace(row, pathMap.get(row.id)));
}

export function listAgentHomeWorkspaces(): Workspace[] {
  const db = getDatabase();
  const rows = db.query('SELECT * FROM workspaces ORDER BY created_at DESC').all() as WorkspaceRow[];
  const pathMap = batchLoadWorkspacePaths(rows.map(r => r.id));
  return rows
    .map(row => mapRowToWorkspace(row, pathMap.get(row.id)))
    .filter(w => isAgentHomeWorkspace(w.settings));
}

export function updateWorkspace(
  id: string,
  updates: { name?: string; path?: string; additionalPaths?: string[]; settings?: WorkspaceSettings },
): Workspace | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.transaction(() => {
    if (updates.path !== undefined) {
      db.run('UPDATE workspaces SET path = ?, updated_at = ? WHERE id = ?', [
        updates.path, now, id,
      ]);
    }

    if (updates.name !== undefined) {
      db.run('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?', [
        updates.name, now, id,
      ]);
    }

    if (updates.additionalPaths !== undefined) {
      db.run('DELETE FROM workspace_paths WHERE workspace_id = ?', [id]);
      for (const p of updates.additionalPaths) {
        db.run(
          'INSERT OR IGNORE INTO workspace_paths (workspace_id, path) VALUES (?, ?)',
          [id, p],
        );
      }
      db.run('UPDATE workspaces SET updated_at = ? WHERE id = ?', [now, id]);
    }

    if (updates.settings !== undefined) {
      db.run('UPDATE workspaces SET settings = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(updates.settings), now, id,
      ]);
    }
  })();

  const row = db.query('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
  if (!row) return null;
  const pathMap = batchLoadWorkspacePaths([row.id]);
  return mapRowToWorkspace(row, pathMap.get(row.id));
}

export function addWorkspaceAdditionalPath(workspaceId: string, path: string): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    const workspace = db.query('SELECT 1 FROM workspaces WHERE id = ?').get(workspaceId);
    if (!workspace) return false;
    const result = db.run(
      'INSERT OR IGNORE INTO workspace_paths (workspace_id, path) VALUES (?, ?)',
      [workspaceId, path],
    );
    if (result.changes > 0) {
      db.run('UPDATE workspaces SET updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        workspaceId,
      ]);
    }
    return true;
  })();
}

export function removeWorkspaceAdditionalPath(workspaceId: string, path: string): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    const workspace = db.query('SELECT 1 FROM workspaces WHERE id = ?').get(workspaceId);
    if (!workspace) return false;
    const result = db.run(
      'DELETE FROM workspace_paths WHERE workspace_id = ? AND path = ?',
      [workspaceId, path],
    );
    if (result.changes > 0) {
      db.run('UPDATE workspaces SET updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        workspaceId,
      ]);
    }
    return true;
  })();
}

export function deleteWorkspace(id: string): boolean {
  const db = getDatabase();
  const result = db.run('DELETE FROM workspaces WHERE id = ?', [id]);
  return result.changes > 0;
}

export function countSessionsInWorkspace(workspaceId: string): number {
  const db = getDatabase();
  const result = db.query('SELECT COUNT(*) as count FROM sessions WHERE workspace_id = ?').get(workspaceId) as { count: number };
  return result.count;
}
