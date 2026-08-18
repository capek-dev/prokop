import { listSubagentPreconfigs } from '../context';
import type { WorkflowSubtask, Preconfig } from '@capekai/types';
import type { BroadcastFn, BroadcastSessionFn } from '../runtime/host';
import {
  runOrchestratorSession,
  type OrchestratorSessionOptions,
  type OrchestratorSessionResult,
} from './orchestrator-session';

/** Workflow domain: task decomposition. Moved byte-for-byte from
 * `core/workflow-decomposer.ts`; the unscoped export keeps the pre-C5
 * module-accessor behavior, and the WithDeps variant runs against the
 * injected subagent listing and orchestrator contract captured by the
 * domain plugin at composition. */

export const MAX_SUBTASKS = 50;

export interface DecomposeTaskOptions {
  prompt: string;
  parentSessionId: string;
  abortSignal?: AbortSignal;
  allowedSubagentIds?: string[];
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
  runOrchestrator?: typeof runOrchestratorSession;
}

export interface DecomposeTaskDeps {
  listSubagents(): Promise<Preconfig[]>;
  orchestrator: { run(options: OrchestratorSessionOptions): Promise<OrchestratorSessionResult> };
}

/** Unscoped decomposition: module subagent listing plus the module
 * orchestrator implementation, exactly like the pre-C5 path. */
export async function decomposeTask(options: DecomposeTaskOptions): Promise<WorkflowSubtask[]> {
  return decomposeTaskWithDeps(options, {
    listSubagents: listSubagentPreconfigs,
    orchestrator: { run: runOrchestratorSession },
  });
}

/** Composed decomposition over the injected deps. */
export async function decomposeTaskWithDeps(
  options: DecomposeTaskOptions,
  deps: DecomposeTaskDeps,
): Promise<WorkflowSubtask[]> {
  console.log('[workflow:decompose] Starting decomposition', {
    parentSessionId: options.parentSessionId,
    promptPreview: options.prompt.slice(0, 100),
    allowedSubagentIds: options.allowedSubagentIds,
  });

  let preconfigs = await deps.listSubagents();

  // Filter to only allowed subagent types if specified
  if (options.allowedSubagentIds && options.allowedSubagentIds.length > 0) {
    const allowedSet = new Set(options.allowedSubagentIds);
    preconfigs = preconfigs.filter(p => allowedSet.has(p.id));
  }

  if (preconfigs.length === 0) {
    throw new Error('No subagent types available for this session');
  }

  console.log('[workflow:decompose] Available subagent preconfigs:', preconfigs.map(p => p.id));
  const preconfigList = preconfigs
    .map((p) => `- ${p.id}: ${p.description ?? 'Specialized agent'}`)
    .join('\n');

  const system = [
    'You are a task decomposer. Given a high-level task, break it into independent',
    'parallel subtasks that can be executed by specialist agents.',
    '',
    `Available agent types:\n${preconfigList}`,
    '',
    'Rules:',
    '- Each subtask must be self-contained (the agent has no context beyond the prompt).',
    '- Aim for 2-10 subtasks. Too few wastes parallelism; too many creates overhead.',
    '- Assign the most appropriate agent type (preconfigId) for each subtask from the available list above.',
    '- The preconfigId MUST be one of the listed agent types. Do NOT invent types.',
    '- Subtasks should NOT depend on each other\'s results (they run in parallel).',
    '',
    'You must respond with ONLY valid JSON (no markdown fences, no extra text) in this exact format:',
    '{"subtasks":[{"prompt":"...","preconfigId":"..."}]}',
  ].join('\n');

  const result = await (options.runOrchestrator ?? deps.orchestrator.run)({
    parentSessionId: options.parentSessionId,
    title: `Decompose: ${options.prompt.slice(0, 50)}`,
    agentName: 'decomposer',
    systemPrompt: system,
    userPrompt: options.prompt,
    maxTokens: 4096,
    abortSignal: options.abortSignal,
    broadcast: options.broadcast,
    broadcastSessionCreated: options.broadcastSessionCreated,
    broadcastSessionUpdated: options.broadcastSessionUpdated,
  });

  const parsed = result.json;
  if (!parsed?.subtasks || !Array.isArray(parsed.subtasks)) {
    console.error('[workflow:decompose] Failed to parse subtasks from response', { text: result.text });
    throw new Error('Decomposer failed to produce valid subtasks');
  }

  let subtasks = parsed.subtasks as WorkflowSubtask[];

  if (subtasks.length === 0) {
    throw new Error('Decomposition produced no subtasks');
  }

  // Sanitize: ensure preconfigId is one of the allowed types, fall back to first available
  const validIds = new Set(preconfigs.map(p => p.id));
  const fallbackId = preconfigs[0]?.id;
  subtasks = subtasks.map(s => ({
    ...s,
    preconfigId: s.preconfigId && validIds.has(s.preconfigId)
      ? s.preconfigId
      : fallbackId,
  }));

  console.log('[workflow:decompose] Decomposition complete', {
    subtaskCount: subtasks.length,
    subtasks: subtasks.map((s, i) => ({
      i,
      preconfigId: s.preconfigId,
      promptPreview: s.prompt.slice(0, 80),
    })),
  });

  // Safety cap
  if (subtasks.length > MAX_SUBTASKS) {
    console.warn(`[workflow:decompose] Decomposer returned ${subtasks.length} subtasks, capping to ${MAX_SUBTASKS}`);
    subtasks = subtasks.slice(0, MAX_SUBTASKS);
  }

  return subtasks;
}
