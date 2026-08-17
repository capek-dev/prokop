export interface FtsDatabase {
  run(sql: string, params?: unknown[]): unknown;
  query(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  transaction(callback: () => void): () => void;
}

export function initializeFts(db: FtsDatabase): void {
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id UNINDEXED,
      session_id UNINDEXED,
      workspace_id UNINDEXED,
      agent_id UNINDEXED,
      role UNINDEXED,
      content,
      tool_name,
      tokenize = 'unicode61'
    )
  `);
}

export function migrateFtsForAgents(db: FtsDatabase): void {
  const cols = db.prepare('PRAGMA table_info(messages_fts)').all() as Array<{ name: string }>;
  if (!cols.some((column) => column.name === 'agent_id')) {
    db.run('DROP TABLE IF EXISTS messages_fts');
    initializeFts(db);
  }
}

const BACKFILL_BATCH_SIZE = 500;
const BACKFILL_PROGRESS_INTERVAL = 5000;

export function backfillFts(db: FtsDatabase): number {
  const ftsCount = (db.query('SELECT COUNT(*) as cnt FROM messages_fts').get() as { cnt: number }).cnt;
  if (ftsCount > 0) return 0;

  const msgCount = (db.query('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt;
  if (msgCount === 0) return 0;

  console.log(`[fts] Backfilling ${msgCount} messages into search index...`);
  const totalBackfilled = batchBackfill(db, BACKFILL_BATCH_SIZE);
  console.log(`[fts] Backfill complete: ${totalBackfilled} messages indexed`);
  return totalBackfilled;
}

function batchBackfill(db: FtsDatabase, batchSize: number): number {
  const totalMsgs = (db.query('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt;
  const totalBatches = Math.ceil(totalMsgs / batchSize);
  let totalBackfilled = 0;
  let offset = 0;

  for (let batch = 0; batch < totalBatches; batch++) {
    db.transaction(() => {
      const rows = db.query(`
        SELECT
          m.id as message_id,
          m.session_id,
          s.workspace_id,
          s.agent_id,
          m.role,
          m.created_at,
          GROUP_CONCAT(
            CASE
              WHEN p.type = 'text' THEN json_extract(p.data, '$.text')
              WHEN p.type = 'reasoning' THEN json_extract(p.data, '$.text')
              WHEN p.type = 'tool' THEN json_extract(p.data, '$.name')
              ELSE NULL
            END, ' '
          ) as content,
          GROUP_CONCAT(
            CASE
              WHEN p.type = 'tool' THEN json_extract(p.data, '$.name')
              ELSE NULL
            END, ' '
          ) as tool_name
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        LEFT JOIN parts p ON p.message_id = m.id
        WHERE s.workspace_id IS NOT NULL
        GROUP BY m.id
        ORDER BY m.created_at ASC
        LIMIT ? OFFSET ?
      `).all(batchSize, offset) as Array<{
        message_id: string;
        session_id: string;
        workspace_id: string;
        agent_id: string | null;
        role: string;
        created_at: number;
        content: string | null;
        tool_name: string | null;
      }>;

      const insert = db.prepare(`
        INSERT INTO messages_fts (message_id, session_id, workspace_id, agent_id, role, content, tool_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of rows) {
        if (!row.content && !row.tool_name) continue;
        insert.run(
          row.message_id,
          row.session_id,
          row.workspace_id,
          row.agent_id,
          row.role,
          row.content ?? '',
          row.tool_name ?? '',
        );
        totalBackfilled++;
      }
      offset += batchSize;
    })();

    if (totalBackfilled >= (batch + 1) * BACKFILL_PROGRESS_INTERVAL) {
      console.log(`[fts] Backfill progress: ${totalBackfilled}/${totalMsgs} messages`);
    }
  }

  return totalBackfilled;
}

export function indexMessage(
  db: FtsDatabase,
  messageId: string,
  sessionId: string,
  workspaceId: string,
  role: string,
  content: string,
  toolName: string,
  agentId?: string | null,
): void {
  if (!content && !toolName) {
    db.run('DELETE FROM messages_fts WHERE message_id = ?', [messageId]);
    return;
  }

  db.transaction(() => {
    db.run('DELETE FROM messages_fts WHERE message_id = ?', [messageId]);
    db.run(
      'INSERT INTO messages_fts (message_id, session_id, workspace_id, agent_id, role, content, tool_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [messageId, sessionId, workspaceId, agentId ?? null, role, content, toolName],
    );
  })();
}

export function removeMessageFromFts(db: FtsDatabase, messageId: string): void {
  db.run('DELETE FROM messages_fts WHERE message_id = ?', [messageId]);
}

export function removeSessionFromFts(db: FtsDatabase, sessionId: string): void {
  db.run('DELETE FROM messages_fts WHERE session_id = ?', [sessionId]);
}
