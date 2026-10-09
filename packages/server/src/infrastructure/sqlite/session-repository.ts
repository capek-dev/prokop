/**
 * S5 session repository: SQL and row mapping for the sessions table over
 * an injected database accessor. Side effects that the current
 * implementation interleaves with SQL (FTS removal, attachment deletion,
 * output-dir cleanup) arrive through the temporary hooks, preserving the
 * exact pre-slice ordering inside the delete transactions. S6 owns moving
 * the projection behind committed events, at which point the FTS hook
 * retires.
 */

import type { Database } from 'bun:sqlite';
import type { Session, SessionStatus, SubagentStatus, SessionListFilter, SessionCategory, SessionCategoryCounts, PermissionMode } from '@prokopai/sdk';
import { withDerivedHarnessState } from '@/domains/sessions/harness-state';
import { resolveSessionVariant } from '@/domains/sessions/variant';
import { findModelVariantKeys, getModelsConfig } from '@/config';
import { getWorkspacePermissionMode } from './workspaces';
import type {
  ListSessionPageOptions,
  SessionCreateInput,
  SessionCursorPayload,
  SessionMessageRepositoryHooks,
  SessionPage,
  SessionPageInfo,
  SessionStorePort,
  SessionUpdateInput,
} from '@/application/ports/session-message';
import { notifyAttentionChanged } from './attention-signals';

export type SessionDatabaseAccessor = () => Database;

// Match sidebar classification before pagination. Malformed legacy metadata is empty.
function categoryPredicate(category: SessionCategory): string {
  const metadata = "CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END";
  const truthy = (field: string) => `COALESCE(json_extract(${metadata}, '$.${field}'), '') NOT IN ('', 0)`;
  const root = `parent_id IS NULL AND NOT (${truthy('learningRunId')})`;
  const scheduled = truthy('scheduledJobId');
  switch (category) {
    case 'active': return `${root} AND NOT (${scheduled}) AND status = 'active'`;
    case 'archived': return `${root} AND status = 'closed'`;
    case 'scheduled': return `${root} AND (${scheduled})`;
  }
}

interface SessionRow {
  id: string;
  preconfig_id: string | null;
  workspace_id: string | null;
  workspace_root_id: string | null;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  selected_model: string | null;
  selected_provider: string | null;
  selected_variant: string | null;
  harness: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  no_cache_tokens: number;
  parent_id: string | null;
  agent_name: string | null;
  subagent_status: string | null;
  running_at: string | null;
  compacting: number;
  tags: string;
  permission_mode: string | null;
  agent_id: string | null;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MIN_PAGE_SIZE = 1;

/**
 * Read-time variant resolution: every model with variants always carries a
 * concrete variant. A null or stale stored value resolves to the model's
 * first (lowest) variant; sessions without a model resolve against the
 * config default so fresh sessions display the effective variant. Catalog
 * read failures fall back to the stored value.
 */
function resolveRowVariant(modelId: string | null, providerId: string | null, storedParam: string | null): string | null {
  try {
    let resolvedModel = modelId;
    let resolvedProvider = providerId;
    let stored = storedParam;
    if (!resolvedModel) {
      const config = getModelsConfig();
      resolvedModel = config.defaultModel;
      resolvedProvider = resolvedProvider ?? config.defaultProvider;
      // Fresh sessions follow the default-model default variant; an explicit
      // session variant is never overridden by it.
      stored = stored ?? config.defaultVariant ?? null;
    }
    return resolveSessionVariant(
      findModelVariantKeys(resolvedModel || undefined, resolvedProvider || undefined),
      stored,
    );
  } catch {
    return storedParam;
  }
}

function mapRowToSession(row: SessionRow): Session {
  if (row.harness !== 'prokop' && row.harness !== 'codex-cli' && row.harness !== 'claude-cli') {
    throw new Error('Unknown session harness');
  }
  return withDerivedHarnessState({
    id: row.id,
    preconfigId: row.preconfig_id,
    workspaceId: row.workspace_id || '',
    workspaceRootId: row.workspace_root_id ?? null,
    harness: row.harness,
    title: row.title,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    selectedModel: row.selected_model ?? null,
    selectedProvider: row.selected_provider ?? null,
    selectedVariant: resolveRowVariant(row.selected_model ?? null, row.selected_provider ?? null, row.selected_variant ?? null),
    promptTokens: row.prompt_tokens ?? undefined,
    completionTokens: row.completion_tokens ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    cacheWriteTokens: row.cache_write_tokens ?? undefined,
    noCacheTokens: row.no_cache_tokens ?? undefined,
    parentId: row.parent_id ?? null,
    agentName: row.agent_name ?? null,
    subagentStatus: row.subagent_status as SubagentStatus | null ?? null,
    runningAt: row.running_at ?? null,
    compacting: !!row.compacting,
    tags: row.tags ? JSON.parse(row.tags) : [],
    permissionMode: (row.permission_mode as PermissionMode | null)
      ?? getWorkspacePermissionMode(row.workspace_id || ''),
    agentId: row.agent_id ?? null,
  });
}

/** Clamp a page size to the valid range. */
function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < MIN_PAGE_SIZE) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/** Encode a cursor payload as an opaque base64url string. */
function encodeSessionCursor(payload: SessionCursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode and validate an opaque cursor string.
 * Returns null for invalid cursors rather than throwing.
 */
function decodeSessionCursor(cursor: string): SessionCursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;

    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;

    if (obj.version !== 1) return null;
    if (typeof obj.id !== 'string' || obj.id.length === 0) return null;
    if (typeof obj.updatedAt !== 'string' || obj.updatedAt.length === 0) return null;
    // Validate the timestamp is parseable
    const ts = Date.parse(obj.updatedAt);
    if (isNaN(ts)) return null;

    return { version: 1, updatedAt: obj.updatedAt as string, id: obj.id as string };
  } catch {
    return null;
  }
}

