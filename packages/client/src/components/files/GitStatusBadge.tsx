import type { GitDiffSummary, GitFileStatus } from '@prokopai/sdk';
import { cn } from '@/lib/utils';

interface GitStatusBadgeProps {
  git: GitDiffSummary;
}

const STATUS_LABELS: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  untracked: 'U',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  conflicted: '!',
  ignored: 'I',
};

// Status letters use mode-aware status tokens; diff counts keep their own
// semantic colors so additions/deletions read independently of file state.
const STATUS_CLASSES: Record<GitFileStatus, string> = {
  modified: 'text-warning',
  added: 'text-success',
  untracked: 'text-success/70',
  deleted: 'text-destructive',
  renamed: 'text-primary',
  copied: 'text-primary',
  conflicted: 'text-error font-semibold',
  ignored: 'text-muted-foreground/50',
};

export function GitStatusBadge({ git }: GitStatusBadgeProps) {
  const label = STATUS_LABELS[git.status];
  const className = STATUS_CLASSES[git.status];

  return (
    <span
      className={cn('ml-auto shrink-0 text-[10px] leading-none tabular-nums', className)}
    >
      {label}
      {git.additions !== undefined && git.deletions !== undefined && (
        <span className="ml-1 opacity-70">
          <span className="text-success/80">+{git.additions}</span>{' '}
          <span className="text-destructive/70">−{git.deletions}</span>
        </span>
      )}
    </span>
  );
}
