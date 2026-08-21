import type { ProkopaiClient, ToolDefinition } from '@prokopai/sdk';
import { Check, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToolsQuery, useToolEnvVarsQuery } from '@/hooks/queries';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
}

export function ToolsPanel({ sdkClient }: PanelProps) {
  const { data: toolsData, isLoading: toolsLoading, error: toolsError } = useToolsQuery(sdkClient);
  const { data: envData, isLoading: envLoading } = useToolEnvVarsQuery(sdkClient);

  const tools: ToolDefinition[] = toolsData?.tools ?? [];
  const loading = toolsLoading || envLoading;
  const error = toolsError?.message ?? null;

  const getToolEnvStatus = (tool: ToolDefinition) => {
    const requiredEnvs = tool.env || [];
    if (requiredEnvs.length === 0) return { total: 0, missing: 0 };
    const missing = requiredEnvs.filter((key) => {
      const env = envData?.envVars?.find((e) => e.key === key);
      return !env || !env.configured;
    });
    return { total: requiredEnvs.length, missing: missing.length };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && tools.length === 0) {
    return (
      <div className="p-4 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-4">
      {error && (
        <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
      )}

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {tools.length} tool{tools.length !== 1 ? 's' : ''} loaded. Configure their environment variables in the{' '}
          <span className="font-medium text-foreground">Environment</span> tab.
        </p>
      </div>

      <div className="space-y-1">
        {tools.map((tool) => {
          const envStatus = getToolEnvStatus(tool);
          return (
            <div
              key={tool.name}
              className="flex items-start justify-between gap-2 p-2.5 rounded-lg border"
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium break-words">{tool.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words">
                  {tool.description}
                </p>
              </div>
              <div className="shrink-0">
                {envStatus.total === 0 ? (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Check className="size-3" />
                    <span className="hidden sm:inline">Ready</span>
                  </Badge>
                ) : envStatus.missing > 0 ? (
                  <Badge variant="outline" className="text-xs gap-1 text-orange-500 border-orange-300">
                    <ShieldAlert className="size-3" />
                    <span>{envStatus.missing}</span>
                    <span className="hidden sm:inline">env missing</span>
                  </Badge>
                ) : (
                  <Badge variant="default" className="text-xs gap-1">
                    <ShieldCheck className="size-3" />
                    <span className="hidden sm:inline">Configured</span>
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
