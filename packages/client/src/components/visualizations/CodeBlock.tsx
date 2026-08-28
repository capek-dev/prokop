import { type FC, memo, useState, useMemo, useCallback, type ComponentProps } from 'react';
import { Check, AlertCircle, ChevronDown, ChevronRight, ExternalLink, Copy } from 'lucide-react';
import { File as PierreFile } from '@pierre/diffs/react';
import type { SelectedLineRange } from '@pierre/diffs/react';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useTheme } from '@/components/providers/ThemeProvider';
import { pathBasename } from '@/lib/platform';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';
import { resolvePierreLang } from '@/lib/pierreDiffsTheme';
import { useVizExpanded } from '@/lib/vizExpansion';

type PierreFileOptions = ComponentProps<typeof PierreFile>['options'];

interface CodeBlockProps {
  content: string;
  path: string;
  language?: string;
  created?: boolean;
  highlightLines?: number[];
  showOverwriteIndicator?: boolean;
  /** Stable identity (tool-call part id) for persisted expansion state. */
  vizKey?: string;
}

export const CodeBlock: FC<CodeBlockProps> = memo(({
  content,
  path,
  language,
  created,
  highlightLines = [],
  vizKey,
}) => {
  const [expanded, setExpanded] = useVizExpanded(
    vizKey ? `code:${vizKey}` : `code:${path}:${content.length}`,
    true,
  );
  const [copied, setCopied] = useState(false);
  const openFilePreview = useUIStore((s) => s.openFilePreview);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const { resolvedMode } = useTheme();

  const handlePathClick = () => {
    if (!activeWorkspace) return;
    openFilePreview({
      workspaceId: activeWorkspace.id,
      path,
      name: pathBasename(path),
    });
  };

  const lineCount = useMemo(() => content.split('\n').length, [content]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const previewContent = useMemo(() => {
    if (expanded) return content;
    const lines = content.split('\n', RENDER_BUDGETS.codePreviewLines);
    return lines.join('\n');
  }, [content, expanded]);

  const name = pathBasename(path);
  const lang = useMemo(() => resolvePierreLang(name, language), [name, language]);

  const file = useMemo(
    () => ({ name, contents: previewContent, lang }),
    [name, previewContent, lang],
  );

  const options = useMemo<PierreFileOptions>(
    () => ({
      theme: { dark: 'github-dark', light: 'github-light' },
      themeType: resolvedMode,
      disableFileHeader: true,
      overflow: 'scroll',
    }),
    [resolvedMode],
  );

  // Write-tool highlight tint. highlightLines is 1-based; Pierre's selection
  // is a single { start, end } range, so contiguous line sets (the common
  // case for a written block) map exactly and sparse sets tint the gap.
  // Clamped to the preview length so collapsed mode never selects past the
  // rendered slice.
  const selectedLines = useMemo<SelectedLineRange | null>(() => {
    if (highlightLines.length === 0) return null;
    const previewLineCount = previewContent.split('\n').length;
    const start = Math.min(Math.max(1, Math.min(...highlightLines)), previewLineCount);
    const end = Math.min(Math.max(1, Math.max(...highlightLines)), previewLineCount);
    return { start, end };
  }, [highlightLines, previewContent]);

  return (
    <div className="visualization-container max-w-full border border-border rounded-md">
      <div>
        <div className="group/path flex items-center gap-2 px-1 bg-muted/50 text-xs text-muted-foreground whitespace-nowrap">
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 flex items-center gap-2 px-2 py-1 hover:bg-muted"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>

          {/* Path truncates from a nested span: text-overflow does not apply
              to the flex button itself, only to a block/inline child. */}
          <button
            type="button"
            onClick={handlePathClick}
            className="flex items-center gap-1 font-mono hover:text-foreground transition-colors cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-muted min-w-0 flex-1 text-left"
            title={path}
          >
            <span className="truncate">{path}</span>
            <ExternalLink className="size-2.5 shrink-0 opacity-0 group-hover/path:opacity-100 transition-opacity" />
          </button>

          {!expanded && (
            <span className="shrink-0 text-xs text-muted-foreground/70">
              {lineCount} lines
            </span>
          )}
          <div className="shrink-0 ml-auto mr-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Copy code"
            >
              {copied ? (
                <Check className="size-3 text-success" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
            {created === false ? (
              <span className="flex items-center gap-1 text-warning">
                <AlertCircle className="size-3" />
                Overwrote
              </span>
            ) : (
              <span className="flex items-center gap-1 text-success">
                <Check className="size-3" />
                Created
              </span>
            )}
          </div>
        </div>

        <PierreFile
          file={file}
          options={options}
          selectedLines={selectedLines}
          className="pierre-viz-host"
        />
      </div>
    </div>
  );
});
