import type { ProkopaiClient, SessionHarness } from '@prokopai/sdk';
import { Loader2 } from 'lucide-react';
import { useHarnessesQuery, useSetHarnessEnabled, isHarnessEnabled } from '@/hooks/queries';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { AnthropicMark, OpenAIMark, ProkopMark } from '@/components/branding/BrandMarks';

interface HarnessesPanelProps {
  sdkClient: ProkopaiClient | null;
}

const HARNESS_META: Record<SessionHarness, { name: string; Mark: typeof ProkopMark; external: boolean }> = {
  prokop: { name: 'Prokop', Mark: ProkopMark, external: false },
  'codex-cli': { name: 'Codex CLI', Mark: OpenAIMark, external: true },
  'claude-cli': { name: 'Claude CLI', Mark: AnthropicMark, external: true },
};

export function HarnessesPanel({ sdkClient }: HarnessesPanelProps) {
  const { data, isLoading } = useHarnessesQuery(sdkClient);
  const setEnabled = useSetHarnessEnabled(sdkClient);
  const harnesses = data?.harnesses;

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
        External harnesses run through their own CLI on this host. Disabling one hides it from new
        sessions and scheduled jobs; existing sessions keep running.
      </p>

      <div className="space-y-2">
        {(harnesses ?? []).map((harness) => {
          const meta = HARNESS_META[harness.id];
          if (!meta) return null;
          const enabled = isHarnessEnabled(harness);
          return (
            <div key={harness.id} className="flex items-center gap-3 p-2.5 rounded-lg border">
              <meta.Mark className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{meta.name}</span>
                  {meta.external ? (
                    harness.available ? (
                      harness.version && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">CLI {harness.version}</Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-muted-foreground">Not installed</Badge>
                    )
                  ) : (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-muted-foreground">Built-in</Badge>
                  )}
                </div>
                {!meta.external && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The built-in runtime with providers, tools, and learning.
                  </p>
                )}
                {meta.external && !harness.available && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Install the CLI on this host to use {meta.name} sessions.
                  </p>
                )}
              </div>
              {meta.external && (
                <Switch
                  aria-label={`Enable ${meta.name}`}
                  checked={enabled}
                  disabled={setEnabled.isPending}
                  onCheckedChange={(checked) => setEnabled.mutate({ harness: harness.id, enabled: checked })}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
