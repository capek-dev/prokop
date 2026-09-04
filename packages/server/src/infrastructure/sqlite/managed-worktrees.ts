import type { Database } from 'bun:sqlite';
import type { ManagedWorktreeState } from '@prokopai/sdk';
import type {
  ManagedWorktreeRecord,
  ManagedWorktreeRepositoryPort,
} from '@/application/ports/worktree';

interface ManagedWorktreeRow {
  id: string;
  workspace_id: string;
  repository_id: string;
  repository_root: string;
  path: string;
  name: string | null;
  branch: string | null;
  head: string | null;
  state: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ManagedWorktreeRow): ManagedWorktreeRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repositoryId: row.repository_id,
    repositoryRoot: row.repository_root,
    path: row.path,
    name: row.name ?? row.branch ?? row.id,
    branch: row.branch,
    head: row.head,
    state: row.state as ManagedWorktreeState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createManagedWorktreeRepository(
  getDatabase: () => Database,
): ManagedWorktreeRepositoryPort {
  return {
    listByWorkspace(workspaceId) {
      return (getDatabase().query(
        'SELECT * FROM managed_worktrees WHERE workspace_id = ? ORDER BY created_at DESC',
      ).all(workspaceId) as ManagedWorktreeRow[]).map(mapRow);
    },

    listByRepository(repositoryId) {
      return (getDatabase().query(
        'SELECT * FROM managed_worktrees WHERE repository_id = ? ORDER BY created_at DESC',
      ).all(repositoryId) as ManagedWorktreeRow[]).map(mapRow);
    },

    get(id) {
      const row = getDatabase().query(
        'SELECT * FROM managed_worktrees WHERE id = ?',
      ).get(id) as ManagedWorktreeRow | null;
      return row ? mapRow(row) : null;
    },

    create(record) {
      getDatabase().run(
        `INSERT INTO managed_worktrees (
          id, workspace_id, repository_id, repository_root, path, name, branch,
          head, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.workspaceId,
          record.repositoryId,
          record.repositoryRoot,
          record.path,
          record.name,
          record.branch,
          record.head,
          record.state,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return record;
    },

    update(id, updates) {
      const set: string[] = ['updated_at = ?'];
      const values: Array<string | null> = [new Date().toISOString()];
      if (updates.branch !== undefined) {
        set.push('branch = ?');
        values.push(updates.branch);
      }
      if (updates.head !== undefined) {
        set.push('head = ?');
        values.push(updates.head);
      }
      if (updates.state !== undefined) {
        set.push('state = ?');
        values.push(updates.state);
      }
      values.push(id);
      getDatabase().run(
        `UPDATE managed_worktrees SET ${set.join(', ')} WHERE id = ?`,
        values,
      );
      const row = getDatabase().query(
        'SELECT * FROM managed_worktrees WHERE id = ?',
      ).get(id) as ManagedWorktreeRow | null;
      return row ? mapRow(row) : null;
    },
  };
}
