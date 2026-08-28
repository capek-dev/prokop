import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { memo, useMemo, type ComponentProps } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import type { DiffHunk } from '@/utils/diff';
import { cn } from '@/lib/utils';
import { pathBasename } from '@/lib/platform';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useTheme } from '@/components/providers/ThemeProvider';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';
import { hunksToPatch } from '@/lib/hunksToPatch';
import { useVizExpanded } from '@/lib/vizExpansion';

type PatchDiffOptions = ComponentProps<typeof PatchDiff>['options'];

interface DiffViewerProps {
  hunks: DiffHunk[];
  path: string;
  language?: string;
  additions?: number;
  deletions?: number;
  disablePathOpen?: boolean;
  /** Stable identity (tool-call part id) for persisted expansion state. */
  vizKey?: string;
  matchInfo?: {
    strategy: string;
    lineNumber: number;
  };
}

export const DiffViewer = memo(function DiffViewer({
  hunks,
  path,
  additions,
  deletions,
  disablePathOpen,
  vizKey,
}: DiffViewerProps) {
  const totalDiffLines = useMemo(
    () => hunks.reduce((sum, hunk) => sum + hunk.changes.length, 0),
    [hunks],
  );

  const [expanded, setExpanded] = useVizExpanded(
    vizKey ? `diff:${vizKey}` : `diff:${path}:${totalDiffLines}`,
    true,
  );

  const openFilePreview = useUIStore((s) => s.openFilePreview);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const { resolvedMode } = useTheme();

  const previewHunks = useMemo(() => {
    if (expanded) return hunks;
    let remaining: number = RENDER_BUDGETS.diffPreviewLines;
    const result: DiffHunk[] = [];
    for (const hunk of hunks) {
      if (remaining <= 0) break;
      if (hunk.changes.length <= remaining) {
        result.push(hunk);
        remaining -= hunk.changes.length;
      } else {
        result.push({ ...hunk, changes: hunk.changes.slice(0, remaining) });
        remaining = 0;
      }
    }
    return result;
  }, [hunks, expanded]);

  const patch = useMemo(() => hunksToPatch(previewHunks, path), [previewHunks, path]);

  const options = useMemo<PatchDiffOptions>(
    () => ({
      theme: { dark: 'github-dark', light: 'github-light' },
      themeType: resolvedMode,
      disableFileHeader: true,
      diffStyle: 'unified',
      overflow: 'scroll',
    }),
    [resolvedMode],
  );

  const handlePathClick = () => {
    if (!activeWorkspace) return;
    openFilePreview({
      workspaceId: activeWorkspace.id,
      path,
      name: pathBasename(path),
    });
  };

  return (
    <div className="visualization-container max-w-full border border-border rounded-md">
      <div>
        <div className="group/path flex items-center gap-2 px-1 bg-muted/50 text-xs text-muted-foreground whitespace-nowrap">
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 px-1 py-1 hover:bg-muted rounded"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>

          {/* Path truncates from a nested span: text-overflow does not apply
              to the flex button itself, only to a block/inline child. */}
          {disablePathOpen ? (
            <span
              className="flex items-center gap-1 font-mono min-w-0 flex-1"
              title={path}
            >
              <span className="truncate">{path}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handlePathClick}
              className="flex items-center gap-1 font-mono hover:text-foreground transition-colors cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-muted min-w-0 flex-1 text-left"
              title={path}
            >
              <span className="truncate">{path}</span>
              <ExternalLink className="size-2.5 shrink-0 opacity-0 group-hover/path:opacity-100 transition-opacity" />
            </button>
          )}

          <div className={cn('shrink-0 mr-2 flex items-center gap-2')}>
            {!expanded && totalDiffLines > RENDER_BUDGETS.diffPreviewLines && (
              <span className="text-xs text-muted-foreground/70">
                {totalDiffLines} lines
              </span>
            )}
            {additions !== undefined && deletions !== undefined && (
              <span className="text-muted-foreground">
                +{additions} -{deletions}
              </span>
            )}
          </div>
        </div>

        {expanded && <PatchDiff patch={patch} options={options} className="pierre-viz-host" />}
      </div>
    </div>
  );
});
