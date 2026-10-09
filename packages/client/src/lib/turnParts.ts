import type { Part, ToolPart } from '@prokopai/sdk';
import { getDiffTotals, getToolPartVisualization } from './toolSummaries';

export interface IndexedPart {
  part: Part;
  index: number;
}

export type TurnSegment =
  | { kind: 'part'; part: Part; index: number }
  | { kind: 'tools'; id: string; items: IndexedPart[] };

/** Fewer tools than this stay as plain rows; a fold would only add a click. */
export const MIN_GROUPED_TOOLS = 2;

function isWorkPart(part: Part): boolean {
  return part.type === 'tool' || part.type === 'reasoning' || part.type === 'step';
}

/**
 * Folds runs of agent work (tool calls plus the reasoning and step markers
 * between them) into one segment. Text, images and files end a run, so the
 * answer always stays outside the fold.
 */
export function groupTurnParts(parts: readonly Part[]): TurnSegment[] {
  const segments: TurnSegment[] = [];
  let run: IndexedPart[] = [];

  const flush = () => {
    const tools = run.filter(item => item.part.type === 'tool').length;
    if (tools >= MIN_GROUPED_TOOLS) {
      segments.push({ kind: 'tools', id: run[0].part.id, items: run });
    } else {
      for (const item of run) segments.push({ kind: 'part', ...item });
    }
    run = [];
  };

  parts.forEach((part, index) => {
    if (isWorkPart(part)) {
      run.push({ part, index });
      return;
    }
    flush();
    segments.push({ kind: 'part', part, index });
  });
  flush();
  return segments;
}

export interface ToolGroupStats {
  toolCount: number;
  failedCount: number;
  active: boolean;
  /** Tool names in first-use order with call counts. */
  names: Array<{ name: string; count: number }>;
  additions: number;
  deletions: number;
  /** First start to last finish; undefined while a tool still runs. */
  durationMs?: number;
}

export function getToolGroupStats(parts: readonly Part[]): ToolGroupStats {
  const tools = parts.filter((part): part is ToolPart => part.type === 'tool');
  const counts = new Map<string, number>();
  let failedCount = 0;
  let active = false;
  let additions = 0;
  let deletions = 0;
  let start = Infinity;
  let end = -Infinity;

  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    const state = tool.state;
    if (state.status === 'pending' || state.status === 'running') active = true;
    if (state.status === 'error') failedCount += 1;
    if (state.status !== 'pending') start = Math.min(start, state.startedAt);
    if (state.status === 'completed') end = Math.max(end, state.completedAt);
    if (state.status === 'error') end = Math.max(end, state.failedAt);
    if (state.status === 'interrupted') end = Math.max(end, state.interruptedAt);
    const diff = getDiffTotals(getToolPartVisualization(tool));
    additions += diff.additions;
    deletions += diff.deletions;
  }

  return {
    toolCount: tools.length,
    failedCount,
    active,
    names: [...counts].map(([name, count]) => ({ name, count })),
    additions,
    deletions,
    durationMs: !active && end >= start ? end - start : undefined,
  };
}

/**
 * Reasoning parts carry no end time. The next part's creation is the
 * closest record of when thinking stopped; anything under a second is noise.
 */
export function estimateReasoningMs(parts: readonly Part[], index: number): number | undefined {
  const next = parts[index + 1];
  if (!next) return undefined;
  const ms = next.createdAt - parts[index].createdAt;
  return ms >= 1000 ? ms : undefined;
}