export function createSessionRepository(
  getDb: SessionDatabaseAccessor,
  hooks: SessionMessageRepositoryHooks,
): SessionStorePort {
  function createSession(session: SessionCreateInput): Session {
    const db = getDb();
    const now = new Date().toISOString();
    const s: Session = {
      ...session,
      harness: session.harness ?? 'prokop',
      tags: session.tags ?? [],
      createdAt: session.createdAt || now,
      updatedAt: session.updatedAt || now,
    };

    db.run(`
      INSERT INTO sessions (id, workspace_id, workspace_root_id, harness, preconfig_id, title, status, created_at, updated_at, metadata, selected_model, selected_provider, selected_variant, prompt_tokens, completion_tokens, total_tokens, parent_id, agent_name, subagent_status, running_at, compacting, tags, permission_mode, agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      s.id,
      s.workspaceId,
      s.workspaceRootId ?? null,
      s.harness ?? 'prokop',
      s.preconfigId,
      s.title,
      s.status,
      s.createdAt,
      s.updatedAt,
      s.metadata ? JSON.stringify(s.metadata) : null,
      s.selectedModel ?? null,
      s.selectedProvider ?? null,
      s.selectedVariant ?? null,
      s.parentId ?? null,
      s.agentName ?? null,
      s.subagentStatus ?? null,
      s.runningAt ?? null,
      s.compacting ?? false,
      JSON.stringify(s.tags ?? []),
      s.permissionMode ?? null,
      s.agentId ?? null,
    ]);

    return s;
  }

  function getSession(id: string): Session | null {
    const row = getDb().query('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;
    return mapRowToSession(row);
  }

  function listSessions(status?: SessionStatus): Session[] {
    const db = getDb();
    const query = 'SELECT * FROM sessions ORDER BY updated_at DESC';

    if (status) {
      const rows = db.query('SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC').all(status) as SessionRow[];
      return rows.map(mapRowToSession);
    }

    const rows = db.query(query).all() as SessionRow[];
    return rows.map(mapRowToSession);
  }

  function updateSession(id: string, updates: SessionUpdateInput): Session | null {
    const db = getDb();
    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      values.push(updates.title);
    }
    if (updates.workspaceRootId !== undefined) {
      setClauses.push('workspace_root_id = ?');
      values.push(updates.workspaceRootId);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }
    if (updates.preconfigId !== undefined) {
      setClauses.push('preconfig_id = ?');
      values.push(updates.preconfigId);
    }
    if (updates.selectedModel !== undefined) {
      setClauses.push('selected_model = ?');
      values.push(updates.selectedModel);
    }
    if (updates.selectedProvider !== undefined) {
      setClauses.push('selected_provider = ?');
      values.push(updates.selectedProvider);
    }
    if (updates.selectedVariant !== undefined) {
      setClauses.push('selected_variant = ?');
      values.push(updates.selectedVariant);
    }
    if (updates.promptTokens !== undefined) {
      setClauses.push('prompt_tokens = ?');
      values.push(updates.promptTokens);
    }
    if (updates.completionTokens !== undefined) {
      setClauses.push('completion_tokens = ?');
      values.push(updates.completionTokens);
    }
    if (updates.totalTokens !== undefined) {
      setClauses.push('total_tokens = ?');
      values.push(updates.totalTokens);
    }
    if (updates.cacheReadTokens !== undefined) {
      setClauses.push('cache_read_tokens = ?');
      values.push(updates.cacheReadTokens);
    }
    if (updates.cacheWriteTokens !== undefined) {
      setClauses.push('cache_write_tokens = ?');
      values.push(updates.cacheWriteTokens);
    }
    if (updates.noCacheTokens !== undefined) {
      setClauses.push('no_cache_tokens = ?');
      values.push(updates.noCacheTokens);
    }
    if (updates.parentId !== undefined) {
      setClauses.push('parent_id = ?');
      values.push(updates.parentId);
    }
    if (updates.agentName !== undefined) {
      setClauses.push('agent_name = ?');
      values.push(updates.agentName);
    }
    if (updates.subagentStatus !== undefined) {
      setClauses.push('subagent_status = ?');
      values.push(updates.subagentStatus);
    }
    if (updates.runningAt !== undefined) {
      setClauses.push('running_at = ?');
      values.push(updates.runningAt);
    }
    if (updates.compacting !== undefined) {
      setClauses.push('compacting = ?');
      values.push(updates.compacting ? 1 : 0);
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.permissionMode !== undefined) {
      setClauses.push('permission_mode = ?');
      values.push(updates.permissionMode ?? null);
    }
    if (updates.agentId !== undefined) {
      setClauses.push('agent_id = ?');
      values.push(updates.agentId ?? null);
    }

    values.push(id);

    db.run(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`, values as (string | number)[]);
    // Running state and titles appear in the attention feed.
    if (updates.runningAt !== undefined || updates.title !== undefined) notifyAttentionChanged();
    return getSession(id);
  }

  /**
   * Deletes the session and its whole subsession tree. `parent_id` has no
   * foreign key, so without this every subagent of a deleted session stayed
   * behind: unreachable from any parent, yet still indexed for search.
   */
  function deleteSession(id: string): boolean {
    const db = getDb();
    const sessionIds = (db.query(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM sessions WHERE id = ?
        UNION SELECT s.id FROM sessions s JOIN tree ON s.parent_id = tree.id
      )
      SELECT id FROM tree
    `).all(id) as Array<{ id: string }>).map((row) => row.id);
    if (sessionIds.length === 0) return false;

    db.transaction(() => {
      for (const sessionId of sessionIds) hooks.deleteAttachmentsForSession(sessionId);
      // FK ON DELETE CASCADE removes messages, parts, queued_messages,
      // pending_asks, pinned_messages automatically.
      const placeholders = sessionIds.map(() => '?').join(', ');
      db.run(`DELETE FROM sessions WHERE id IN (${placeholders})`, sessionIds);
    })();

    for (const sessionId of sessionIds) {
      hooks.events.publish({ type: 'session.deleted', sessionId });
      hooks.cleanupSessionOutputDir(sessionId);
    }
    notifyAttentionChanged();

    return true;
  }

  function deleteSessionsByWorkspace(workspaceId: string): void {
    const sessions = listSessionsByWorkspace(workspaceId);
    const db = getDb();

    db.transaction(() => {
      hooks.deleteAttachmentsForWorkspace(workspaceId);
      db.run('DELETE FROM sessions WHERE workspace_id = ?', [workspaceId]);
    })();
    notifyAttentionChanged();

    for (const session of sessions) {
      hooks.events.publish({ type: 'session.deleted', sessionId: session.id });
      hooks.cleanupSessionOutputDir(session.id);
    }
  }

  function listSessionsByWorkspace(
    workspaceId: string,
    options?: SessionListFilter,
  ): Session[] {
    const db = getDb();
    const whereClauses: string[] = ['workspace_id = ?'];
    const values: (string | number)[] = [workspaceId];

    if (options?.status !== undefined) {
      whereClauses.push('status = ?');
      values.push(options.status);
    }
    if (options?.rootOnly === true) {
      whereClauses.push('parent_id IS NULL');
    }
    if (options?.category) whereClauses.push(categoryPredicate(options.category));

    const query = `SELECT * FROM sessions WHERE ${whereClauses.join(' AND ')} ORDER BY updated_at DESC`;
    const rows = db.query(query).all(...values) as SessionRow[];
    return rows.map(mapRowToSession);
  }

  function listSessionsGrouped(
    workspaceIds: string[],
    options?: SessionListFilter,
  ): Record<string, Session[]> {
    const db = getDb();
    const placeholders = workspaceIds.map(() => '?').join(', ');
    const whereClauses: string[] = [`workspace_id IN (${placeholders})`];
    const values: (string | number)[] = [...workspaceIds];

    if (options?.status !== undefined) {
      whereClauses.push('status = ?');
      values.push(options.status);
    }
    if (options?.rootOnly === true) {
      whereClauses.push('parent_id IS NULL');
    }
    if (options?.category) whereClauses.push(categoryPredicate(options.category));

    const query = `SELECT * FROM sessions WHERE ${whereClauses.join(' AND ')} ORDER BY updated_at DESC`;
    const rows = db.query(query).all(...values) as SessionRow[];

    const result: Record<string, Session[]> = {};
    for (const id of workspaceIds) {
      result[id] = [];
    }
    for (const row of rows) {
      const wsId = row.workspace_id || '';
      if (result[wsId]) {
        result[wsId].push(mapRowToSession(row));
      }
    }

    return result;
  }

  function countSessionsByWorkspace(workspaceId: string): SessionCategoryCounts {
    return getDb().query(`SELECT
      COUNT(CASE WHEN ${categoryPredicate('active')} THEN 1 END) AS active,
      COUNT(CASE WHEN ${categoryPredicate('archived')} THEN 1 END) AS archived,
      COUNT(CASE WHEN ${categoryPredicate('scheduled')} THEN 1 END) AS scheduled
      FROM sessions WHERE workspace_id = ?`).get(workspaceId) as SessionCategoryCounts;
  }

  function listTagsByWorkspace(workspaceId: string): string[] {
    const db = getDb();
    const rows = db.query(
      'SELECT DISTINCT tags FROM sessions WHERE workspace_id = ? AND tags != ?',
    ).all(workspaceId, '[]') as { tags: string }[];

    const tagSet = new Set<string>();
    for (const row of rows) {
      try {
        const tags: string[] = JSON.parse(row.tags);
        for (const tag of tags) {
          tagSet.add(tag);
        }
      } catch {
        // Skip malformed
      }
    }
    return Array.from(tagSet).sort();
  }

  function getChildSessions(parentId: string): Session[] {
    const db = getDb();
    const rows = db.query('SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at ASC').all(parentId) as SessionRow[];
    return rows.map(mapRowToSession);
  }

  function getSessionsByAgent(agentId: string, sinceTimestamp?: number, limit?: number): Session[] {
    const db = getDb();
    const sinceIso = sinceTimestamp ? new Date(sinceTimestamp).toISOString() : undefined;
    const conditions = ['agent_id = ?', 'parent_id IS NULL'];
    const params: (string | number)[] = [agentId];
    if (sinceIso) {
      conditions.push('updated_at > ?');
      params.push(sinceIso);
    }
    const sql = `SELECT * FROM sessions WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC${limit ? ` LIMIT ${limit}` : ''}`;
    const rows = db.query(sql).all(...params) as SessionRow[];
    return rows.map(mapRowToSession);
  }

  /**
   * Paginated session query for a single workspace.
   * Uses idx_sessions_workspace_updated or idx_sessions_workspace_status_updated.
   * Fetches limit+1 rows to detect hasMore without a separate COUNT query.
   */
  function listSessionPageByWorkspace(
    workspaceId: string,
    options: ListSessionPageOptions,
  ): SessionPage {
    const db = getDb();
    const limit = clampLimit(options.limit);
    const whereClauses: string[] = ['workspace_id = ?'];
    const values: (string | number)[] = [workspaceId];

    if (options.status !== undefined) {
      whereClauses.push('status = ?');
      values.push(options.status);
    }
    if (options.rootOnly === true) {
      whereClauses.push('parent_id IS NULL');
    }
    if (options.category) whereClauses.push(categoryPredicate(options.category));

    if (options.cursor) {
      whereClauses.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
      values.push(options.cursor.updatedAt, options.cursor.updatedAt, options.cursor.id);
    }

    const query = `SELECT * FROM sessions WHERE ${whereClauses.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`;
    const rows = db.query(query).all(...values, limit + 1) as SessionRow[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const rootSessions = pageRows.map(mapRowToSession);

    // When rootOnly, fetch child sessions of the fetched roots so the client
    // store has complete parent-child relationships without separate requests.
    let sessions = rootSessions;
    if (options.rootOnly === true && rootSessions.length > 0) {
      const rootIds = rootSessions.map((s) => s.id);
      const placeholders = rootIds.map(() => '?').join(', ');
      const childRows = db
        .query(`SELECT * FROM sessions WHERE parent_id IN (${placeholders}) ORDER BY created_at ASC`)
        .all(...rootIds) as SessionRow[];
      const children = childRows.map(mapRowToSession);
      if (children.length > 0) {
        sessions = [...rootSessions, ...children];
      }
    }

    let nextCursor: SessionCursorPayload | null = null;
    if (hasMore && pageRows.length > 0) {
      const lastRow = pageRows[pageRows.length - 1];
      nextCursor = {
        version: 1,
        updatedAt: lastRow.updated_at,
        id: lastRow.id,
      };
    }

    return { sessions, nextCursor, hasMore };
  }

  /**
   * Paginated grouped query: first bounded page for multiple workspaces.
   * Each workspace gets an independent position using a window query.
   */
  function listSessionPageGrouped(
    workspaceIds: string[],
    options: SessionListFilter & { limitPerWorkspace: number },
  ): { sessions: Record<string, Session[]>; pagination: Record<string, SessionPageInfo> } {
    const db = getDb();
    const limitPerWs = clampLimit(options.limitPerWorkspace);

    const sessions: Record<string, Session[]> = {};
    const pagination: Record<string, SessionPageInfo> = {};

    for (const wsId of workspaceIds) {
      sessions[wsId] = [];
    }

    if (workspaceIds.length === 0) {
      return { sessions, pagination };
    }

    const placeholders = workspaceIds.map(() => '?').join(', ');
    const whereClauses: string[] = [`workspace_id IN (${placeholders})`];
    const values: (string | number)[] = [...workspaceIds];

    if (options.status !== undefined) {
      whereClauses.push('status = ?');
      values.push(options.status);
    }
    if (options.rootOnly === true) {
      whereClauses.push('parent_id IS NULL');
    }
    if (options.category) whereClauses.push(categoryPredicate(options.category));

    const query = `
      WITH ranked AS (
        SELECT
          sessions.*,
          ROW_NUMBER() OVER (
            PARTITION BY workspace_id
            ORDER BY updated_at DESC, id DESC
          ) AS page_rank
        FROM sessions
        WHERE ${whereClauses.join(' AND ')}
      )
      SELECT * FROM ranked
      WHERE page_rank <= ?
      ORDER BY workspace_id ASC, updated_at DESC, id DESC`;

    const rows = db.query(query).all(...values, limitPerWs + 1) as (SessionRow & { page_rank: number })[];

    // Group rows by workspace
    const byWorkspace = new Map<string, SessionRow[]>();
    for (const wsId of workspaceIds) {
      byWorkspace.set(wsId, []);
    }
    for (const row of rows) {
      const wsId = row.workspace_id || '';
      const arr = byWorkspace.get(wsId);
      if (arr) arr.push(row);
    }

    for (const wsId of workspaceIds) {
      const wsRows = byWorkspace.get(wsId) ?? [];
      const hasMore = wsRows.length > limitPerWs;
      const pageRows = hasMore ? wsRows.slice(0, limitPerWs) : wsRows;
      const rootSessions = pageRows.map(mapRowToSession);

      // When rootOnly, include children of the fetched roots
      let wsSessions = rootSessions;
      if (options.rootOnly === true && rootSessions.length > 0) {
        const rootIds = rootSessions.map((s) => s.id);
        const placeholders = rootIds.map(() => '?').join(', ');
        const childRows = db
          .query(`SELECT * FROM sessions WHERE parent_id IN (${placeholders}) ORDER BY created_at ASC`)
          .all(...rootIds) as SessionRow[];
        const children = childRows.map(mapRowToSession);
        if (children.length > 0) {
          wsSessions = [...rootSessions, ...children];
        }
      }
      sessions[wsId] = wsSessions;

      let nextCursor: SessionCursorPayload | null = null;
      if (hasMore && pageRows.length > 0) {
        const lastRow = pageRows[pageRows.length - 1];
        nextCursor = {
          version: 1,
          updatedAt: lastRow.updated_at,
          id: lastRow.id,
        };
      }

      pagination[wsId] = {
        nextCursor: nextCursor ? encodeSessionCursor(nextCursor) : null,
        hasMore,
        limit: limitPerWs,
      };
    }

    return { sessions, pagination };
  }

  return {
    createSession,
    getSession,
    listSessions,
    updateSession,
    deleteSession,
    deleteSessionsByWorkspace,
    listSessionsByWorkspace,
    listSessionsGrouped,
    listTagsByWorkspace,
    countSessionsByWorkspace,
    getChildSessions,
    getSessionsByAgent,
    encodeSessionCursor,
    decodeSessionCursor,
    listSessionPageByWorkspace,
    listSessionPageGrouped,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    maxPageSize: MAX_PAGE_SIZE,
    minPageSize: MIN_PAGE_SIZE,
  };
}

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  encodeSessionCursor,
  decodeSessionCursor,
};
