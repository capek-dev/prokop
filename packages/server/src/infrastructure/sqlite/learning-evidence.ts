import type { Database } from 'bun:sqlite';
import { isLearningEvidenceEligible, type LearningEvidenceScope } from '@/domains/learning/policy';

interface SourceSession {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  metadata: string | null;
  settings: string | null;
}

function object(value: string | null): Record<string, unknown> | null {
  if (value === null) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** Host-owned eligibility, evaluated against current rows on every access. */
export function createLearningEvidenceReader(db: Database, scope: LearningEvidenceScope) {
  function session(id: string): SourceSession | null {
    return db.query<SourceSession, [string]>(`SELECT s.id, s.workspace_id, s.parent_id, s.metadata, w.settings
      FROM sessions s JOIN workspaces w ON w.id = s.workspace_id WHERE s.id = ?`).get(id);
  }
  function eligible(messageId: string): boolean {
    const message = db.query<{ session_id: string; agent: string | null; status: string | null; role: string }, [string]>(
      'SELECT session_id, agent, status, role FROM messages WHERE id = ?',
    ).get(messageId);
    if (!message || message.role !== 'assistant' || !['completed', 'error', 'interrupted'].includes(message.status ?? '')) return false;
    const source = session(message.session_id);
    if (!source) return false;
    const metadata = object(source.metadata);
    const settings = object(source.settings);
    if (!metadata || !settings) return false;
    let current: SourceSession | null = source;
    let automated = false;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id) || visited.size >= 100) return false;
      if (db.query('SELECT 1 FROM learning_session_origins WHERE session_id = ?').get(current.id)) return false;
      visited.add(current.id);
      const info = object(current.metadata);
      if (!info) return false;
      if (info.learningRunId !== undefined) return false;
      if (info.scheduledJobId !== undefined) automated = true;
      const policy = info.learning;
      if (policy !== undefined) {
        if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) return false;
        const excluded = (policy as Record<string, unknown>).excluded;
        if (excluded !== undefined && excluded !== false) return false;
      }
      if (!current.parent_id) break;
      current = session(current.parent_id);
      if (!current) return false;
    }
    return isLearningEvidenceEligible(scope, {
      workspaceId: source.workspace_id,
      participatingAgentIds: message.agent ? [message.agent] : [],
      origin: automated ? 'automated' : 'foreground', ancestorsEligible: true, completed: true,
      sessionLearning: metadata.learning, allowPersonalLearning: settings.allowPersonalLearning,
    });
  }
  return {
    eligible,
    /** Keyset pages within a reconciliation scan, including old-session additions.
     * Restart at zero on each reconciliation: older streaming rows may have completed
     * since the previous scan. This cursor must NOT become a durable completion watermark. */
    discover(afterRow: number, since: number, limit = 100): { scannedThrough: number; evidence: Array<{ messageId: string; sessionId: string; completedAt: number }> } {
      if (!Number.isSafeInteger(afterRow) || afterRow < 0 || !Number.isFinite(since) || since < 0
        || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid learning discovery bounds');
      const rows = db.query<{ rowid: number; id: string; session_id: string; completed_at: number }, [number, number, number]>(
        `SELECT rowid, id, session_id, COALESCE(completed_at, created_at) AS completed_at FROM messages
         WHERE rowid > ? AND role = 'assistant' AND status IN ('completed', 'error', 'interrupted')
         AND COALESCE(completed_at, created_at) >= ? ORDER BY rowid LIMIT ?`,
      ).all(afterRow, since, limit);
      return {
        scannedThrough: rows.at(-1)?.rowid ?? afterRow,
        evidence: rows.filter(row => eligible(row.id)).map(row => ({ messageId: row.id, sessionId: row.session_id, completedAt: row.completed_at })),
      };
    },
    /** Read a bounded completed turn, never the messages appended after its assistant response. */
    readTurn(messageId: string): Array<{ id: string; role: string; content: string; status: string | null }> {
      if (!eligible(messageId)) throw new Error('Conversation is not eligible for learning');
      const anchor = db.query<{ session_id: string; sequence: number }, [string]>('SELECT session_id, sequence FROM messages WHERE id = ?').get(messageId)!;
      const previous = db.query<{ sequence: number }, [string, number]>(
        "SELECT sequence FROM messages WHERE session_id = ? AND role = 'assistant' AND sequence < ? ORDER BY sequence DESC LIMIT 1",
      ).get(anchor.session_id, anchor.sequence)?.sequence ?? -1;
      const rows = db.query<{ id: string; role: string; status: string | null }, [string, number, number]>(
        'SELECT id, role, status FROM messages WHERE session_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT 100',
      ).all(anchor.session_id, previous, anchor.sequence);
      const sourceSettings = object(session(anchor.session_id)?.settings ?? null);
      const searchSettings = sourceSettings?.sessionSearch;
      const includeTools = searchSettings !== null && typeof searchSettings === 'object'
        && !Array.isArray(searchSettings) && (searchSettings as Record<string, unknown>).includeToolResults === true;
      return rows.map(row => {
        const parts = db.query<{ data: string; type: string }, [string]>("SELECT data, type FROM parts WHERE message_id = ? AND type IN ('text', 'tool') ORDER BY created_at, rowid LIMIT 100").all(row.id);
        const content = parts.map(part => {
          const parsed = object(part.data);
          if (part.type === 'tool') return includeTools && parsed ? JSON.stringify({ name: parsed.name, state: parsed.state }).slice(0, 8000) : '';
          return typeof parsed?.text === 'string' ? parsed.text : '';
        }).join('\n').slice(0, 16_000);
        return { ...row, content };
      });
    },
  };
}
