import type { Database } from 'bun:sqlite';

/** Additive product tables. Review checkpoints never modify conversation ordering. */
export function initializeLearningSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS learning_reviewers (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL,
    activated_at INTEGER NOT NULL,
    backfill_from INTEGER NOT NULL,
    last_started_at INTEGER,
    PRIMARY KEY (workspace_id, reviewer_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learning_evidence (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    completed_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    UNIQUE (workspace_id, reviewer_id, message_id),
    FOREIGN KEY (workspace_id, reviewer_id) REFERENCES learning_reviewers(workspace_id, reviewer_id) ON DELETE CASCADE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_learning_pending ON learning_evidence(workspace_id, reviewer_id, reviewed_at, sequence)');
  db.run(`CREATE TABLE IF NOT EXISTS learning_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    lease_until INTEGER NOT NULL,
    error TEXT,
    FOREIGN KEY (workspace_id, reviewer_id) REFERENCES learning_reviewers(workspace_id, reviewer_id) ON DELETE CASCADE
  )`);
  // Independent of editable metadata and retained until the session is deleted.
  db.run(`CREATE TABLE IF NOT EXISTS learning_session_origins (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learning_resolutions (
    run_id TEXT PRIMARY KEY REFERENCES learning_runs(id) ON DELETE CASCADE,
    resolved_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learning_recoveries (
    run_id TEXT PRIMARY KEY REFERENCES learning_runs(id) ON DELETE CASCADE,
    recovered_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learning_destinations (
    run_id TEXT PRIMARY KEY REFERENCES learning_runs(id) ON DELETE CASCADE,
    workspace_path TEXT NOT NULL,
    memory_directory TEXT NOT NULL,
    skills_directory TEXT NOT NULL
  )`);
  // All reviewers writing the same destination serialize, not just identical reviewers.
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_active_destination ON learning_runs(workspace_id) WHERE status = 'running'");
  db.run(`CREATE TABLE IF NOT EXISTS learning_run_evidence (
    run_id TEXT NOT NULL REFERENCES learning_runs(id) ON DELETE CASCADE,
    evidence_sequence INTEGER NOT NULL REFERENCES learning_evidence(sequence) ON DELETE CASCADE,
    PRIMARY KEY (run_id, evidence_sequence)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learning_supporting_sources (
    run_id TEXT NOT NULL REFERENCES learning_runs(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    PRIMARY KEY (run_id, message_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learning_changes (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES learning_runs(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    before_content TEXT,
    after_content TEXT,
    status TEXT NOT NULL CHECK (status IN ('prepared', 'applied', 'conflict', 'undone')),
    created_at INTEGER NOT NULL,
    UNIQUE (run_id, operation_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS learning_undo_intents (
    change_id TEXT PRIMARY KEY REFERENCES learning_changes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  )`);
}
