import type { Agent, Workspace } from '@prokopai/sdk';
import { getWorkspaceDisplayName } from './workspaceKind';

export const WORKSPACE_ORDER_KEY = 'prokopai_workspace_order';
export const WORKSPACE_ORDERS = [
  { value: 'name-asc', label: 'Name: A to Z' },
  { value: 'name-desc', label: 'Name: Z to A' },
  { value: 'newest', label: 'Newest added' },
  { value: 'oldest', label: 'Oldest added' },
  { value: 'active', label: 'Recently active' },
] as const;
export type WorkspaceOrder = typeof WORKSPACE_ORDERS[number]['value'];

export function isWorkspaceOrder(value: unknown): value is WorkspaceOrder {
  return WORKSPACE_ORDERS.some(option => option.value === value);
}

export function loadWorkspaceOrder(): WorkspaceOrder {
  try {
    const value = localStorage.getItem(WORKSPACE_ORDER_KEY);
    return isWorkspaceOrder(value) ? value : 'newest';
  } catch {
    return 'newest';
  }
}

export function sortWorkspaces(workspaces: Workspace[], agents: Agent[], order: WorkspaceOrder): Workspace[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const created = (workspace: Workspace) => Date.parse(workspace.createdAt) || 0;
  return [...workspaces].sort((a, b) => {
    const name = collator.compare(getWorkspaceDisplayName(a, agents), getWorkspaceDisplayName(b, agents));
    const fallback = created(b) - created(a) || name || a.id.localeCompare(b.id);
    switch (order) {
      case 'name-asc': return name || fallback;
      case 'name-desc': return -name || fallback;
      case 'oldest': return created(a) - created(b) || fallback;
      case 'active': return (b.lastConversationAt ?? -1) - (a.lastConversationAt ?? -1) || fallback;
      default: return fallback;
    }
  });
}
