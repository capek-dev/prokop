import { randomUUID } from 'crypto';
import type { Database } from 'bun:sqlite';
import type {
  ScheduleConfig,
  ScheduleKind,
  ScheduledJob,
  ScheduledJobState,
} from '@prokopai/sdk';
import type { ScheduledJobRepositoryPort } from '@/application/ports/scheduling';
import {
  decideNextRunAfterAdvance,
  decideNextRunOnUpdate,
} from '@/domains/scheduling/job-lifecycle';
import { computeNextRun, scheduleDisplay } from '@/domains/scheduling/schedule';

/** Database accessor injected by the composition root or the S5 compat
 * module. No module-global connection state exists in this layer. */
export type ScheduledJobDatabaseAccessor = () => Database;

interface ScheduledJobRow {
  id: string;
  workspace_id: string;
  name: string;
  prompt: string;
  schedule_kind: string;
  schedule_config: string;
  schedule_display: string;
  state: string;
  repeat_limit: number | null;
  run_count: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_run_session_id: string | null;
  last_error: string | null;
  reuse_session: number;
  include_history: number;
  preconfig_id: string | null;
  origin_session_id: string | null;
  auto_approve_severity: string | null;
  notifications_enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToScheduledJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    prompt: row.prompt,
    scheduleKind: row.schedule_kind as ScheduleKind,
    scheduleConfig: JSON.parse(row.schedule_config) as ScheduleConfig,
    scheduleDisplay: row.schedule_display,
    state: row.state as ScheduledJobState,
    repeatLimit: row.repeat_limit,
    runCount: row.run_count,
    nextRunAt: row.next_run_at !== null ? new Date(row.next_run_at).toISOString() : null,
    lastRunAt: row.last_run_at !== null ? new Date(row.last_run_at).toISOString() : null,
    lastRunSessionId: row.last_run_session_id,
    lastError: row.last_error,
    reuseSession: row.reuse_session === 1,
    includeHistory: row.include_history === 1,
    preconfigId: row.preconfig_id,
    originSessionId: row.origin_session_id,
    autoApproveSeverity: row.auto_approve_severity as ScheduledJob['autoApproveSeverity'],
    notificationsEnabled: row.notifications_enabled === 1,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * SQLite implementation of the scheduled-job repository port. The accessor
 * is injected by the composition root or the compat module. SQL, schema,
 * ordering, and return shapes are unchanged from the pre-S4 store module;
 * the lifecycle policy decisions come from the scheduling domain.
 */
export function createScheduledJobRepository(
  getDb: ScheduledJobDatabaseAccessor,
): ScheduledJobRepositoryPort {
  function get(id: string): ScheduledJob | null {
    const row = getDb()
      .query('SELECT * FROM scheduled_jobs WHERE id = ?')
      .get(id) as ScheduledJobRow | undefined;
    return row ? rowToScheduledJob(row) : null;
  }

  return {
    create(workspaceId, input) {
      const db = getDb();
      const id = randomUUID();
      const now = Date.now();
      const display = scheduleDisplay(input.scheduleConfig);
      const nextRun = computeNextRun(input.scheduleConfig, now);

      db.run(
        `INSERT INTO scheduled_jobs
          (id, workspace_id, name, prompt, schedule_kind, schedule_config, schedule_display, state, repeat_limit, run_count, next_run_at, last_run_at, last_run_session_id, last_error, reuse_session, include_history, preconfig_id, origin_session_id, auto_approve_severity, notifications_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          workspaceId,
          input.name,
          input.prompt,
          input.scheduleKind,
          JSON.stringify(input.scheduleConfig),
          display,
          input.repeatLimit ?? null,
          nextRun,
          input.reuseSession ? 1 : 0,
          input.includeHistory ? 1 : 0,
          input.preconfigId ?? null,
          input.originSessionId ?? null,
          input.autoApproveSeverity ?? null,
          input.notificationsEnabled ? 1 : 0,
          now,
          now,
        ],
      );

      return get(id)!;
    },

    get,

    list(workspaceId) {
      const rows = getDb()
        .query('SELECT * FROM scheduled_jobs WHERE workspace_id = ? ORDER BY created_at DESC')
        .all(workspaceId) as ScheduledJobRow[];
      return rows.map(rowToScheduledJob);
    },

    update(id, updates) {
      const db = getDb();
      const existing = get(id);
      if (!existing) return null;

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const values: (string | number | null)[] = [now];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        values.push(updates.name);
      }
      if (updates.prompt !== undefined) {
        setClauses.push('prompt = ?');
        values.push(updates.prompt);
      }
      if (updates.preconfigId !== undefined) {
        setClauses.push('preconfig_id = ?');
        values.push(updates.preconfigId);
      }
      if (updates.repeatLimit !== undefined) {
        setClauses.push('repeat_limit = ?');
        values.push(updates.repeatLimit);
      }
      if (updates.reuseSession !== undefined) {
        setClauses.push('reuse_session = ?');
        values.push(updates.reuseSession ? 1 : 0);
      }
      if (updates.includeHistory !== undefined) {
        setClauses.push('include_history = ?');
        values.push(updates.includeHistory ? 1 : 0);
      }
      if (updates.autoApproveSeverity !== undefined) {
        setClauses.push('auto_approve_severity = ?');
        values.push(updates.autoApproveSeverity);
      }
      if (updates.notificationsEnabled !== undefined) {
        setClauses.push('notifications_enabled = ?');
        values.push(updates.notificationsEnabled ? 1 : 0);
      }
      if (updates.state !== undefined) {
        setClauses.push('state = ?');
        values.push(updates.state);
      }

      // Handle schedule changes
      const scheduleChanged =
        updates.scheduleKind !== undefined || updates.scheduleConfig !== undefined;
      if (scheduleChanged) {
        const kind = updates.scheduleKind ?? existing.scheduleKind;
        const config = updates.scheduleConfig ?? existing.scheduleConfig;
        const display = scheduleDisplay(config);
        setClauses.push('schedule_kind = ?', 'schedule_config = ?', 'schedule_display = ?');
        values.push(kind, JSON.stringify(config), display);
      }

      // The scheduling domain owns when next_run_at moves: paused jobs
      // always null it, schedule changes and resumes recompute it.
      const nextRunDecision = decideNextRunOnUpdate(existing, updates, now);
      if (nextRunDecision.kind === 'set') {
        setClauses.push('next_run_at = ?');
        values.push(nextRunDecision.nextRunAt);
      }

      values.push(id);
      db.run(`UPDATE scheduled_jobs SET ${setClauses.join(', ')} WHERE id = ?`, values);

      return get(id);
    },

    delete(id) {
      const result = getDb().run('DELETE FROM scheduled_jobs WHERE id = ?', [id]);
      return result.changes > 0;
    },

    deleteByWorkspace(workspaceId) {
      const result = getDb().run('DELETE FROM scheduled_jobs WHERE workspace_id = ?', [workspaceId]);
      return result.changes;
    },

    getDue(now) {
      const rows = getDb()
        .query(
          `SELECT * FROM scheduled_jobs
           WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at ASC`,
        )
        .all(now) as ScheduledJobRow[];
      return rows.map(rowToScheduledJob);
    },

    markRun(id, sessionId) {
      const now = Date.now();
      getDb().run(
        `UPDATE scheduled_jobs
         SET run_count = run_count + 1, last_run_at = ?, last_run_session_id = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`,
        [now, sessionId, now, id],
      );
    },

    markError(id, error) {
      const now = Date.now();
      getDb().run(
        `UPDATE scheduled_jobs SET last_error = ?, updated_at = ? WHERE id = ?`,
        [error, now, id],
      );
    },

    advance(id) {
      const db = getDb();
      const job = get(id);
      if (!job) return;

      const decision = decideNextRunAfterAdvance(job, Date.now());
      const now = Date.now();

      if (decision.kind === 'complete') {
        db.run(
          `UPDATE scheduled_jobs SET state = 'completed', next_run_at = NULL, updated_at = ? WHERE id = ?`,
          [now, id],
        );
      } else {
        db.run(
          `UPDATE scheduled_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?`,
          [decision.nextRunAt, now, id],
        );
      }
    },

    markCompleted(id) {
      const now = Date.now();
      getDb().run(
        `UPDATE scheduled_jobs SET state = 'completed', next_run_at = NULL, updated_at = ? WHERE id = ?`,
        [now, id],
      );
    },
  };
}
