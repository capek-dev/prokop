import { isAbsolute, join, relative, sep } from 'node:path';
import { capekContextAssemblerKey, capekContextSourcesKey, type CapekPlugin, type ContextAssemblyData, type ContextSelectionInput } from '@capekai/core/composition';
import { getAvailableSkills, formatSkillContent } from '@capekai/core/hosts';
import type { SkillInfo } from '@capekai/types';
import type { SelectedContextItem, SelectedContextRecord } from '@prokopai/sdk';
import { allocateContext, candidateId, DEFAULT_SELECTION_POLICY, memoryEntries, revisionOf, type ContextCandidate, type ContextScore, type SelectionPolicy } from '@/application/context/selection';
import { SELECTOR_INPUT_CHARS, SELECTOR_MAX_CANDIDATES } from '@/application/context/selection';

interface Section { id: string; content: string }
interface MemoryBlock { section: number; full: string; open: string; close: string; candidates: ContextCandidate[] }
export interface ContextSelectionDependencies {
  sections(data: ContextAssemblyData): Promise<readonly Section[]>;
  skills(data: ContextAssemblyData): Promise<SkillInfo[]>;
  score(input: ContextSelectionInput, candidates: readonly ContextCandidate[], signal: AbortSignal): Promise<ContextScore[]>;
  save(record: SelectedContextRecord): void;
  enabled: boolean;
  credentials: boolean;
  policy?: SelectionPolicy;
  timeoutMs?: number;
}

function snapshotSections(sections: readonly Section[], data: ContextAssemblyData): {
  blocks: MemoryBlock[]; baseline: SelectedContextItem[]; preferences: SelectedContextItem[];
} {
  const blocks: MemoryBlock[] = [];
  const baseline: SelectedContextItem[] = [];
  const preferences: SelectedContextItem[] = [];
  for (const [section, { id, content }] of sections.entries()) {
    const source = id.startsWith('agent-') ? 'agent' : 'workspace';
    const scope = source === 'agent' ? data.preconfig.id : `${data.workspaceId}:${data.workspacePath}`;
    if (!['agent-memory', 'agent-user-preferences', 'workspace-memory'].includes(id)) continue;
    const pattern = /(<(agent_memory|agent_user_preferences|user_memory|workspace_memory)(?: [^>]*?)?>\n)([\s\S]*?)(\n<\/\2>)/g;
    const matches = [...content.matchAll(pattern)];
    // Unknown wrappers stay byte-exact and visible as baseline, never partially reconstructed.
    if (matches.map(match => match[0]).join('\n\n') !== content) {
      baseline.push({ id: candidateId(scope, revisionOf(content), id), revision: revisionOf(content), name: `${source} context`, kind: 'memory', source, content, inclusion: 'baseline' });
      continue;
    }
    for (const match of matches) {
      const body = match[3];
      const revision = revisionOf(body);
      const isPreference = match[2] === 'agent_user_preferences' || match[2] === 'user_memory';
      if (isPreference) {
        preferences.push({ id: candidateId(scope, revision, match[2]), revision, name: 'USER.md', kind: 'preferences', source, content: body, inclusion: 'always' });
        continue;
      }
      const candidates = memoryEntries(body).map((entry, index): ContextCandidate => ({
        id: candidateId(scope, revision, `${match[2]}:${index}`), revision, name: `MEMORY.md · entry ${index + 1}`,
        kind: 'memory', source, content: entry, rendered: entry,
      }));
      blocks.push({ section, full: match[0], open: match[1], close: match[4], candidates });
      baseline.push(...candidates.map(({ rendered: _rendered, ...item }) => ({ ...item, inclusion: 'baseline' as const })));
    }
  }
  return { blocks, baseline, preferences };
}

