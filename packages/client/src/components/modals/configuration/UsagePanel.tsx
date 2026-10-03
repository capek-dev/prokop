import type { HarnessStatus, HarnessUsageLimits, ProviderAccountSummary, ProviderUsageWindow, UsageProvider, ProkopaiClient } from '@prokopai/sdk';
import { useCodexAccountUsageQuery, useProvidersQuery, useProviderCredentialsQuery, useProviderUsageQuery } from '@/hooks/queries/useProvidersQueries';
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

function UsageWindowRow({ window, now }: { window: ProviderUsageWindow; now: number }) {
  if (window.unlimited) {
    return (
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{window.label}</span>
        <span className="text-muted-foreground">Unlimited</span>
      </div>
    );
  }
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

function UsageRefreshButton({ label, fetching, disabled = false, onRefresh }: {
  label: string;
  fetching: boolean;
  disabled?: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button variant="ghost" size="icon" className="ml-auto size-7 shrink-0 text-muted-foreground"
      aria-label={label} disabled={fetching || disabled} onClick={onRefresh}>
      <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} />
    </Button>
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
          <UsageRefreshButton label={`Refresh ${harness.name} usage`} fetching={isFetching}
            onRefresh={() => void refetch()} />
        )}
      </div>
      {body}
    </div>
  );
}

const USAGE_PROVIDERS: { id: UsageProvider; name: string }[] = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'zhipu-coding', name: 'Z.AI Coding Plan' },
  { id: 'minimax', name: 'MiniMax' },
];

function ProviderUsageCard({ sdkClient, provider }: UsagePanelProps & { provider: (typeof USAGE_PROVIDERS)[number] }) {
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useProviderUsageQuery(sdkClient, provider.id);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{provider.name}</span>
        {data?.plan && <Badge variant="secondary">{data.plan}</Badge>}
        <UsageRefreshButton label={`Refresh ${provider.name} usage`} fetching={isFetching}
          onRefresh={() => void refetch()} />
      </div>
      {isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
        : isError || !data ? <p className="text-xs text-muted-foreground">Could not read usage from the server.</p>
        : data.unavailable ? <p className="text-xs text-muted-foreground">{data.unavailable.message}</p>
        : <div className="flex flex-col gap-2.5">
          {data.balances.map(balance => (
            <div key={balance.currency} className="flex flex-col gap-1 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">Balance</span>
                <span className="tabular-nums">{balance.remaining} {balance.currency} remaining</span>
              </div>
              {(balance.granted != null || balance.toppedUp != null) && (
                <p className="text-muted-foreground">
                  {balance.granted != null && `Granted: ${balance.granted} ${balance.currency}`}
                  {balance.granted != null && balance.toppedUp != null && ' · '}
                  {balance.toppedUp != null && `Topped up: ${balance.toppedUp} ${balance.currency}`}
                </p>
              )}
            </div>
          ))}
          {data.windows.map(window => <UsageWindowRow key={window.id} window={window} now={dataUpdatedAt} />)}
        </div>}
    </div>
  );
}

function CodexAccountUsageCard({ sdkClient, account, active }: UsagePanelProps & { account: ProviderAccountSummary; active: boolean }) {
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useCodexAccountUsageQuery(sdkClient, account);
  return (
    <section aria-label={`Codex · ${account.label}`} className="flex flex-col gap-2.5 rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <OpenAIMark className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={account.label}>Codex · {account.label}</span>
        {active && <Badge variant="outline">Active</Badge>}
        {data?.plan && !account.reauthRequired && <Badge variant="secondary">{data.plan}</Badge>}
        <UsageRefreshButton label={`Refresh Codex ${account.label} usage`} fetching={isFetching}
          disabled={account.reauthRequired} onRefresh={() => void refetch()} />
      </div>
      {account.reauthRequired ? <p className="text-xs text-muted-foreground">Reconnect this Codex account in LLM providers.</p>
        : isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
        : isError || !data ? <p className="text-xs text-muted-foreground">Could not read usage for this Codex account.</p>
        : data.unavailable ? <p className="text-xs text-muted-foreground">{data.unavailable.message}</p>
        : data.windows.map(window => <UsageWindowRow key={window.id} window={window} now={dataUpdatedAt} />)}
    </section>
  );
}

export function UsagePanel({ sdkClient }: UsagePanelProps) {
  const { data, isLoading } = useHarnessesQuery(sdkClient);
  const credentials = useProviderCredentialsQuery(sdkClient);
  const providers = useProvidersQuery(sdkClient);
  const codex = providers.data?.providers.find(provider => provider.provider === 'codex');
  const configuredProviders = USAGE_PROVIDERS.filter(provider =>
    credentials.data?.providers.some(entry => entry.provider === provider.id && entry.configured));

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
        Account balances and limits, including usage outside Prokop.
      </p>
      {credentials.isLoading && <p className="text-xs text-muted-foreground">Loading provider accounts…</p>}
      {credentials.isError && <p className="text-xs text-muted-foreground">Could not load configured provider accounts.</p>}
      {providers.isLoading && <p className="text-xs text-muted-foreground">Loading Codex accounts…</p>}
      {providers.isError && <p className="text-xs text-muted-foreground">Could not load Codex accounts.</p>}
      <div className="flex flex-col gap-2">
        {codex?.accounts?.map(account => <CodexAccountUsageCard key={`${account.id}:${account.connectionId}`} sdkClient={sdkClient}
          account={account} active={codex.activeAccountId === account.id} />)}
        {configuredProviders.map(provider => <ProviderUsageCard key={provider.id} sdkClient={sdkClient} provider={provider} />)}
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
