import type { Database } from 'bun:sqlite';
import { isAbsolute } from 'node:path';
import { LEARNING_BACKFILL_MS } from '@/domains/learning/policy';

export interface LearningReviewerRecord {
  workspace_id: string;
  reviewer_id: string;
  activated_at: number;
  backfill_from: number;
  last_started_at: number | null;
}

export interface LearningEvidenceRecord {
  sequence: number;
  workspace_id: string;
  reviewer_id: string;
  session_id: string;
  message_id: string;
  completed_at: number;
  reviewed_at: number | null;
}

export interface LearningRunRecord {
  id: string;
  workspace_id: string;
  reviewer_id: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  started_at: number;
  finished_at: number | null;
  lease_until: number;
  error: string | null;
}

export interface LearningDestinationRecord {
  run_id: string;
  workspace_path: string;
  memory_directory: string;
  skills_directory: string;
}

export interface LearningChangeRecord {
  id: string;
  run_id: string;
  operation_id: string;
  relative_path: string;
  before_content: string | null;
  after_content: string | null;
  status: 'prepared' | 'applied' | 'conflict' | 'undone';
  created_at: number;
}

function requireTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid learning timestamp');
}

/** Inject a connection so tests never open the user's database. */
export function createLearningRepository(db: Database) {
  function getRun(id: string): LearningRunRecord | null {
    return db.query<LearningRunRecord, [string]>('SELECT * FROM learning_runs WHERE id = ?').get(id);
  }

  function destination(runId: string): LearningDestinationRecord | null {
    return db.query<LearningDestinationRecord, [string]>('SELECT * FROM learning_destinations WHERE run_id = ?').get(runId);
  }

  function getReviewer(workspaceId: string, reviewerId: string): LearningReviewerRecord | null {
    return db.query<LearningReviewerRecord, [string, string]>(
      'SELECT * FROM learning_reviewers WHERE workspace_id = ? AND reviewer_id = ?',
    ).get(workspaceId, reviewerId);
  }

  function pending(workspaceId: string, reviewerId: string, limit = 100, eligible: (messageId: string) => boolean = () => true): LearningEvidenceRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid learning batch limit');
    const result: LearningEvidenceRecord[] = [];
    let after = 0;
    while (result.length < limit) {
      // Materialize bounded pages before callbacks or writes. Breaking a cached
      // SQLite iterator early can leave its statement unusable for the next call.
      const page = db.query<LearningEvidenceRecord, [string, string, number]>(
        'SELECT * FROM learning_evidence WHERE workspace_id = ? AND reviewer_id = ? AND reviewed_at IS NULL AND sequence > ? ORDER BY sequence LIMIT 100',
      ).all(workspaceId, reviewerId, after);
      if (!page.length) break;
      for (const item of page) {
        after = item.sequence;
        if (eligible(item.message_id)) result.push(item);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  function changes(runId: string): LearningChangeRecord[] {
    return db.query<LearningChangeRecord, [string]>('SELECT * FROM learning_changes WHERE run_id = ? ORDER BY rowid').all(runId);
  }

  function blocked(workspaceId: string): boolean {
    return db.query(`SELECT id FROM learning_runs WHERE workspace_id = ? AND status = 'running'
      UNION ALL SELECT c.id FROM learning_changes c JOIN learning_runs r ON r.id = c.run_id
      WHERE r.workspace_id = ? AND NOT EXISTS (SELECT 1 FROM learning_resolutions x WHERE x.run_id = r.id)
        AND ((NOT EXISTS (SELECT 1 FROM learning_recoveries a WHERE a.run_id = r.id)
          AND (c.status IN ('prepared', 'conflict') OR (r.status IN ('failed', 'interrupted') AND c.status = 'applied')))
          OR EXISTS (SELECT 1 FROM learning_undo_intents u WHERE u.change_id = c.id)) LIMIT 1`).get(workspaceId, workspaceId) !== null;
  }

  return {
    getRun,
    reviewSessionId(runId: string): string | null {
      return db.query<{ id: string }, [string]>(`SELECT s.id FROM learning_session_origins o
        JOIN sessions s ON s.id = o.session_id JOIN learning_runs r ON r.id = o.run_id
        WHERE o.run_id = ? AND s.parent_id IS NULL AND s.workspace_id = r.workspace_id
        ORDER BY s.created_at, s.id LIMIT 1`).get(runId)?.id ?? null;
    },
    isRecovered(runId: string): boolean {
      return db.query('SELECT 1 FROM learning_recoveries WHERE run_id = ?').get(runId) !== null;
    },
    recoveryCandidates(workspaceId: string): LearningRunRecord[] {
      return db.query<LearningRunRecord, [string]>(`SELECT r.* FROM learning_runs r
        WHERE r.workspace_id = ? AND r.status != 'running'
        AND NOT EXISTS (SELECT 1 FROM learning_resolutions x WHERE x.run_id = r.id)
        AND ((NOT EXISTS (SELECT 1 FROM learning_recoveries a WHERE a.run_id = r.id)
          AND (r.status IN ('failed', 'interrupted') OR EXISTS (SELECT 1 FROM learning_changes c WHERE c.run_id = r.id AND c.status IN ('prepared', 'conflict'))))
          OR EXISTS (SELECT 1 FROM learning_changes c JOIN learning_undo_intents u ON u.change_id = c.id WHERE c.run_id = r.id))
        ORDER BY r.rowid LIMIT 100`).all(workspaceId);
    },
    /** Retire old operations without writing files or consuming unfinished evidence. */
    completeRecovery(runId: string, now: number): void {
      requireTimestamp(now);
      db.transaction(() => {
        const run = getRun(runId);
        if (!run || run.status === 'running' || db.query("SELECT 1 FROM learning_runs WHERE workspace_id = ? AND status = 'running'").get(run.workspace_id)) {
          throw new Error('Learning writer is active');
        }
        // Unknown bytes remain untouched. These old intents must never be replayed.
        db.run("UPDATE learning_changes SET status = 'conflict' WHERE run_id = ? AND (status = 'prepared' OR id IN (SELECT change_id FROM learning_undo_intents))", [runId]);
        db.run('DELETE FROM learning_undo_intents WHERE change_id IN (SELECT id FROM learning_changes WHERE run_id = ?)', [runId]);
        db.run('INSERT OR IGNORE INTO learning_recoveries VALUES (?, ?)', [runId, now]);
      }).immediate();
    },
    sources(runId: string): Array<{ message_id: string; session_id: string }> {
      return db.query<{ message_id: string; session_id: string }, [string, string]>(`SELECT e.message_id, e.session_id
        FROM learning_evidence e JOIN learning_run_evidence r ON r.evidence_sequence = e.sequence WHERE r.run_id = ?
        UNION SELECT message_id, session_id FROM learning_supporting_sources WHERE run_id = ?`).all(runId, runId);
    },
    recordSource(runId: string, messageId: string): void {
      db.run(`INSERT OR IGNORE INTO learning_supporting_sources (run_id, message_id, session_id)
        SELECT ?, m.id, m.session_id FROM messages m JOIN learning_runs r ON r.id = ?
        WHERE m.id = ? AND r.status = 'running'`, [runId, runId, messageId]);
    },
    isResolved(runId: string): boolean {
      return db.query('SELECT 1 FROM learning_resolutions WHERE run_id = ?').get(runId) !== null;
    },
    /** Explicit user acknowledgement retains files and consumes the batch, never retries its writes. */
    keepCurrent(runId: string, now: number): void {
      requireTimestamp(now);
      db.transaction(() => {
        const run = getRun(runId);
        if (!run || run.status === 'running') throw new Error('Cannot resolve an active run');
        if (db.query("SELECT 1 FROM learning_runs WHERE workspace_id = ? AND status = 'running'").get(run.workspace_id)) throw new Error('Learning writer is active');
        db.run('INSERT OR IGNORE INTO learning_resolutions VALUES (?, ?)', [runId, now]);
        db.run('DELETE FROM learning_undo_intents WHERE change_id IN (SELECT id FROM learning_changes WHERE run_id = ?)', [runId]);
        db.run('UPDATE learning_evidence SET reviewed_at = ? WHERE sequence IN (SELECT evidence_sequence FROM learning_run_evidence WHERE run_id = ?)', [now, runId]);
      }).immediate();
    },
    activeRun(workspaceId: string): LearningRunRecord | null {
      return db.query<LearningRunRecord, [string]>("SELECT * FROM learning_runs WHERE workspace_id = ? AND status = 'running'").get(workspaceId);
    },
    destination,
    bindDestination(input: LearningDestinationRecord): void {
      if ([input.workspace_path, input.memory_directory, input.skills_directory].some(path => !isAbsolute(path) || path.includes('\0'))) {
        throw new Error('Learning destination must use absolute paths');
      }
      db.transaction(() => {
        const run = getRun(input.run_id);
        if (!run || run.status !== 'running') throw new Error('Learning run is not active');
        const existing = destination(input.run_id);
        if (existing) {
          if (existing.workspace_path !== input.workspace_path || existing.memory_directory !== input.memory_directory
            || existing.skills_directory !== input.skills_directory) throw new Error('Learning destination cannot change');
          return;
        }
        db.run('INSERT INTO learning_destinations (run_id, workspace_path, memory_directory, skills_directory) VALUES (?, ?, ?, ?)',
          [input.run_id, input.workspace_path, input.memory_directory, input.skills_directory]);
      }).immediate();
    },
    getReviewer,
    pending,
    changes,
    blocked,
    discardPending(sequence: number): void {
      db.run(`DELETE FROM learning_evidence WHERE sequence = ? AND reviewed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM learning_run_evidence WHERE evidence_sequence = ?)`, [sequence, sequence]);
    },
    activate(workspaceId: string, reviewerId: string, now: number): LearningReviewerRecord {
      requireTimestamp(now);
      if (!workspaceId || !reviewerId) throw new Error('Missing learning reviewer identity');
      db.run('INSERT OR IGNORE INTO learning_reviewers (workspace_id, reviewer_id, activated_at, backfill_from) VALUES (?, ?, ?, ?)',
        [workspaceId, reviewerId, now, Math.max(0, now - LEARNING_BACKFILL_MS)]);
      return getReviewer(workspaceId, reviewerId)!;
    },
    enqueue(workspaceId: string, reviewerId: string, sessionId: string, messageId: string, completedAt: number): boolean {
      requireTimestamp(completedAt);
      const reviewer = getReviewer(workspaceId, reviewerId);
      if (!reviewer || completedAt < reviewer.backfill_from) return false;
      // Prevent callers accidentally pairing a message with another session.
      return db.run(`INSERT OR IGNORE INTO learning_evidence
        (workspace_id, reviewer_id, session_id, message_id, completed_at)
        SELECT ?, ?, ?, id, ? FROM messages WHERE id = ? AND session_id = ?`,
      [workspaceId, reviewerId, sessionId, completedAt, messageId, sessionId]).changes === 1;
    },
    claim(workspaceId: string, reviewerId: string, now: number, leaseMs: number, limit = 100, eligible: (messageId: string) => boolean = () => true): LearningRunRecord | null {
      requireTimestamp(now);
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3_600_000) throw new Error('Invalid learning lease');
      return db.transaction(() => {
        const reviewer = getReviewer(workspaceId, reviewerId);
        if (!reviewer) return null;
        // Expiry never permits overlapping writers. Partial applied runs also
        // require automatic recovery before a fresh review of the evidence.
        if (blocked(workspaceId)) return null;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid learning batch limit');
        const evidence = pending(workspaceId, reviewerId, limit, eligible);
        if (!evidence.length) return null;
        const id = crypto.randomUUID();
        db.run(`INSERT INTO learning_runs (id, workspace_id, reviewer_id, status, started_at, lease_until)
          VALUES (?, ?, ?, 'running', ?, ?)`, [id, workspaceId, reviewerId, now, now + leaseMs]);
        for (const item of evidence) {
          db.run('INSERT INTO learning_run_evidence (run_id, evidence_sequence) VALUES (?, ?)', [id, item.sequence]);
        }
        db.run('UPDATE learning_reviewers SET last_started_at = ? WHERE workspace_id = ? AND reviewer_id = ?', [now, workspaceId, reviewerId]);
        return getRun(id);
      }).immediate();
    },
    evidence(runId: string): LearningEvidenceRecord[] {
      return db.query<LearningEvidenceRecord, [string]>(`SELECT e.* FROM learning_evidence e
        JOIN learning_run_evidence r ON r.evidence_sequence = e.sequence WHERE r.run_id = ? ORDER BY e.sequence`).all(runId);
    },
    heartbeat(runId: string, now: number, leaseMs: number): boolean {
      requireTimestamp(now);
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3_600_000) throw new Error('Invalid learning lease');
      return db.run("UPDATE learning_runs SET lease_until = ? WHERE id = ? AND status = 'running' AND lease_until > ?",
        [now + leaseMs, runId, now]).changes === 1;
    },
    finish(runId: string, now: number, result: { success: true } | { success: false; error: string; interrupted?: boolean }): boolean {
      requireTimestamp(now);
      return db.transaction(() => {
        const run = getRun(runId);
        if (!run || run.status !== 'running' || (result.success && run.lease_until <= now)) return false;
        if (result.success && changes(runId).some(change => change.status === 'prepared' || change.status === 'conflict')) return false;
        if (result.success) {
          db.run(`UPDATE learning_evidence SET reviewed_at = ? WHERE sequence IN
            (SELECT evidence_sequence FROM learning_run_evidence WHERE run_id = ?)`, [now, runId]);
        }
        db.run('UPDATE learning_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?',
          [result.success ? 'completed' : result.interrupted ? 'interrupted' : 'failed', now, result.success ? null : result.error.slice(0, 2000), runId]);
        return true;
      }).immediate();
    },
    /** Startup only, after proving no writer from this process is still running. */
    recover(now: number): number {
      requireTimestamp(now);
      return db.run("UPDATE learning_runs SET status = 'interrupted', finished_at = ?, error = 'Interrupted before completion' WHERE status = 'running'", [now]).changes;
    },
    listRuns(workspaceId: string, limit = 50): LearningRunRecord[] {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid history limit');
      return db.query<LearningRunRecord, [string, number]>(`SELECT r.* FROM learning_runs r WHERE workspace_id = ?
        ORDER BY started_at DESC, r.rowid DESC LIMIT ?`).all(workspaceId, limit);
    },
    prepareChange(input: Omit<LearningChangeRecord, 'id' | 'status'>): LearningChangeRecord {
      requireTimestamp(input.created_at);
      const path = input.relative_path;
      if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error('Invalid knowledge relative path');
      }
      return db.transaction(() => {
        const run = getRun(input.run_id);
        if (!run || run.status !== 'running' || run.lease_until <= input.created_at) throw new Error('Learning run is not active');
        const existing = db.query<LearningChangeRecord, [string, string]>(
          'SELECT * FROM learning_changes WHERE run_id = ? AND operation_id = ?',
        ).get(input.run_id, input.operation_id);
        if (existing) {
          if (existing.relative_path !== path || existing.before_content !== input.before_content || existing.after_content !== input.after_content) {
            throw new Error('Learning operation ID reused with different content');
          }
          return existing;
        }
        const id = crypto.randomUUID();
        db.run(`INSERT INTO learning_changes (id, run_id, operation_id, relative_path, before_content, after_content, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?)`,
        [id, input.run_id, input.operation_id, path, input.before_content, input.after_content, input.created_at]);
        return { ...input, id, status: 'prepared' as const };
      }).immediate();
    },
    hasUndoIntent(changeId: string): boolean {
      return db.query('SELECT change_id FROM learning_undo_intents WHERE change_id = ?').get(changeId) !== null;
    },
    prepareUndo(changeId: string, now: number): boolean {
      requireTimestamp(now);
      return db.transaction(() => {
        const change = db.query<LearningChangeRecord, [string]>('SELECT * FROM learning_changes WHERE id = ?').get(changeId);
        const run = change && getRun(change.run_id);
        if (!change || change.status !== 'applied' || !run) return false;
        if (db.query("SELECT id FROM learning_runs WHERE workspace_id = ? AND status = 'running'").get(run.workspace_id)) return false;
        return db.run('INSERT OR IGNORE INTO learning_undo_intents (change_id, created_at) VALUES (?, ?)', [changeId, now]).changes === 1;
      }).immediate();
    },
    finishUndo(changeId: string, success: boolean): boolean {
      return db.transaction(() => {
        if (!db.query('SELECT change_id FROM learning_undo_intents WHERE change_id = ?').get(changeId)) return false;
        if (success && db.run("UPDATE learning_changes SET status = 'undone' WHERE id = ? AND status = 'applied'", [changeId]).changes !== 1) return false;
        db.run('DELETE FROM learning_undo_intents WHERE change_id = ?', [changeId]);
        return true;
      }).immediate();
    },
    transitionChange(id: string, from: LearningChangeRecord['status'], to: LearningChangeRecord['status']): boolean {
      const allowed = (from === 'prepared' && (to === 'applied' || to === 'conflict'))
        || (from === 'applied' && (to === 'undone' || to === 'conflict'));
      if (!allowed) return false;
      return db.run('UPDATE learning_changes SET status = ? WHERE id = ? AND status = ?', [to, id, from]).changes === 1;
    },
  };
}

export type LearningRepository = ReturnType<typeof createLearningRepository>;