/** Request-local assembly. Nothing is cached on the reused composed agent scope. */
export async function assembleSelectedContext(data: ContextAssemblyData, deps: ContextSelectionDependencies): Promise<string> {
  const started = Date.now();
  const policy = deps.policy ?? DEFAULT_SELECTION_POLICY;
  const sections = await deps.sections(data);
  const { blocks, baseline: allBaseline, preferences } = snapshotSections(sections, data);
  // Bound fallback independently of storage capacity. Keep whole entries in source order.
  let remaining = Number.isSafeInteger(policy.memoryChars) && policy.memoryChars >= 0
    ? Math.min(policy.memoryChars, DEFAULT_SELECTION_POLICY.memoryChars) : DEFAULT_SELECTION_POLICY.memoryChars;
  const retained = new Set<string>();
  const baseline = allBaseline.filter(item => {
    const cost = item.content.length + 2;
    if (cost > remaining) return false;
    remaining -= cost;
    retained.add(item.id);
    return true;
  });
  const fallbackSections = sections.map(section => section.content);
  for (const block of blocks) {
    if (block.candidates.every(item => retained.has(item.id))) continue;
    const body = block.candidates.filter(item => retained.has(item.id)).map(item => item.content).join('\n');
    fallbackSections[block.section] = fallbackSections[block.section].replace(block.full, () => `${block.open}${body}${block.close}`);
  }
  // Unknown wrappers are indivisible baseline items, not safe to partially rewrite.
  for (const item of allBaseline) {
    if (retained.has(item.id) || blocks.some(block => block.candidates.some(candidate => candidate.id === item.id))) continue;
    const index = sections.findIndex(section => section.content === item.content);
    if (index >= 0) fallbackSections[index] = '';
  }
  const baselinePrompt = fallbackSections.filter(Boolean).join('\n\n');
  if (!data.selectionInput || !data.assistantMessageId) {
    console.info('[context-selection] skipped', JSON.stringify({
      reason: 'missing_assembly_metadata', hasSelectionInput: Boolean(data.selectionInput),
      hasAssistantMessageId: Boolean(data.assistantMessageId),
    }));
    return baselinePrompt;
  }
  data.signal?.throwIfAborted();
  const input = data.selectionInput;
  console.info('[context-selection] assembly', JSON.stringify({
    sessionId: input.sessionId, assistantMessageId: data.assistantMessageId,
    enabled: deps.enabled, credentials: deps.credentials,
    sections: sections.map(({ id, content }) => ({ id, chars: content.length })),
    memoryCandidates: blocks.flatMap(block => block.candidates).map(({ id, source, content }) => ({ id, source, chars: content.length })),
    preferences: preferences.length, policy,
  }));
  const record: SelectedContextRecord = {
    sessionId: input.sessionId, assistantMessageId: data.assistantMessageId,
    requestMessageId: input.request?.messageId, checkpointMessageId: input.checkpoint?.messageId,
    continuation: input.continuation, createdAt: new Date().toISOString(), outcome: 'disabled',
    threshold: policy.threshold, requiredProbability: policy.requiredProbability, elapsedMs: 0, items: [...preferences, ...baseline], excluded: [],
  };
  let prompt = baselinePrompt;
  if (deps.enabled && !deps.credentials) record.outcome = 'missing_credentials';
  else if (deps.enabled && (!input.request?.text.trim() && !(input.continuation && input.checkpoint?.text.trim()))) record.outcome = 'missing_evidence';
  else if (deps.enabled) {
    const controller = new AbortController();
    const abort = (): void => controller.abort(data.signal?.reason);
    data.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Selection timeout')); }, deps.timeoutMs ?? 5000);
    let rejectAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
        if (controller.signal.aborted) rejectAbort();
      });
      const work = async (): Promise<string> => {
        const skills = data.workspacePath ? await deps.skills(data) : [];
        controller.signal.throwIfAborted();
        const candidates = blocks.flatMap(block => block.candidates);
        const candidateCount = skills.length + candidates.length;
        const skillChars = skills.reduce((size, skill) => size + skill.content.length + skill.description.length, 0);
        const logLimit = (reason: string, inputChars?: number): void => {
          console.info('[context-selection] input-limit', JSON.stringify({
            sessionId: input.sessionId, assistantMessageId: data.assistantMessageId,
            reason, memoryCandidates: blocks.reduce((count, block) => count + block.candidates.length, 0),
            skills: skills.length, candidateCount, skillChars, inputChars,
            maxCandidates: SELECTOR_MAX_CANDIDATES, maxInputChars: SELECTOR_INPUT_CHARS,
          }));
        };
        if (candidateCount > SELECTOR_MAX_CANDIDATES || skillChars > SELECTOR_INPUT_CHARS) {
          logLimit(candidateCount > SELECTOR_MAX_CANDIDATES ? 'candidate_count' : 'skill_content');
          record.outcome = 'input_limit';
          return baselinePrompt;
        }
        for (const skill of [...skills].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
          const agentRelative = relative(join(data.workspacePath ?? '', '.agents', 'skills'), skill.location);
          const source = agentRelative !== '..' && !agentRelative.startsWith(`..${sep}`) && !isAbsolute(agentRelative) ? 'workspace' : 'agent';
          const revision = revisionOf(JSON.stringify([skill.name, skill.description, skill.content, skill.location]));
          candidates.push({ id: candidateId(skill.location, revision, skill.name), revision,
            name: skill.name, description: skill.description, source, kind: 'skill', content: formatSkillContent(skill),
            rendered: formatSkillContent(skill) });
        }
        // Budget scoring state, not local snapshot fields (rendered duplicates content).
        const inputChars = JSON.stringify({ task: {
          ...input, request: input.request ?? null, checkpoint: input.checkpoint ?? null,
        }, candidates: candidates.map(({ kind, name, description, content, source }) => ({
          kind, name, description: description ?? null, content, source,
        })) }).length;
        if (inputChars > SELECTOR_INPUT_CHARS) {
          logLimit('scoring_state', inputChars);
          record.outcome = 'input_limit';
          return baselinePrompt;
        }
        const scores = candidates.length ? await deps.score(input, candidates, controller.signal) : [];
        controller.signal.throwIfAborted();
        const result = allocateContext(candidates, scores, policy);
        const selectedIds = new Set(result.selected.map(item => item.id));
        const output = sections.map((section, index) => blocks.some(block => block.section === index) ? section.content : fallbackSections[index]);
        for (const block of blocks) {
          const body = block.candidates.filter(item => selectedIds.has(item.id)).map(item => item.content).join('\n');
          output[block.section] = output[block.section].replace(block.full, () => `${block.open}${body}${block.close}`);
        }
        const skillBodies = result.selected.filter(item => item.kind === 'skill').map(item => item.rendered);
        record.outcome = 'selected';
        record.items = [...preferences, ...baseline.filter(item => !candidates.some(candidate => candidate.id === item.id)), ...result.items];
        record.excluded = result.excluded;
        return [...output, ...skillBodies].join('\n\n');
      };
      prompt = await Promise.race([work(), aborted]);
    } catch {
      data.signal?.throwIfAborted();
      record.outcome = timedOut ? 'timeout' : 'failed';
      record.items = [...preferences, ...baseline];
      record.excluded = [];
    } finally {
      clearTimeout(timer);
      data.signal?.removeEventListener('abort', abort);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
      controller.abort();
    }
  }
  data.signal?.throwIfAborted();
  record.elapsedMs = Date.now() - started;
  console.info('[context-selection] outcome', JSON.stringify({
    sessionId: record.sessionId, assistantMessageId: record.assistantMessageId,
    outcome: record.outcome, elapsedMs: record.elapsedMs, threshold: record.threshold, requiredProbability: record.requiredProbability,
    included: record.items.map(({ id, kind, source, score, qualifyingProbability, inclusion }) => ({ id, kind, source, score, qualifyingProbability, inclusion })),
    excluded: record.excluded.map(({ id, source, score, qualifyingProbability, reason }) => ({ id, source, score, qualifyingProbability, reason })),
  }));
  deps.save(record);
  return prompt;
}

