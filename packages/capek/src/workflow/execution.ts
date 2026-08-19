import { randomUUID } from 'crypto';
import type { ToolDefinition } from '@capekai/tool';
import type { WorkflowInput, WorkflowResult, WorkflowSubtask } from '@capekai/types';
import type { BroadcastFn, BroadcastSessionFn } from '../runtime/host';
import { getSession } from '../storage/runtime';
import { listSubagentPreconfigs } from '../context';
import {
  canSpawnSubagent,
  canSpawnSubagentWithDeps,
  type SubagentInput,
  type SubagentOutput,
} from '../subagent/task-tool';
import {
  resolveEffectiveSubagentTargets,
  type ResolveSubagentTargetsOptions,
} from '../subagent/policy';
import {
  decomposeTask,
  decomposeTaskWithDeps,
  type DecomposeTaskDeps,
  type DecomposeTaskOptions,
} from './decomposer';
import {
  synthesizeResults,
  synthesizeResultsWithDeps,
  type LeafResult,
  type SynthesizeResultsDeps,
  type SynthesizeResultsOptions,
} from './synthesizer';
import {
  runOrchestratorSession,
  type OrchestratorSessionOptions,
  type OrchestratorSessionResult,
} from './orchestrator-session';
import { executeSubagent } from '../subagent/task-tool';

/**
 * Workflow domain: the workflow tool definition and execution. Moved
 * byte-for-byte from `core/workflow.ts`; the unscoped exports keep the
 * pre-C5 module-accessor behavior, and `executeWorkflowWithDeps` /
 * `resolveWorkflowToolDefinitionWithDeps` run against the injected subagent
 * execution, depth, target, and orchestrator-session contracts captured by
 * the domain plugin at composition. Composed scopes never read module
 * globals.
 */

export { canSpawnSubagent };

/** Hardcoded concurrency limit for leaf agents. */
export const MAX_CONCURRENCY = 5;

/**
 * Simple concurrency-limited async pool.
 * Runs items through fn with at most `limit` in flight at once.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  abortSignal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();
  const queue = items.map((item, index) => ({ item, index }));

  while (queue.length > 0 || executing.size > 0) {
    if (abortSignal?.aborted) {
      queue.length = 0;
    }
    while (!abortSignal?.aborted && executing.size < limit && queue.length > 0) {
      const { item, index } = queue.shift()!;
      const p = fn(item, index).then((result) => {
        results[index] = result;
      });
      const wrapped = p.then(() => {
        executing.delete(wrapped);
      });
      executing.add(wrapped);
    }
    if (executing.size > 0) {
      await Promise.race(executing);
    }
  }

  return results;
}

export interface WorkflowExecutionOptions {
  sessionId: string;
  workspaceId?: string;
  workspacePath?: string;
  abortSignal?: AbortSignal;
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
  broadcastToSession?: BroadcastFn;
  allowedSubagentIds?: string[];
  executeLeaf?: typeof executeSubagent;
  decompose?: typeof decomposeTask;
  synthesize?: typeof synthesizeResults;
}

/** Injected dependencies captured by the workflow domain plugin. */
export interface WorkflowServiceDeps {
  canSpawn(sessionId: string): boolean | Promise<boolean>;
  listSubagents(): Promise<import('@capekai/types').Preconfig[]>;
  executeLeaf(input: SubagentInput): Promise<SubagentOutput>;
  orchestrator: { run(options: OrchestratorSessionOptions): Promise<OrchestratorSessionResult> };
}

function moduleWorkflowDeps(): WorkflowServiceDeps {
  return {
    canSpawn: canSpawnSubagent,
    listSubagents: listSubagentPreconfigs,
    executeLeaf: executeSubagent,
    orchestrator: { run: runOrchestratorSession },
  };
}

/**
 * Execute a full workflow: decompose → fan out → synthesize.
 * Unscoped path: the pre-C5 module accessors.
 */
export async function executeWorkflow(
  input: WorkflowInput,
  options: WorkflowExecutionOptions,
): Promise<WorkflowResult> {
  return runWorkflow(input, options, moduleWorkflowDeps());
}

/** Composed execution over the dependencies captured by the domain plugin. */
export async function executeWorkflowWithDeps(
  input: WorkflowInput,
  options: WorkflowExecutionOptions,
  deps: WorkflowServiceDeps,
): Promise<WorkflowResult> {
  return runWorkflow(input, options, deps);
}

