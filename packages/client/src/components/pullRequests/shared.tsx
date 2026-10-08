import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Copy,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react';
import type { ProkopaiClient, PullRequestScope, PullRequestSummary } from '@prokopai/sdk';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface PullRequestContext {
  client: ProkopaiClient;
  serverId: string;
  workspaceId: string;
  scope: PullRequestScope;
  accountId: string;
  provider: 'github' | 'azure';
}
export function prKey(ctx: PullRequestContext): readonly unknown[] {
  return [
    'pull-requests',
    ctx.serverId,
    ctx.workspaceId,
    ctx.scope.repositoryKey,
    ctx.scope.remote,
    ctx.scope.root ?? '',
    ctx.accountId,
  ];
}
export function draftKey(ctx: PullRequestContext, number: number | 'create', field: string): string {
  return JSON.stringify([...prKey(ctx), number, field]);
}
interface Drafts {
  values: Record<string, string>;
  set(key: string, value: string): void;
}
export const usePrDrafts = create<Drafts>()(
  persist(
    (set) => ({
      values: {},
      set: (key, value) =>
        set((state) => {
          const values = { ...state.values };
          if (value) values[key] = value;
          else delete values[key];
          return { values };
        }),
    }),
    { name: 'prokop-pr-drafts', partialize: (state) => ({ values: state.values }) },
  ),
);

export function usePrDraft(key: string): [string, (value: string) => void, () => void] {
  const value = usePrDrafts((state) => state.values[key] ?? '');
  return [
    value,
    (value) => usePrDrafts.getState().set(key, value),
    () => {
      // A submitted draft can finish after navigation or edits in another mounted form.
      const store = usePrDrafts.getState();
      if ((store.values[key] ?? '') === value) store.set(key, '');
    },
  ];
}
export function PrError({ error }: { error: unknown }): ReactNode {
  return error ? (
    <Alert variant="destructive">
      <AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
    </Alert>
  ) : null;
}
export function PrSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
const stateStyles = {
  draft: { icon: GitPullRequestDraft, label: 'Draft', className: 'text-muted-foreground' },
  open: { icon: GitPullRequest, label: 'Open', className: 'text-success' },
  merged: { icon: GitMerge, label: 'Merged', className: 'text-primary' },
  closed: { icon: GitPullRequestClosed, label: 'Closed', className: 'text-destructive' },
};
function stateStyle(pr: Pick<PullRequestSummary, 'state' | 'draft'>) {
  return stateStyles[pr.draft && pr.state === 'open' ? 'draft' : pr.state];
}
export function PrStateIcon({ pr, className }: { pr: Pick<PullRequestSummary, 'state' | 'draft'>; className?: string }) {
  const style = stateStyle(pr);
  const Icon = style.icon;
  return <Icon aria-label={style.label} className={cn('size-4 shrink-0', style.className, className)} />;
}
export function PrStateBadge({ pr }: { pr: Pick<PullRequestSummary, 'state' | 'draft'> }) {
  const style = stateStyle(pr);
  const Icon = style.icon;
  return (
    <Badge variant="outline" className={style.className}>
      <Icon />
      {style.label}
    </Badge>
  );
}

/** Provider check, policy and vote states collapse into four visual outcomes. */
export function statusTone(state: string): 'success' | 'failure' | 'pending' | 'neutral' {
  const value = state.toLowerCase();
  if (/^(success|succeeded|approved|completed|passed)$|^approved with/.test(value)) return 'success';
  if (/fail|error|rejected|broken|cancel|timed_out|action_required|changes_requested/.test(value))
    return 'failure';
  if (/pending|queued|running|in_progress|waiting|expected|requested/.test(value)) return 'pending';
  return 'neutral';
}
const toneIcons = {
  success: { icon: CircleCheck, className: 'text-success' },
  failure: { icon: CircleX, className: 'text-destructive' },
  pending: { icon: CircleDashed, className: 'text-warning' },
  neutral: { icon: CircleMinus, className: 'text-muted-foreground' },
};
export function StatusIcon({ state }: { state: string }) {
  const tone = toneIcons[statusTone(state)];
  const Icon = tone.icon;
  return <Icon aria-hidden className={cn('size-4 shrink-0', tone.className)} />;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function relativeTime(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const seconds = (time - now) / 1000;
  for (const [unit, size] of [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ] as const)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return relative.format(0, 'second');
}

/** Azure paths are repository-absolute ("/src/a.ts"); show them like GitHub's. */
export function displayPath(path: string): string {
  return path.replace(/^\/+/, '');
}

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-1 rounded-md border bg-muted/50 p-2">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-5">{command}</pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Copy command"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => setCopied(true));
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

export function safePrUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
