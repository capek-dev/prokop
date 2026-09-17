import { createHash } from 'node:crypto';
import type { SelectedContextItem, SelectedContextRecord } from '@prokopai/sdk';

export interface ContextCandidate extends Omit<SelectedContextItem, 'inclusion' | 'score' | 'kind'> {
  kind: 'memory' | 'skill';
  rendered: string;
}
export interface SelectionPolicy {
  threshold: number;
  requiredProbability: number;
  memoryChars: number;
  skillChars: number;
}
export const DEFAULT_SELECTION_POLICY: SelectionPolicy = { threshold: 2, requiredProbability: 0.7, memoryChars: 5000, skillChars: 24000 };
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

export interface ContextScore {
  score: number;
  probabilities: readonly [number, number, number, number];
}

export function isValidContextScore(value: ContextScore): boolean {
  return Boolean(value && Number.isFinite(value.score) && value.score >= 0 && value.score <= 3
    && Array.isArray(value.probabilities) && value.probabilities.length === 4
    && value.probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1)
    // Allow rounding in the service response, but never invent a distribution from its mean.
    && Math.abs(value.probabilities.reduce((sum, p) => sum + p, 0) - 1) <= 0.02);
}

export function allocateContext(
  candidates: readonly ContextCandidate[],
  scores: readonly ContextScore[],
  policy: SelectionPolicy = DEFAULT_SELECTION_POLICY,
): { selected: ContextCandidate[]; items: SelectedContextItem[]; excluded: SelectedContextRecord['excluded'] } {
  if (scores.length !== candidates.length || scores.some(score => !isValidContextScore(score))
    || new Set(candidates.map(candidate => candidate.id)).size !== candidates.length
    || !Number.isInteger(policy.threshold) || policy.threshold < 0 || policy.threshold > 3
    || !Number.isFinite(policy.requiredProbability) || policy.requiredProbability < 0 || policy.requiredProbability > 1
    || !Number.isSafeInteger(policy.memoryChars) || policy.memoryChars < 0
    || !Number.isSafeInteger(policy.skillChars) || policy.skillChars < 0) throw new Error('Invalid context selection');
  const remaining = { memory: policy.memoryChars, skill: policy.skillChars };
  const ranked = candidates.map((candidate, index) => ({ candidate, index, score: scores[index].score,
      qualifyingProbability: Math.min(1, scores[index].probabilities.slice(policy.threshold).reduce((sum, p) => sum + p, 0)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: ContextCandidate[] = [];
  const items: SelectedContextItem[] = [];
  const excluded: SelectedContextRecord['excluded'] = [];
  for (const { candidate, score, qualifyingProbability } of ranked) {
    const cost = candidate.rendered.length + 2;
    const reason = qualifyingProbability + 1e-12 < policy.requiredProbability ? 'threshold' : cost > remaining[candidate.kind] ? 'budget' : null;
    if (reason) {
      excluded.push({ id: candidate.id, name: candidate.name, source: candidate.source, score, qualifyingProbability, reason });
      continue;
    }
    remaining[candidate.kind] -= cost;
    selected.push(candidate);
    const { rendered: _rendered, ...item } = candidate;
    items.push({ ...item, score, qualifyingProbability, inclusion: candidate.kind === 'skill' ? 'preloaded' : 'selected' });
  }
  return { selected, items, excluded };
}
