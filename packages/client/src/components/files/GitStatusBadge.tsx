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

const STATUS_CLASSES: Record<GitFileStatus, string> = {
  modified: 'text-yellow-500',
  added: 'text-green-500',
  untracked: 'text-green-500/70',
  deleted: 'text-red-500',
  renamed: 'text-blue-500',
  copied: 'text-blue-500',
  conflicted: 'text-red-600 font-semibold',
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
          +{git.additions} -{git.deletions}
        </span>
      )}
    </span>
  );
}