type SelectionHost = Omit<ContextSelectionDependencies, 'sections' | 'skills'>;
let getSelectionHost: (() => SelectionHost) | undefined;

/** Bootstrap supplies concrete HTTP and storage dependencies, never the runtime package. */
export function configureSelectedContext(host: () => SelectionHost): void {
  getSelectionHost = host;
}

export function selectedContextPlugin(): CapekPlugin<unknown> {
  return {
    id: 'prokopai.selected-context', scope: 'agent', provides: [capekContextAssemblerKey], requires: [capekContextSourcesKey],
    overrides: [{ key: capekContextAssemblerKey, replacedProvider: 'current.context-sections' }],
    setup(context) {
      const sources = context.require(capekContextSourcesKey);
      context.provide(capekContextAssemblerKey, { id: 'prokopai.selected-context', build: data => {
        const host = getSelectionHost?.();
        if (!host) return context.buildContext(data).then(sections => sections.map(section => section.content).join('\n\n'));
        return assembleSelectedContext(data, {
          ...host,
          sections: value => context.buildContext(value),
          skills: async value => {
            const directory = await sources.agents?.getDirectory(value.preconfig.id);
            return getAvailableSkills(value.workspacePath!, value.preconfig.skills, directory ? join(directory, 'skills') : undefined);
          },
        });
      } });
    },
  };
}
