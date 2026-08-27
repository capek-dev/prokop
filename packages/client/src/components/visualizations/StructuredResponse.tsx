import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';

const MARKDOWN_RE = /(?:\*\*|__|`|\[[^\]]+\]\(|^#{1,6}\s|^-\s|^\*\s|^\d+\.\s|^>\s|^\|)/m;

function isMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

interface StructuredResponseProps {
  formatName?: string;
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

function ObjectDefList({ data, depth = 1 }: { data: Record<string, unknown>; depth?: number }) {
  const entries = Object.entries(data);
  const maxEntries = RENDER_BUDGETS.structuredMaxObjectEntries;
  const truncated = entries.length > maxEntries;
  const visibleEntries = truncated ? entries.slice(0, maxEntries) : entries;

  return (
    <dl className="space-y-1.5">
      {visibleEntries.map(([key, value]) => (
        <div key={key} className="flex gap-3 items-start">
          <dt className="text-xs font-medium text-muted-foreground shrink-0 w-28 pt-0.5">
            {formatLabel(key)}
          </dt>
          <dd className="flex-1 min-w-0">
            <HumanValue data={value} depth={depth + 1} />
          </dd>
        </div>
      ))}
      {truncated && (
        <TruncatedNotice count={entries.length - maxEntries} kind="entries" />
      )}
    </dl>
  );
}

function HumanValue({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  if (typeof data === 'boolean') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-sm font-medium',
          data ? 'text-success' : 'text-destructive',
        )}
      >
        {data ? '✓ Yes' : '✗ No'}
      </span>
    );
  }

  if (typeof data === 'number') {
    return <span className="text-sm tabular-nums">{data}</span>;
  }

  if (typeof data === 'string') {
    if (isMarkdown(data)) {
      return (
        <div className="text-sm">
          <MarkdownRenderer>{data}</MarkdownRenderer>
        </div>
      );
    }
    if (data.includes('\n')) {
      return (
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{data}</div>
      );
    }
    return <span className="text-sm">{data}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-sm text-muted-foreground italic">Empty</span>;
    }

    if (depth >= RENDER_BUDGETS.structuredMaxDepth) {
      return <RawJsonFallback data={data} />;
    }

    if (data.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
      const maxItems = RENDER_BUDGETS.structuredMaxArrayItems;
      const truncated = data.length > maxItems;
      const visibleData = truncated ? data.slice(0, maxItems) : data;
      return (
        <div className="flex flex-wrap gap-1.5">
          {visibleData.map((item, i) => {
            if (typeof item === 'boolean') {
              return (
                <span key={i} className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                  item
                    ? 'bg-success/15 text-success'
                    : 'bg-destructive/10 text-destructive',
                )}>
                  {item ? 'Yes' : 'No'}
                </span>
              );
            }
            return (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground"
              >
                {String(item)}
              </span>
            );
          })}
          {truncated && (
            <TruncatedNotice count={data.length - maxItems} kind="items" inline />
          )}
        </div>
      );
    }

    const maxItems = RENDER_BUDGETS.structuredMaxArrayItems;
    const truncated = data.length > maxItems;
    const visibleData = truncated ? data.slice(0, maxItems) : data;

    return (
      <div className="space-y-2">
        {visibleData.map((item, i) => (
          <div key={i} className="rounded-md border border-border/60 bg-muted/20 p-2.5">
            <div className="flex gap-2.5">
              <span className="inline-flex items-center justify-center shrink-0 size-5 rounded bg-background text-[10px] font-semibold tabular-nums text-muted-foreground mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                {item !== null && typeof item === 'object' && !Array.isArray(item) ? (
                  <ObjectDefList data={item as Record<string, unknown>} depth={depth + 1} />
                ) : (
                  <HumanValue data={item} depth={depth + 1} />
                )}
              </div>
            </div>
          </div>
        ))}
        {truncated && (
          <TruncatedNotice count={data.length - maxItems} kind="items" />
        )}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-sm text-muted-foreground italic">Empty</span>;
    }

    if (depth >= RENDER_BUDGETS.structuredMaxDepth) {
      return <RawJsonFallback data={data} />;
    }

    if (depth === 0) {
      return (
        <div className="space-y-2.5">
          {entries.map(([key, value]) => (
            <div key={key}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                {formatLabel(key)}
              </div>
              <HumanValue data={value} depth={depth + 1} />
            </div>
          ))}
        </div>
      );
    }

    return <ObjectDefList data={data as Record<string, unknown>} depth={depth} />;
  }

  return <span className="text-sm">{String(data)}</span>;
}

function TruncatedNotice({ count, kind, inline }: { count: number; kind: string; inline?: boolean }) {
  return (
    <span className={cn(
      'text-xs text-muted-foreground italic',
      inline ? 'inline-flex items-center px-2 py-0.5' : 'block py-1',
    )}>
      {count} more {kind} hidden
    </span>
  );
}

function RawJsonFallback({ data }: { data: unknown }) {
  return (
    <div className="text-xs text-muted-foreground flex flex-col gap-1 py-1">
      <div className="flex items-center gap-1">
        <AlertCircle className="size-3" />
        <span>Switched to raw JSON (depth/item limit reached)</span>
      </div>
      <pre className="text-xs font-mono overflow-x-auto max-h-40 block w-full">
        {JSON.stringify(data, null, 2).slice(0, 2000)}
      </pre>
    </div>
  );
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

export const StructuredResponse = memo(function StructuredResponse({
  formatName,
  data,
  schema,
}: StructuredResponseProps) {
  const [showSchema, setShowSchema] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {formatName || 'Response'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {schema && (
            <button
              onClick={() => setShowSchema(!showSchema)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Toggle schema"
            >
              {showSchema ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Copy JSON"
          >
            {copied ? (
              <Check className="size-3.5 text-success" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {showSchema && schema && (
        <div className="px-3 py-2 border-b bg-muted/20">
          <div className="text-xs text-muted-foreground mb-1 font-medium">Schema</div>
          <pre className="text-xs font-mono text-muted-foreground overflow-x-auto">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </div>
      )}

      <div className="p-3">
        <HumanValue data={data} />
      </div>
    </div>
  );
});
