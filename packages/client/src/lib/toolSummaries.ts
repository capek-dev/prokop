import {
  resolveToolSummary,
  resolveToolSummaryTemplate,
  type AnyVisualization,
  type ToolPart,
} from '@prokopai/sdk';

export type ToolRowChipTone = 'neutral' | 'success' | 'error';

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

/**
 * Structural chips derived only from typed visualization fields, plus
 * the tool-declared `badge` string. No tool-name knowledge here.
 */
export function chipsFromVisualization(viz: AnyVisualization): ToolRowChip[] {
  const chips: ToolRowChip[] = [];

  switch (viz.type) {
    case 'diff': {
      const a = viz.additions ?? 0;
      const d = viz.deletions ?? 0;
      if (a > 0) chips.push({ label: `+${a}`, tone: 'success' });
      if (d > 0) chips.push({ label: `-${d}`, tone: 'error' });
      break;
    }
    case 'diffs': {
      let a = 0;
      let d = 0;
      for (const item of viz.items) {
        a += item.additions ?? 0;
        d += item.deletions ?? 0;
      }
      if (a > 0) chips.push({ label: `+${a}`, tone: 'success' });
      if (d > 0) chips.push({ label: `-${d}`, tone: 'error' });
      break;
    }
    case 'shell-output': {
      const code = viz.exitCode ?? 0;
      chips.push(
        code === 0
          ? { label: '[0]', tone: 'neutral' }
          : { label: `[${code}]`, tone: 'error' },
      );
      break;
    }
    case 'file-list': {
      const total = viz.total ?? viz.files?.length;
      if (total !== undefined && viz.badge === undefined) {
        chips.push({ label: `${total} ${total === 1 ? 'file' : 'files'}`, tone: 'neutral' });
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
  let visualization = part.presentation?.visualization;
  if (!visualization && state.status === 'completed' && 'output' in state) {
    const output = state.output;
    if (output && typeof output === 'object') {
      visualization =
        '_visualization' in output &&
        output._visualization &&
        typeof output._visualization === 'object'
          ? (output._visualization as AnyVisualization)
          : undefined;
    }
  }
  if (visualization) {
    chips.push(...chipsFromVisualization(visualization));
  }

  return { summary, chips };
}
