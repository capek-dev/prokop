import {
  resolveToolSummary,
  resolveToolSummaryTemplate,
  type AnyVisualization,
  type ToolPart,
} from '@prokopai/sdk';

export type ToolRowChipTone = 'neutral' | 'success' | 'error';

export const toolChipToneClass: Record<ToolRowChipTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/15 text-success',
  error: 'bg-destructive/10 text-destructive',
};

export interface ToolRowChip {
  label: string;
  tone: ToolRowChipTone;
}

export interface ToolRowInfo {
  summary: string;
  chips: ToolRowChip[];
}

export interface ToolDisplayCatalogEntry {
  display?: {
    summary?: string;
  };
}

export type ToolDisplayCatalog = Record<string, ToolDisplayCatalogEntry>;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export const resolveSummaryTemplate = resolveToolSummaryTemplate;

/** Structured rows must not expose raw JSON merely because the row was expanded. */
export function showToolRawData(isOpen: boolean, visualization: AnyVisualization | undefined,
  debugExpanded: boolean): boolean {
  return isOpen && (!visualization || debugExpanded);
}

/**
 * Structural chips derived only from typed visualization fields, plus
 * the tool-declared `badge` string. No tool-name knowledge here.
 */
export function chipsFromVisualization(viz: AnyVisualization): ToolRowChip[] {
  const chips: ToolRowChip[] = [];

  switch (viz.type) {
    case 'diff':
    case 'diffs': {
      const { additions, deletions } = getDiffTotals(viz);
      if (additions > 0) chips.push({ label: `+${additions}`, tone: 'success' });
      if (deletions > 0) chips.push({ label: `-${deletions}`, tone: 'error' });
      break;
    }
    case 'shell-output': {
      // Success is the norm and the status icon already shows it.
      const code = viz.exitCode ?? 0;
      if (code !== 0) chips.push({ label: `[${code}]`, tone: 'error' });
      break;
    }
    case 'file-list': {
      const total = viz.total ?? viz.files?.length;
      if (total !== undefined && viz.badge === undefined) {
        const singularLabel = viz.singularLabel ?? 'file';
        const pluralLabel = viz.pluralLabel ?? 'files';
        chips.push({
          label: `${total} ${total === 1 ? singularLabel : pluralLabel}`,
          tone: 'neutral',
        });
      }
      break;
    }
    case 'code': {
      const lines = viz.lineCount ?? viz.content?.split('\n').length;
      if (lines !== undefined && viz.badge === undefined) {
        chips.push({ label: `${lines} ${lines === 1 ? 'line' : 'lines'}`, tone: 'neutral' });
      }
      break;
    }
    case 'markdown': {
      const len = viz.content?.length;
      if (len !== undefined && viz.badge === undefined) {
        chips.push({ label: formatBytes(len), tone: 'neutral' });
      }
      break;
    }
    default:
      break;
  }

  if (viz.badge) {
    chips.push({ label: viz.badge, tone: 'neutral' });
  }

  return chips;
}

/**
 * Row info for a tool call part. Summary comes from the tool-declared
 * `display.summary` template (via the tool catalog) against input args;
 * chips come from the typed visualization in the completed output.
 * Falls back to truncated input JSON for tools without declarations.
 */
export function getToolRowInfo(
  part: ToolPart,
  catalog: ToolDisplayCatalog = {},
): ToolRowInfo {
  const state = part.state;
  const input =
    state && typeof state.input === 'object' && state.input !== null
      ? (state.input as Record<string, unknown>)
      : undefined;

  const summary = part.presentation?.summary ?? (input
    ? resolveToolSummary(input, catalog[part.name]?.display?.summary)
    : '');

  const chips: ToolRowChip[] = [];
  const visualization = getToolPartVisualization(part);
  if (visualization) {
    chips.push(...chipsFromVisualization(visualization));
  }

  return { summary, chips };
}

/** Server presentation first, then the legacy `_visualization` in completed output. */
export function getToolPartVisualization(part: ToolPart): AnyVisualization | undefined {
  if (part.presentation?.visualization) return part.presentation.visualization;
  const state = part.state;
  if (state.status !== 'completed' || !('output' in state)) return undefined;
  const output = state.output;
  if (!output || typeof output !== 'object' || !('_visualization' in output)) return undefined;
  return output._visualization && typeof output._visualization === 'object'
    ? output._visualization as AnyVisualization
    : undefined;
}

export interface DiffTotals {
  additions: number;
  deletions: number;
}

export function getDiffTotals(visualization: AnyVisualization | undefined): DiffTotals {
  if (visualization?.type === 'diff') {
    return { additions: visualization.additions ?? 0, deletions: visualization.deletions ?? 0 };
  }
  if (visualization?.type === 'diffs') {
    return visualization.items.reduce<DiffTotals>((totals, item) => ({
      additions: totals.additions + (item.additions ?? 0),
      deletions: totals.deletions + (item.deletions ?? 0),
    }), { additions: 0, deletions: 0 });
  }
  return { additions: 0, deletions: 0 };
}
