import { useState } from 'react';
import type { CodexContextUsage, CodexTokenBreakdown } from '@prokopai/sdk';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TokenMeterProps {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheTokens?: number;
  contextWindow?: number;
  modelName?: string;
  compact?: boolean;
  /** Codex reports the latest response separately from cumulative thread usage. */
  codexUsage?: unknown;
  codex?: boolean;
}

const CODEX_FIELDS = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens',
  'outputTokens', 'reasoningOutputTokens'] as const;

function validBreakdown(value: unknown): value is CodexTokenBreakdown {
  return !!value && typeof value === 'object' && CODEX_FIELDS.every(field => {
    const count = (value as Record<string, unknown>)[field];
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  });
}

function validCodexUsage(value: unknown): value is CodexContextUsage {
  if (!value || typeof value !== 'object') return false;
  const usage = value as Record<string, unknown>;
  return validBreakdown(usage.last) && validBreakdown(usage.total)
    && (usage.modelContextWindow === null || typeof usage.modelContextWindow === 'number'
      && Number.isSafeInteger(usage.modelContextWindow) && usage.modelContextWindow > 0);
}

function formatCompact(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function getUsageStatus(percentage: number): 'normal' | 'warning' | 'critical' {
  if (percentage >= 60) return 'critical';
  if (percentage >= 40) return 'warning';
  return 'normal';
}

export function TokenMeter({
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  noCacheTokens = 0,
  contextWindow = 0,
  modelName,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  compact,
  codex = false,
  codexUsage,
}: TokenMeterProps) {
  const [showTokens, setShowTokens] = useState(false);
  const reported = codex && validCodexUsage(codexUsage) ? codexUsage : null;
  const used = codex ? reported?.last.totalTokens ?? 0 : totalTokens;
  const effectiveContext = codex ? reported?.modelContextWindow ?? 0 : totalTokens === 0 ? 0 : contextWindow;
  const percentage = effectiveContext === 0
    ? 0
    : Math.min(100, Math.round((used / effectiveContext) * 100));

  const status = getUsageStatus(percentage);

  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percentage / 100);

  const ringColorClass = percentage === 0
    ? 'text-muted-foreground/30'
    : status === 'critical'
      ? 'text-destructive'
      : status === 'warning'
        ? 'text-warning'
        : 'text-primary';

  const usageRows: Array<[string, number | string]> = codex
    ? reported ? [
      ['Latest input', reported.last.inputTokens],
      ['Latest output', reported.last.outputTokens],
      ['Latest cached input', reported.last.cachedInputTokens],
      ['Latest reasoning output', reported.last.reasoningOutputTokens],
      ['Latest total', reported.last.totalTokens],
      ['Thread total', reported.total.totalTokens],
      ['Context window', reported.modelContextWindow ?? 'Not reported'],
    ] : [['Context usage', 'Not reported']]
    : [
      ['Prompt tokens', promptTokens],
      ['Completion tokens', completionTokens],
      ['Total tokens', totalTokens],
      ['Cache read', cacheReadTokens],
      ['Cache write', cacheWriteTokens],
      ['Not cached', noCacheTokens],
      ['Context window', contextWindow],
    ];

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 cursor-pointer select-none"
            onClick={() => setShowTokens((current) => !current)}
            aria-label={codex && !effectiveContext ? 'Codex context usage: unknown'
              : `Token usage: ${percentage}% of context window`}
          >
            <svg
              viewBox="0 0 20 20"
              className="size-5"
              fill="none"
            >
              <circle
                cx="10"
                cy="10"
                r={radius}
                stroke="currentColor"
                className="text-muted-foreground/20"
                strokeWidth="3"
              />
              <circle
                cx="10"
                cy="10"
                r={radius}
                stroke="currentColor"
                className={ringColorClass}
                strokeWidth="3"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 10 10)"
                style={{ transition: 'stroke-dashoffset 0.3s ease' }}
              />
            </svg>
            <span className="text-xs font-mono text-muted-foreground">
              {codex && !effectiveContext ? (reported ? `${formatCompact(used)}/?` : '—')
                : showTokens ? `${formatCompact(used)}/${formatCompact(effectiveContext)}` : `${percentage}%`}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="flex-col items-stretch gap-1.5">
          {modelName && <p className="font-medium">{modelName}</p>}
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 font-mono tabular-nums">
            {usageRows.map(([label, value]) => (
              <div key={label} className="contents">
                <span>{label}</span>
                <span className="text-right">{typeof value === 'number' ? value.toLocaleString() : value}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}