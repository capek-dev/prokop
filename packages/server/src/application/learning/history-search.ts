import type { ToolResult } from '@capekai/tool';

export interface LearningHistoryTurn {
  messageId: string;
  sessionId: string;
  completedAt: number;
}

export interface LearningHistorySearchDependencies {
  /** Host-selected candidates, never a model-supplied repository or path. */
  candidates(): Promise<readonly LearningHistoryTurn[]>;
  eligible(messageId: string): boolean;
  readTurn(messageId: string): Array<{ id: string; role: string; content: string; status?: string | null }>;
  authorize(): Promise<void>;
}

/** Bounded history search over authorized completed turns. Filtering precedes
 * ranking, snippets and result limits. No generic unscoped search fallback. */
export function createLearningHistorySearch(deps: LearningHistorySearchDependencies): (input: Record<string, unknown>) => Promise<ToolResult> {
  return async input => {
    await deps.authorize();
    const action = input.action ?? (typeof input.query === 'string' ? 'search' : input.sessionId ? 'read' : 'list');
    if (!['list', 'search', 'read'].includes(String(action))) return { success: false, error: 'Invalid history action' };
    const requestedLimit = input.limit ?? (action === 'read' ? input.window : undefined) ?? 10;
    if (typeof requestedLimit !== 'number' || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 25) {
      return { success: false, error: 'History limit must be between 1 and 25' };
    }
    if (input.sessionId !== undefined && typeof input.sessionId !== 'string') return { success: false, error: 'Invalid session ID' };
    if (action === 'read' && !input.sessionId) return { success: false, error: 'Session ID is required' };
    if (action === 'search' && (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500)) {
      return { success: false, error: 'A bounded search query is required' };
    }
    const candidates = await deps.candidates();
    if (candidates.length > 1000) return { success: false, error: 'History candidate budget exceeded' };
    const eligible = candidates.filter(turn => deps.eligible(turn.messageId)
      && (!input.sessionId || turn.sessionId === input.sessionId));
    eligible.sort((a, b) => b.completedAt - a.completedAt);
    if (action === 'list') {
      const sessions = new Map<string, { sessionId: string; latestCompletedAt: number; turnCount: number }>();
      for (const turn of eligible) {
        const previous = sessions.get(turn.sessionId);
        if (previous) previous.turnCount++;
        else sessions.set(turn.sessionId, { sessionId: turn.sessionId, latestCompletedAt: turn.completedAt, turnCount: 1 });
      }
      return { success: true, result: { sessions: [...sessions.values()].slice(0, requestedLimit), bounded: true } };
    }
    const terms = typeof input.query === 'string' ? input.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const results: Array<{ sessionId: string; messageId: string; completedAt: number; content: string; score: number }> = [];
    let remaining = 128_000;
    for (const turn of eligible) {
      await deps.authorize();
      if (!deps.eligible(turn.messageId)) continue;
      const content = deps.readTurn(turn.messageId).map(message => `${message.role}${message.status ? ` (${message.status})` : ''}: ${message.content}`).join('\n');
      const score = terms.reduce((sum, term) => sum + (content.toLowerCase().includes(term) ? 1 : 0), 0);
      if (action === 'search' && score !== terms.length) continue;
      const bounded = content.slice(0, Math.min(action === 'read' ? 16_000 : 2000, remaining));
      remaining -= bounded.length;
      results.push({ ...turn, content: bounded, score });
      if (remaining <= 0 || (action === 'read' && results.length >= requestedLimit)) break;
    }
    if (action === 'search' && input.sort !== 'newest' && input.sort !== 'oldest') results.sort((a, b) => b.score - a.score || b.completedAt - a.completedAt);
    if (input.sort === 'oldest') results.sort((a, b) => a.completedAt - b.completedAt);
    return { success: true, result: { turns: results.slice(0, requestedLimit).map(({ score: _score, ...turn }) => turn), bounded: true } };
  };
}
