/**
 * Builds the client's stored workspace layout (`prokopai_workspace_views`,
 * version 5, see packages/client/src/stores/workspaceViewStore.ts).
 *
 * Session panes are given as columns of stacked sessions. A session pane only
 * renders when that session is also open on the board, which the route's
 * `open` search param carries (see openWorkspace in scene.ts).
 */
export type RightView = 'explorer' | 'changes' | 'branches' | 'worktrees';

type Tree =
  | { kind: 'group'; groupId: string }
  | { kind: 'split'; id: string; direction: 'right' | 'down'; ratio: number; first: Tree; second: Tree };

function sessionView(serverId: string, sessionId: string): string {
  return `session:${encodeURIComponent(serverId)}:${encodeURIComponent(sessionId)}`;
}

/** Splits `nodes` evenly along `direction`, as a right-leaning chain. */
function chain(nodes: Tree[], direction: 'right' | 'down', idPrefix: string): Tree {
  if (nodes.length === 1) return nodes[0]!;
  return {
    kind: 'split',
    id: `split-${idPrefix}-${nodes.length}`,
    direction,
    ratio: 1 / nodes.length,
    first: nodes[0]!,
    second: chain(nodes.slice(1), direction, idPrefix),
  };
}

export function workspaceLayout(serverId: string, columns: string[][], rightActive: RightView = 'explorer') {
  const groups: Record<string, { viewIds: string[]; activeId: string | null }> = {
    left: { viewIds: ['sessions', 'usage'], activeId: 'sessions' },
    right: { viewIds: ['explorer', 'changes', 'branches', 'worktrees'], activeId: rightActive },
    bottom: { viewIds: ['terminals'], activeId: 'terminals' },
  };

  const columnTrees = columns.map((column, columnIndex) => chain(column.map((sessionId, rowIndex) => {
    const groupId = columnIndex === 0 && rowIndex === 0 ? 'center' : `group-c${columnIndex}r${rowIndex}`;
    const view = sessionView(serverId, sessionId);
    // The first center group keeps the built-in conversation and editor views.
    groups[groupId] = { viewIds: groupId === 'center' ? ['conversations', 'editor', view] : [view], activeId: view };
    return { kind: 'group', groupId } as Tree;
  }), 'down', `col${columnIndex}`));

  return {
    version: 5,
    groups,
    roots: {
      left: { kind: 'group', groupId: 'left' },
      center: chain(columnTrees, 'right', 'cols'),
      right: { kind: 'group', groupId: 'right' },
      bottom: { kind: 'group', groupId: 'bottom' },
    },
    hidden: [],
  };
}
