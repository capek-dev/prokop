import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import type { SelectedContextRecord } from '@prokopai/sdk';
import { getDatabase } from './database';

const source = z.enum(['agent', 'workspace']);
const score = z.number().finite().min(0).max(3);
const probability = z.number().finite().min(0).max(1);
const snapshotSchema = z.object({
  sessionId: z.string(), assistantMessageId: z.string(), requestMessageId: z.string().optional(), checkpointMessageId: z.string().optional(),
  continuation: z.boolean(), createdAt: z.string(),
  outcome: z.enum(['selected', 'disabled', 'missing_credentials', 'missing_evidence', 'timeout', 'failed', 'input_limit']),
  threshold: score, requiredProbability: probability.optional(), elapsedMs: z.number().finite().nonnegative(),
  items: z.array(z.object({
    id: z.string(), kind: z.enum(['memory', 'skill', 'preferences']), source, name: z.string(), description: z.string().optional(),
    revision: z.string(), content: z.string(), inclusion: z.enum(['selected', 'preloaded', 'always', 'baseline']), score: score.optional(), qualifyingProbability: probability.optional(),
  })),
  excluded: z.array(z.object({ id: z.string(), name: z.string(), source, score, qualifyingProbability: probability.optional(), reason: z.enum(['threshold', 'budget']) })),
});

export function initializeSelectedContextSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS selected_context (
    assistant_message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    snapshot TEXT NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS selected_context_session ON selected_context(session_id)');
  // The response ID is reserved before the message exists, so a message FK is not possible.
  db.run(`CREATE TRIGGER IF NOT EXISTS selected_context_message_deleted AFTER DELETE ON messages
    BEGIN DELETE FROM selected_context WHERE assistant_message_id = OLD.id; END`);
  // Schema initialization precedes active turns. Drop preparations abandoned before message creation.
  db.run('DELETE FROM selected_context WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.id = selected_context.assistant_message_id)');
}

export function saveSelectedContext(record: SelectedContextRecord): void {
  const snapshot = JSON.stringify(record);
  if (snapshot.length > 512000) throw new Error('Selected context snapshot exceeds storage limit');
  getDatabase().query('INSERT INTO selected_context (assistant_message_id, session_id, snapshot) VALUES (?, ?, ?)')
    .run(record.assistantMessageId, record.sessionId, snapshot);
}

export function getSelectedContext(sessionId: string, messageId: string): SelectedContextRecord | null {
  // Prepared snapshots are not exposed as responses until the exact message exists.
  const row = getDatabase().query(`SELECT c.snapshot FROM selected_context c
    JOIN messages m ON m.id = c.assistant_message_id AND m.session_id = c.session_id AND m.role = 'assistant'
    WHERE c.session_id = ? AND c.assistant_message_id = ?`).get(sessionId, messageId) as { snapshot: string } | null;
  if (!row) return null;
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(row.snapshot));
    if (!parsed.success || parsed.data.sessionId !== sessionId || parsed.data.assistantMessageId !== messageId) return null;
    return parsed.data;
  } catch { return null; }
}
