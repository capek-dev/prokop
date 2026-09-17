import { createHash } from 'node:crypto';
import type { SelectedContextItem, SelectedContextRecord } from '@prokopai/sdk';

export interface ContextCandidate extends Omit<SelectedContextItem, 'inclusion' | 'score' | 'kind'> {
  kind: 'memory' | 'skill';
  rendered: string;
}
export interface SelectionPolicy {
  threshold: number;
  memoryChars: number;
  skillChars: number;
}
export const DEFAULT_SELECTION_POLICY: SelectionPolicy = { threshold: 2, memoryChars: 5000, skillChars: 24000 };
export const SELECTOR_INPUT_CHARS = 256000;
export const SELECTOR_MAX_CANDIDATES = 256;

export function revisionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function candidateId(scope: string, revision: string, identity: string): string {
  return revisionOf(JSON.stringify([scope, revision, identity]));
}

/** Preserve multiline entries. Non-bullet prose is its own candidate, never silently lost. */
export function memoryEntries(content: string): string[] {
  const entries: string[] = [];
  let lines: string[] = [];
  let fence: string | undefined;
  for (const line of content.split('\n')) {
    if (!fence && line.startsWith('- ') && lines.length) {
      entries.push(lines.join('\n'));
      lines = [];
    }
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
    }
    lines.push(line);
  }
  entries.push(lines.join('\n'));
  return entries.filter(item => item.trim().length > 0);
}

export function allocateContext(
  candidates: readonly ContextCandidate[],
  scores: readonly number[],
  policy: SelectionPolicy = DEFAULT_SELECTION_POLICY,
): { selected: ContextCandidate[]; items: SelectedContextItem[]; excluded: SelectedContextRecord['excluded'] } {
  if (scores.length !== candidates.length || scores.some(score => !Number.isFinite(score) || score < 0 || score > 3)
    || new Set(candidates.map(candidate => candidate.id)).size !== candidates.length
    || !Number.isFinite(policy.threshold) || policy.threshold < 0 || policy.threshold > 3
    || !Number.isSafeInteger(policy.memoryChars) || policy.memoryChars < 0
    || !Number.isSafeInteger(policy.skillChars) || policy.skillChars < 0) throw new Error('Invalid context selection');
  const remaining = { memory: policy.memoryChars, skill: policy.skillChars };
  const ranked = candidates.map((candidate, index) => ({ candidate, index, score: scores[index] }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: ContextCandidate[] = [];
  const items: SelectedContextItem[] = [];
  const excluded: SelectedContextRecord['excluded'] = [];
  for (const { candidate, score } of ranked) {
    const cost = candidate.rendered.length + 2;
    const reason = score < policy.threshold ? 'threshold' : cost > remaining[candidate.kind] ? 'budget' : null;
    if (reason) {
      excluded.push({ id: candidate.id, name: candidate.name, source: candidate.source, score, reason });
      continue;
    }
    remaining[candidate.kind] -= cost;
    selected.push(candidate);
    const { rendered: _rendered, ...item } = candidate;
    items.push({ ...item, score, inclusion: candidate.kind === 'skill' ? 'preloaded' : 'selected' });
  }
  return { selected, items, excluded };
}
