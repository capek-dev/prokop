import type { ReactElement } from 'react';
import { FileText, FolderTree, Gauge, GitBranch, GitCompareArrows, GitFork, GitPullRequest, List, MessageSquare, Terminal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WorkspaceToolViewId, WorkspaceViewId } from '@/stores/workspaceViewStore';

const VIEW_ICONS: Record<WorkspaceToolViewId, LucideIcon> = {
  usage: Gauge,
  sessions: List,
  conversations: MessageSquare,
  explorer: FolderTree,
  changes: GitCompareArrows,
  branches: GitBranch,
  worktrees: GitFork,
  editor: FileText,
  terminals: Terminal,
};

export function WorkspaceTabIcon({ id }: { id: WorkspaceViewId }): ReactElement {
  const Icon = id.startsWith('session:') ? MessageSquare
    : id.startsWith('file:') ? FileText : id.startsWith('prs:') ? GitPullRequest : VIEW_ICONS[id as WorkspaceToolViewId];
  return <Icon aria-hidden="true" className="size-3.5 shrink-0" />;
}
