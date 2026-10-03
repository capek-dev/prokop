import type { HarnessStatus, HarnessUsageLimits, HarnessUsageWindow, ProkopaiClient } from '@prokopai/sdk';
import { Loader2, RefreshCw } from 'lucide-react';
import { useHarnessesQuery, useHarnessUsageQuery, isHarnessEnabled } from '@/hooks/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AnthropicMark, OpenAIMark } from '@/components/branding/BrandMarks';
import { cn } from '@/lib/utils';

interface UsagePanelProps {
  sdkClient: ProkopaiClient | null;
}

type UsageHarness = HarnessUsageLimits['harness'];

const USAGE_HARNESSES: { id: UsageHarness; name: string; Mark: typeof OpenAIMark }[] = [
  { id: 'claude-cli', name: 'Claude CLI', Mark: AnthropicMark },
  { id: 'codex-cli', name: 'Codex CLI', Mark: OpenAIMark },
];

/** Coarse remaining time: `5d 4h`, `3h 20m`, `12m`. */
export function formatResetIn(resetsAt: string, now: number): string {
  const totalMinutes = Math.max(0, Math.ceil((Date.parse(resetsAt) - now) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
  if (hours === 0) return `${totalMinutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function UsageWindowRow({ window, now }: { window: HarnessUsageWindow; now: number }) {
  const used = Math.round(window.usedPercent);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{window.label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used}% used
          {window.resetsAt && (
            <span title={new Date(window.resetsAt).toLocaleString()}> · resets in {formatResetIn(window.resetsAt, now)}</span>
          )}
        </span>
      </div>
      <Progress
        value={used}
        aria-label={`${window.label} usage`}
        className={cn(used >= 90 && '[&_[data-slot=progress-indicator]]:bg-destructive')}
      />
    </div>
  );
}

function HarnessUsageCard({ sdkClient, harness, status }: {
  sdkClient: ProkopaiClient | null;
  harness: (typeof USAGE_HARNESSES)[number];
  status: HarnessStatus | undefined;
}) {
  const ready = !!status?.available && isHarnessEnabled(status);
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useHarnessUsageQuery(sdkClient, harness.id, ready);

  let body;
  if (!status?.available) {
    body = <p className="text-xs text-muted-foreground">Install the CLI on this host to see its usage.</p>;
  } else if (!ready) {
    body = <p className="text-xs text-muted-foreground">Enable {harness.name} in Harnesses to see its usage.</p>;
  } else if (isLoading) {
    body = <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  } else if (isError || !data) {
    body = <p className="text-xs text-muted-foreground">Could not read usage from the server.</p>;
  } else if (data.unavailable) {
    body = <p className="text-xs text-muted-foreground">{data.unavailable.message ?? 'Usage is unavailable.'}</p>;
  } else {
    body = (
      <div className="space-y-2.5">
        {data.windows.map((window) => <UsageWindowRow key={window.id} window={window} now={dataUpdatedAt} />)}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 p-2.5 rounded-lg border">
      <div className="flex items-center gap-2">
        <harness.Mark className="size-5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{harness.name}</span>
        {data?.plan && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 capitalize">{data.plan}</Badge>
        )}
        {ready && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7 text-muted-foreground"
            aria-label={`Refresh ${harness.name} usage`}
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
          </Button>
        )}
      </div>
      {body}
    </div>
  );
}

export function UsagePanel({ sdkClient }: UsagePanelProps) {
  const { data, isLoading } = useHarnessesQuery(sdkClient);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Plan limits as reported by each CLI's own login on this host. Prokop sessions are not
        covered yet.
      </p>
      <div className="space-y-2">
        {USAGE_HARNESSES.map((harness) => (
          <HarnessUsageCard
            key={harness.id}
            sdkClient={sdkClient}
            harness={harness}
            status={data?.harnesses.find((entry) => entry.id === harness.id)}
          />
        ))}
      </div>
    </div>
  );
}
