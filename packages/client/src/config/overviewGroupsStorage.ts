import type { QuickConnection } from '@prokopai/sdk';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import type { OverviewGroup, OverviewGroupsDocument } from './overviewGroupsTypes';

const TAG = '[overviewGroups]';

const EMPTY_DOC: OverviewGroupsDocument = {
  version: 1,
  groups: [],
  activeGroupIdByServer: {},
};

export type HydrationResult =
  | { status: 'ready'; document: OverviewGroupsDocument; migrated: boolean }
  | { status: 'unsupported'; document: null };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeGroup(raw: unknown): OverviewGroup | null {
  if (!isPlainObject(raw)) return null;
  if (!isNonEmptyString(raw.id)) return null;
  if (!isNonEmptyString(raw.serverId)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!isNonEmptyString(name)) return null;
  if (!isStringArray(raw.workspaceIds)) return null;
  return { id: raw.id, serverId: raw.serverId, name, workspaceIds: raw.workspaceIds };
}

/**
 * Normalize a full document: deduplicate group IDs, names (per server),
 * and workspace IDs. Repair active-group references.
 */
function normalizeDocument(
  groups: OverviewGroup[],
  activeMap: Record<string, string>,
): OverviewGroupsDocument {
  const seenIds = new Set<string>();
  const result: OverviewGroup[] = [];

  for (const group of groups) {
    if (seenIds.has(group.id)) continue;
    seenIds.add(group.id);

    // Deduplicate workspace IDs preserving first occurrence
    const seenWs = new Set<string>();
    const dedupWs: string[] = [];
    for (const wsId of group.workspaceIds) {
      if (!seenWs.has(wsId)) {
        seenWs.add(wsId);
        dedupWs.push(wsId);
      }
    }
    group.workspaceIds = dedupWs;
    result.push(group);
  }

  // Deduplicate case-insensitive names per server, keeping the first valid record
  const byServer = new Map<string, OverviewGroup[]>();
  for (const g of result) {
    const arr = byServer.get(g.serverId) ?? [];
    arr.push(g);
    byServer.set(g.serverId, arr);
  }
  const deduped: OverviewGroup[] = [];
  for (const arr of byServer.values()) {
    const seenNames = new Set<string>();
    for (const g of arr) {
      const lower = g.name.toLowerCase();
      if (seenNames.has(lower)) continue;
      seenNames.add(lower);
      deduped.push(g);
    }
  }

  // Repair active-group references after all deduplication is complete
  const dedupedByServer = new Map<string, OverviewGroup[]>();
  for (const group of deduped) {
    const serverGroups = dedupedByServer.get(group.serverId) ?? [];
    serverGroups.push(group);
    dedupedByServer.set(group.serverId, serverGroups);
  }

  const newActiveMap: Record<string, string> = {};
  for (const [serverId, groupArr] of dedupedByServer.entries()) {
    const ref = activeMap[serverId];
    const first = groupArr[0];
    if (ref && groupArr.some((g) => g.id === ref)) {
      newActiveMap[serverId] = ref;
    } else if (first) {
      newActiveMap[serverId] = first.id;
    }
  }

  return { version: 1, groups: deduped, activeGroupIdByServer: newActiveMap };
}

/**
 * Parse and validate raw storage into a typed document.
 * Returns null when the document is unsupported (future version).
 */
function parseRaw(raw: unknown): HydrationResult {
  if (!isPlainObject(raw)) {
    return { status: 'ready', document: { ...EMPTY_DOC, groups: [], activeGroupIdByServer: {} }, migrated: false };
  }

  if (raw.version !== 1) {
    console.error(`${TAG} Unsupported document version: ${String(raw.version)}. Mutations are disabled.`);
    return { status: 'unsupported', document: null };
  }

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groups = rawGroups
    .map(normalizeGroup)
    .filter((g): g is OverviewGroup => g !== null);

  const rawActive = isPlainObject(raw.activeGroupIdByServer) ? raw.activeGroupIdByServer : {};
  const activeMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawActive)) {
    if (isNonEmptyString(v)) activeMap[k] = v;
  }

  const document = normalizeDocument(groups, activeMap);
  return { status: 'ready', document, migrated: false };
}

/**
 * Build a migration document from existing quick connections.
 * Creates one "Favorites" group per represented server, preserving array order.
 */
function migrateFromQuickConnections(
  quickConnections: QuickConnection[],
): OverviewGroupsDocument {
  const serverOrder: string[] = [];
  const byServer = new Map<string, string[]>();

  for (const conn of quickConnections) {
    if (!conn.workspaceId) continue;
    const list = byServer.get(conn.serverId);
    if (list) {
      list.push(conn.workspaceId);
    } else {
      byServer.set(conn.serverId, [conn.workspaceId]);
      serverOrder.push(conn.serverId);
    }
  }

  const groups: OverviewGroup[] = [];
  const activeMap: Record<string, string> = {};
  for (const serverId of serverOrder) {
    const ids = byServer.get(serverId)!;
    // Deduplicate preserving first occurrence
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(id);
      }
    }
    const groupId = crypto.randomUUID();
    groups.push({ id: groupId, serverId, name: 'Favorites', workspaceIds: deduped });
    activeMap[serverId] = groupId;
  }

  return { version: 1, groups, activeGroupIdByServer: activeMap };
}

// --- Promise-queued writes -----------------------------------------------

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Serialize writes so rapid mutations persist in order.
 */
export function persistDocument(document: OverviewGroupsDocument): Promise<void> {
  const run = writeQueue.then(() =>
    storage.set(STORAGE_KEYS.OVERVIEW_GROUPS, document).catch((err: unknown) => {
      console.error(`${TAG} Failed to persist overview groups document:`, err);
    }),
  );
  // Swallow rejection so the queue never breaks; errors are logged above.
  writeQueue = run.catch(() => {});
  return run;
}

/**
 * Load and validate the overview groups document.
 * Runs migration only when storage is missing.
 */
export async function loadOverviewGroups(
  quickConnections: QuickConnection[],
): Promise<HydrationResult> {
  let entry: { exists: boolean; value: unknown | null };
  try {
    entry = await storage.getEntry<unknown>(STORAGE_KEYS.OVERVIEW_GROUPS);
  } catch (err: unknown) {
    console.error(`${TAG} Failed to read overview groups from storage:`, err);
    return { status: 'ready', document: { ...EMPTY_DOC }, migrated: false };
  }

  if (!entry.exists) {
    const migrated = migrateFromQuickConnections(quickConnections);
    await persistDocument(migrated);
    return { status: 'ready', document: migrated, migrated: true };
  }

  return parseRaw(entry.value);
}