async function runWorkflow(
  input: WorkflowInput,
  options: WorkflowExecutionOptions,
  deps: WorkflowServiceDeps,
): Promise<WorkflowResult> {
  const executeLeaf = options.executeLeaf ?? deps.executeLeaf;
  const decompose: typeof decomposeTask = options.decompose
    ?? ((decomposeOptions: DecomposeTaskOptions) => decomposeTaskWithDeps(decomposeOptions, {
      listSubagents: deps.listSubagents,
      orchestrator: deps.orchestrator,
    } as DecomposeTaskDeps));
  const synthesize: typeof synthesizeResults = options.synthesize
    ?? ((synthesizeOptions: SynthesizeResultsOptions) => synthesizeResultsWithDeps(synthesizeOptions, {
      orchestrator: deps.orchestrator,
    } as SynthesizeResultsDeps));
  const workflowId = `wf-${randomUUID()}`;
  console.log('[workflow] Starting workflow', {
    workflowId,
    sessionId: options.sessionId,
    promptPreview: input.prompt.slice(0, 100),
    hasSubtasks: !!input.subtasks?.length,
    subtaskCount: input.subtasks?.length ?? 0,
    leafPreconfigId: input.leafPreconfigId,
    hasOutputSchema: !!input.outputSchema,
  });

  // Check depth limit — workflow leaf agents spawn as children of this session
  if (!(await deps.canSpawn(options.sessionId))) {
    console.warn('[workflow] Blocked: max subagent depth reached', { sessionId: options.sessionId });
    return {
      workflow_id: workflowId,
      result: '',
      subtaskCount: 0,
      error: 'Maximum subagent depth reached. Cannot spawn workflow agents.',
    };
  }

  if (input.leafPreconfigId && options.allowedSubagentIds && !options.allowedSubagentIds.includes(input.leafPreconfigId)) {
    return {
      workflow_id: workflowId,
      result: '',
      subtaskCount: 0,
      error: `Subagent type "${input.leafPreconfigId}" is not allowed for this workflow.`,
    };
  }

  if (input.subtasks && options.allowedSubagentIds) {
    const invalidTarget = input.subtasks.find((subtask) => {
      const target = subtask.preconfigId || 'explore';
      return !options.allowedSubagentIds!.includes(target);
    });
    if (invalidTarget) {
      const target = invalidTarget.preconfigId || 'explore';
      return {
        workflow_id: workflowId,
        result: '',
        subtaskCount: 0,
        error: `Subagent type "${target}" is not allowed for this workflow.`,
      };
    }
  }

  // ── Phase 1: Decompose (or use provided subtasks) ──────────────────────
  let subtasks: WorkflowSubtask[];

  if (input.subtasks && input.subtasks.length > 0) {
    console.log('[workflow] Phase 1: SKIPPED (explicit subtasks provided)', { count: input.subtasks.length });
    subtasks = input.subtasks;
  } else {
    console.log('[workflow] Phase 1: Decomposing task...');
    try {
      subtasks = await decompose({
        prompt: input.prompt,
        parentSessionId: options.sessionId,
        abortSignal: options.abortSignal,
        allowedSubagentIds: options.allowedSubagentIds,
        broadcast: options.broadcast,
        broadcastSessionCreated: options.broadcastSessionCreated,
        broadcastSessionUpdated: options.broadcastSessionUpdated,
      });
      console.log('[workflow] Phase 1: Decomposition complete', { subtaskCount: subtasks.length });
    } catch (err) {
      const errAny = err as Record<string, unknown>;
      console.error('[workflow] Phase 1: Decomposition FAILED', {
        message: err instanceof Error ? err.message : String(err),
        statusCode: errAny?.statusCode ?? errAny?.status,
        url: errAny?.url,
        responseBody: errAny?.responseBody ?? errAny?.response,
        data: errAny?.data,
      });
      return {
        workflow_id: workflowId,
        result: '',
        subtaskCount: 0,
        error: `Decomposition failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Apply leafPreconfigId override if provided
  if (input.leafPreconfigId) {
    console.log('[workflow] Applying leafPreconfigId override to all subtasks', { leafPreconfigId: input.leafPreconfigId });
    subtasks = subtasks.map((s) => ({ ...s, preconfigId: input.leafPreconfigId }));
  }

  // ── Phase 2: Fan out leaf agents ───────────────────────────────────────
  console.log('[workflow] Phase 2: Fanning out leaf agents', {
    count: subtasks.length,
    maxConcurrency: MAX_CONCURRENCY,
    subtasks: subtasks.map((s, i) => ({ i, preconfigId: s.preconfigId || '(default explore)', promptPreview: s.prompt.slice(0, 60) })),
  });

  let completedCount = 0;
  let failedCount = 0;

  const leafResults = await runWithConcurrency(
    subtasks,
    MAX_CONCURRENCY,
    async (subtask: WorkflowSubtask, index: number): Promise<LeafResult> => {
      const subagentType = subtask.preconfigId || 'explore';
      const label = `${input.description || input.prompt.slice(0, 30)}... #${index + 1}`;
      console.log('[workflow] Phase 2: Starting leaf agent', { index, subagentType, promptPreview: subtask.prompt.slice(0, 80) });

      try {
        const subagentInput: SubagentInput = {
          description: label,
          prompt: subtask.prompt,
          subagent_type: subagentType,
          sessionId: options.sessionId,
          workspaceId: options.workspaceId,
          workspacePath: options.workspacePath,
          abortSignal: options.abortSignal,
          allowedSubagentIds: options.allowedSubagentIds,
          broadcast: options.broadcast,
          broadcastSessionCreated: options.broadcastSessionCreated,
          broadcastSessionUpdated: options.broadcastSessionUpdated,
          broadcastToSession: options.broadcastToSession,
          ...(subtask.outputSchema ? { outputSchema: subtask.outputSchema } : {}),
        };

        const result: SubagentOutput = await executeLeaf(subagentInput);
        console.log('[workflow] Phase 2: Leaf agent completed', {
          index,
          taskId: result.task_id,
          hasText: !!result.result,
          hasStructured: !!result.structuredResult,
          hasError: !!result.error,
          errorPreview: result.error?.slice(0, 100),
        });

        if (result.error) {
          failedCount++;
        } else {
          completedCount++;
        }

        return {
          index,
          text: result.result,
          ...(result.structuredResult ? { structuredResult: result.structuredResult } : {}),
          ...(result.error ? { error: result.error } : {}),
        };
      } catch (err) {
        console.error('[workflow] Phase 2: Leaf agent FAILED', { index, error: err instanceof Error ? err.message : String(err) });
        failedCount++;
        return {
          index,
          text: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    options.abortSignal,
  );

  console.log('[workflow] Phase 2: All leaf agents done', { completed: completedCount, failed: failedCount, total: subtasks.length });

  // Check if aborted before interpreting leaf outcomes
  if (options.abortSignal?.aborted) {
    return {
      workflow_id: workflowId,
      result: '',
      subtaskCount: subtasks.length,
      error: 'Workflow was interrupted',
    };
  }

  // If ALL leaf agents failed, bail early with a clear error
  if (completedCount === 0 && failedCount > 0) {
    const errors = leafResults.map(r => `Subtask ${r.index + 1}: ${r.error}`).join('; ');
    return {
      workflow_id: workflowId,
      result: '',
      subtaskCount: subtasks.length,
      error: `All ${failedCount} sub-agent(s) failed. Errors: ${errors}`,
    };
  }

  // ── Phase 3: Synthesize ────────────────────────────────────────────────
  console.log('[workflow] Phase 3: Synthesizing results...');
  try {
    const synthesis = await synthesize({
      originalPrompt: input.prompt,
      leafResults,
      ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      parentSessionId: options.sessionId,
      abortSignal: options.abortSignal,
      broadcast: options.broadcast,
      broadcastSessionCreated: options.broadcastSessionCreated,
      broadcastSessionUpdated: options.broadcastSessionUpdated,
    });

    const resultText = [
      `Workflow completed. ${subtasks.length} sub-agent(s) executed (${leafResults.filter(r => r.error).length} failed).`,
      '',
      synthesis.text,
    ].join('\n');

    console.log('[workflow] Phase 3: Synthesis complete', { hasStructuredResult: !!synthesis.structuredResult, resultLength: synthesis.text?.length });

    return {
      workflow_id: workflowId,
      result: resultText,
      ...(synthesis.structuredResult ? { structuredResult: synthesis.structuredResult } : {}),
      subtaskCount: subtasks.length,
    };
  } catch (err) {
    console.error('[workflow] Phase 3: Synthesis FAILED, falling back to raw leaf results', err instanceof Error ? err.message : err);

    // Fallback: return the individual leaf results so the caller still gets useful output
    const fallbackText = [
      `Workflow completed but synthesis failed. ${subtasks.length} sub-agent(s) executed (${leafResults.filter(r => r.error).length} failed).`,
      'Returning raw sub-agent results:',
      '',
      leafResults
        .map((r) => {
          const status = r.error ? '[FAILED]' : '[success]';
          const body = r.error ? `Error: ${r.error}` : (r.text || '(no text output)');
          return `Sub-agent ${r.index + 1} ${status}:\n${body}`;
        })
        .join('\n\n'),
    ].join('\n');

    return {
      workflow_id: workflowId,
      result: fallbackText,
      subtaskCount: subtasks.length,
      error: `Synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build the workflow tool definition for the AI SDK.
 * Gated by canSpawnSubagents — same as the task tool.
 */
export interface WorkflowToolDefinition extends ToolDefinition {
  allowedSubagentIds: string[];
}

export interface GetWorkflowToolDefinitionOptions {
  sessionId: string;
  canSpawnSubagents: boolean | string[] | null | undefined;
  allowSelfAsSubagent?: boolean;
}

/** Unscoped definition resolution: reads the module-level session and
 * preconfig accessors exactly like the pre-C5 path. */
export async function getWorkflowToolDefinition(
  options: GetWorkflowToolDefinitionOptions,
): Promise<WorkflowToolDefinition | null> {
  return resolveWorkflowToolDefinitionWithDeps(options, {
    getSession,
    listPreconfigs: listSubagentPreconfigs,
  });
}

/** Composed definition resolution over injected lookups. */
export async function resolveWorkflowToolDefinitionWithDeps(
  options: GetWorkflowToolDefinitionOptions,
  deps: { getSession: (id: string) => Promise<import('@capekai/types').Session | null>; listPreconfigs: () => Promise<import('@capekai/types').Preconfig[]> },
): Promise<WorkflowToolDefinition | null> {
  const subagents = await resolveEffectiveSubagentTargets({
    sessionId: options.sessionId,
    canSpawnSubagents: options.canSpawnSubagents,
    allowSelfAsSubagent: options.allowSelfAsSubagent,
    maximumDepthReached: !(await canSpawnSubagentWithDeps(options.sessionId, deps.getSession)),
  } as ResolveSubagentTargetsOptions, deps);

  if (subagents.length === 0) return null;

  return buildWorkflowToolDefinition(subagents);
}

/** Pure assembly of the workflow tool definition from a resolved target
 * list. Moved byte-for-byte from the pre-C5 `getWorkflowToolDefinition`
 * assembly. */
export function buildWorkflowToolDefinition(subagents: import('@capekai/types').Preconfig[]): WorkflowToolDefinition {
  const allowedSubagentIds = subagents.map((subagent) => subagent.id);
  const subagentList = allowedSubagentIds.join(', ');

  return {
    name: 'workflow',
    description: `Orchestrate parallel multi-agent work via decompose → fan out → synthesize.

This tool is ideal for large tasks that benefit from parallelism: research across multiple angles, bulk file operations, codebase audits, or any task that can be split into independent pieces.

How it works:
1. DECOMPOSE: Breaks your prompt into parallel subtasks (unless you provide \`subtasks\`).
2. FAN OUT: Runs each subtask as an independent agent concurrently (max ${MAX_CONCURRENCY} at a time).
3. SYNTHESIZE: Combines all results into one consolidated answer.

Unlike calling \`task\` multiple times yourself, this tool protects your context window: you only see the final synthesis, not all intermediate results.

Available leaf agent types: ${subagentList}

When to use \`workflow\` vs \`task\`:
- Use \`workflow\` for: large parallel tasks, research, bulk operations, anything needing 3+ agents.
- Use \`task\` for: single focused delegations, when you want direct access to results, or when subtasks depend on each other.

Parameters:
- \`prompt\` (required): The high-level task. The tool will decompose it automatically.
- \`subtasks\` (optional): Provide explicit subtasks to skip decomposition. Each has \`prompt\`, optional \`preconfigId\`, and optional \`outputSchema\`.
- \`leafPreconfigId\` (optional): Force all leaf agents to use this agent type (overrides decomposer's choices).
- \`outputSchema\` (optional): JSON Schema for structured final output. If provided, synthesis returns conforming JSON.`,
    timeout: 600000,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The high-level task to accomplish. The tool decomposes it into parallel subtasks unless "subtasks" is provided.',
        },
        description: {
          type: 'string',
          description: 'Short label for the workflow run (shown in UI).',
        },
        subtasks: {
          type: 'array',
          description: 'Explicit subtasks to run in parallel. Skips decomposition if provided.',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'The self-contained prompt for this subtask' },
              preconfigId: {
                type: 'string',
                description: 'Agent type (preconfig ID) to use for this subtask',
                enum: allowedSubagentIds,
              },
              outputSchema: {
                type: 'object',
                additionalProperties: true,
                description: 'Optional JSON Schema for structured output from this subtask',
              },
            },
            required: ['prompt'],
          },
        },
        leafPreconfigId: {
          type: 'string',
          description: 'Force all leaf agents to use this agent type. Overrides per-subtask assignments.',
          enum: allowedSubagentIds,
        },
        outputSchema: {
          type: 'object',
          additionalProperties: true,
          description: 'Optional JSON Schema for the final synthesized output.',
        },
      },
      required: ['prompt'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string' },
        result: { type: 'string' },
        structuredResult: { type: 'object', additionalProperties: true },
        subtaskCount: { type: 'number' },
        error: { type: 'string' },
      },
    },
    allowedSubagentIds,
  };
}
