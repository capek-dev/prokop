import type { ToolDefinition, TextPart, Session, ResponseFormat } from '@jean2/sdk';
import {
  broadcastEvent,
  broadcastSessionCreated,
  broadcastSessionUpdated,
  broadcastToSessionEvent,
  createSession,
  getPreconfigOrAgent,
  getSession,
  getWorkspaceAutoApproveSeverity,
  listSubagentPreconfigs,
  updateSession,
} from '../compat/jean2-dependencies';
import type { BroadcastFn, BroadcastSessionFn } from '../compat/bindings';
import { executeChildSession } from './child-session';
import { resolveModelId, resolveProviderId } from './provider-utils';
import {
  collectSubagentAncestry,
  evaluateSubagentTarget,
  getSubagentResumeError,
  isSubagentSpawningDisabled,
  isValidSubagentTargetPreconfig,
  resolveEffectiveSubagentTargets,
} from './subagent-policy';

import { randomUUID } from 'crypto';

/**
 * Determine provider from model ID (fallback logic)
 */

const MAX_SUBAGENT_DEPTH = 2;

/**
 * Compute session depth by walking up the parent chain.
 * Primary session (no parent) = depth 0
 * Child of primary = depth 1
 * Child of child = depth 2
 */
function computeSessionDepth(sessionId: string): number {
  return collectSubagentAncestry(sessionId).depth;
}

export function canSpawnSubagent(sessionId: string): boolean {
  const depth = computeSessionDepth(sessionId);
  return depth < MAX_SUBAGENT_DEPTH;
}

export interface SubagentInput {
  description: string;
  prompt: string;
  subagent_type: string;
  task_id?: string;
  sessionId: string;
  workspaceId?: string;
  workspacePath?: string;
  abortSignal?: AbortSignal;
  onSessionCreated?: (childSessionId: string) => void;
  allowedSubagentIds?: string[];
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
  broadcastToSession?: BroadcastFn;
  /** Optional JSON Schema for structured subagent output */
  outputSchema?: Record<string, unknown>;
  executeChild?: typeof executeChildSession;
}

export interface SubagentOutput {
  task_id: string;
  result: string;
  error?: string;
  /** Structured JSON result when outputSchema was provided */
  structuredResult?: Record<string, unknown>;
}

export async function getSubagentToolDefinition(options: {
  sessionId: string;
  canSpawnSubagents: boolean | string[] | null | undefined;
  allowSelfAsSubagent?: boolean;
}): Promise<ToolDefinition | null> {
  const subagents = await resolveEffectiveSubagentTargets({
    sessionId: options.sessionId,
    canSpawnSubagents: options.canSpawnSubagents,
    allowSelfAsSubagent: options.allowSelfAsSubagent,
    maximumDepthReached: !canSpawnSubagent(options.sessionId),
  });

  if (subagents.length === 0) return null;

  const agentList = subagents
    .map((a) => `- ${a.id}: ${a.description ?? 'This subagent should only be called manually by the user.'}`)
    .join('\n');

  const subagentTypeEnum = subagents.length > 0
    ? subagents.map(s => s.id)
    : [];

  return {
    name: 'task',
    description: `Launch a new agent to handle complex, multistep tasks autonomously.

Available agent types and the tools they have access to:
${agentList}

When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. The agent's outputs should generally be trusted
3. Each agent invocation starts with a fresh context unless you provide task_id to resume the same subagent session (which continues with its previous messages and tool outputs). When starting fresh, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
4. Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches), since it is not aware of the user's intent. Tell it how to verify its work if possible (e.g., relevant test commands).
5. If the agent description mentions that it should be proactively used, then you should try your best to use it without the user having to ask you to do so first. Use your judgement.
6. Use the outputSchema parameter (a JSON Schema) to get structured, machine-readable output from a subagent instead of a free-text prose response. The subagent will be constrained to return JSON conforming to that schema.

When to use outputSchema (IMPORTANT - prefer it over free text in these cases):
- AGGREGATION: When spawning multiple parallel agents and you need to combine, filter, compare, or deduplicate their results. Define a shared schema for all agents so you can merge results programmatically.
- DATA EXTRACTION: When a subagent is searching, reading, or analyzing something and you need specific fields back (e.g., { findings: [{ file, line, issue, severity }], summary: string }).
- DECISIONS: When a subagent must return a verdict, classification, or yes/no with reasoning (e.g., { approved: boolean, concerns: string[], confidence: number }).
- LIST GENERATION: When a subagent finds or produces a list you need to iterate over (e.g., { files: string[], commands: string[] }).

When NOT to use it:
- The task is exploratory and the output shape is unpredictable (e.g., "summarize what you found about X").
- The subagent is writing code or modifying files directly — its result is the code changes, not a report.

Pattern for aggregation (map-reduce): define one schema, spawn N agents each with that outputSchema, then in your next turn merge the returned JSON objects. This keeps your context clean because you can reason about the data instead of re-parsing prose from each agent.

Note: Subagent depth is limited to 2 levels. You cannot spawn further subagents at the maximum depth.`,
    timeout: 300000,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'A short (3-5 words) description of the task',
        },
        prompt: {
          type: 'string',
          description:
            'The task for the agent to perform. Should contain a highly detailed task description specifying exactly what information the agent should return in its final message',
        },
        subagent_type: {
          type: 'string',
          description: 'The type of specialized agent to use for this agent',
          ...(subagentTypeEnum.length > 0 && { enum: subagentTypeEnum }),
        },
        task_id: {
          type: 'string',
          description:
            'Set this to resume a previous subagent session (continues with its previous messages and tool outputs)',
        },
        outputSchema: {
          type: 'object',
          description: 'Optional JSON Schema that the subagent must conform to in its final response. Use this when you need structured, parseable output (e.g., extracted data, categorized findings, structured analysis). When omitted, the subagent returns free text.',
          additionalProperties: true,
        },
      },
      required: ['description', 'prompt', 'subagent_type'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        result: { type: 'string' },
        error: { type: 'string' },
        structuredResult: { type: 'object', additionalProperties: true },
      },
    },
  };
}

export async function executeSubagent(input: SubagentInput): Promise<SubagentOutput> {
  const {
    description,
    prompt,
    subagent_type,
    task_id,
    sessionId,
    workspaceId,
    workspacePath,
    abortSignal,
    onSessionCreated,
    allowedSubagentIds,
    broadcast: broadcastFn = broadcastEvent as BroadcastFn,
    broadcastSessionCreated: broadcastSessCreated = broadcastSessionCreated as BroadcastSessionFn,
    broadcastSessionUpdated: broadcastSessUpdated = broadcastSessionUpdated as BroadcastSessionFn,
    broadcastToSession: broadcastToSessionFn,
    outputSchema,
    executeChild = executeChildSession,
  } = input;

  // Check if already aborted before starting
  if (abortSignal?.aborted) {
    return {
      task_id: '',
      result: '',
      error: 'Subagent execution aborted before start',
    };
  }

  // Get parent session for model inheritance
  const parentSession = getSession(sessionId);

  // Resolve parent's actual model using same fallback chain as main chat:
  // session > parent preconfig > config default
  const parentPreconfig = parentSession?.preconfigId
    ? await getPreconfigOrAgent(parentSession.preconfigId)
    : null;
  const parentModelId = resolveModelId(parentSession, parentPreconfig);
  const parentProviderId = resolveProviderId(parentSession, parentPreconfig);

  // Check depth limit
  const currentDepth = computeSessionDepth(sessionId);
  if (currentDepth >= MAX_SUBAGENT_DEPTH) {
    return {
      task_id: '',
      result: '',
      error: `Maximum subagent depth (${MAX_SUBAGENT_DEPTH}) reached. Cannot spawn more subagents.`,
    };
  }

  if (parentPreconfig && isSubagentSpawningDisabled(parentPreconfig.canSpawnSubagents)) {
    return {
      task_id: '',
      result: '',
      error: 'Subagent spawning is disabled for this agent.',
    };
  }

  // Validate subagent_type against the effective allowed list
  const configuredAllowedIds = Array.isArray(parentPreconfig?.canSpawnSubagents)
    ? [...parentPreconfig.canSpawnSubagents]
    : allowedSubagentIds ? [...allowedSubagentIds] : undefined;
  if (parentSession?.preconfigId && parentPreconfig?.allowSelfAsSubagent) {
    configuredAllowedIds?.push(parentSession.preconfigId);
  }
  if (configuredAllowedIds && !configuredAllowedIds.includes(subagent_type)) {
    return {
      task_id: '',
      result: '',
      error: `Subagent type "${subagent_type}" is not allowed for this agent. Allowed types: ${configuredAllowedIds.join(', ')}`,
    };
  }

  const ancestry = collectSubagentAncestry(sessionId);
  const policy = evaluateSubagentTarget({
    targetPreconfigId: subagent_type,
    currentPreconfigId: parentSession?.preconfigId ?? null,
    ancestryPreconfigIds: ancestry.preconfigIds,
    allowSelfAsSubagent: parentPreconfig?.allowSelfAsSubagent === true,
  });
  if (!policy.allowed) {
    return {
      task_id: '',
      result: '',
      error: policy.error,
    };
  }

  let childSession: Session | undefined | null;
  let resumeFromHistory = false;

  // Set up abort handling variables outside try block for finally access
  let wasAborted = false;
  const abortHandler = () => {
    wasAborted = true;
    if (childSession) {
      updateSession(childSession.id, { subagentStatus: 'interrupted' });
      const updatedSession = getSession(childSession.id);
      if (updatedSession) {
        broadcastSessUpdated(updatedSession);
      }
    }
  };

  try {
    const subagentPreconfig = await getPreconfigOrAgent(subagent_type);
    if (!subagentPreconfig) {
      const available = await listSubagentPreconfigs();
      const availableNames = available.map((s) => s.id).join(', ');
      return {
        task_id: '',
        result: '',
        error: `Unknown subagent type: "${subagent_type}". Available subagents: ${availableNames || 'none'}`,
      };
    }

    if (!isValidSubagentTargetPreconfig(
      subagentPreconfig,
      parentSession?.preconfigId ?? null,
      parentPreconfig?.allowSelfAsSubagent === true,
    )) {
      return {
        task_id: '',
        result: '',
        error: `Preconfig "${subagent_type}" cannot be used as a subagent.`,
      };
    }

    if (task_id) {
      childSession = getSession(task_id);
      if (!childSession) {
        childSession = null;
      } else {
        const resumeError = getSubagentResumeError(childSession, sessionId, subagent_type);
        if (resumeError) {
          return {
            task_id: '',
            result: '',
            error: resumeError,
          };
        }

        resumeFromHistory = true;
        updateSession(childSession.id, { subagentStatus: 'running' });
      }
    }

    if (!childSession) {
      childSession = createSession({
        id: randomUUID(),
        workspaceId: workspaceId || parentSession?.workspaceId || '',
        preconfigId: subagent_type,
        title: `${description} (@${subagent_type} subagent)`,
        status: 'active',
        metadata: null,
        parentId: sessionId,
        agentName: subagent_type,
        subagentStatus: 'running',
        selectedModel: subagentPreconfig.model !== null
          ? subagentPreconfig.model
          : parentModelId,
        selectedProvider: subagentPreconfig.provider !== null
          ? subagentPreconfig.provider
          : parentProviderId,
        selectedVariant: subagentPreconfig.variant ?? null,
        autoApproveSeverity: getWorkspaceAutoApproveSeverity(workspaceId || ''),
      });

      broadcastSessCreated(childSession);
    }

    // Notify caller of the child session ID immediately
    if (onSessionCreated) {
      onSessionCreated(childSession.id);
    }

    // Add abort listener to update child session status if parent aborts
    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler);
    }

    // Wrap inline schema as a transient ResponseFormat so the existing
    // structured output pipeline in agent.ts applies to the subagent.
    const responseFormat: ResponseFormat | undefined = outputSchema
      ? {
          id: `inline-task-${randomUUID()}`,
          name: 'Task Output',
          schema: outputSchema,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      : undefined;

    const result = await executeChild({
      parentSessionId: sessionId,
      childSessionId: childSession.id,
      preconfig: subagentPreconfig,
      prompt,
      workspacePath,
      workspaceId,
      resumeFromHistory,
      // Inherit model from parent if preconfig doesn't specify one
      modelId: subagentPreconfig.model !== null
        ? subagentPreconfig.model
        : parentModelId,
      providerId: subagentPreconfig.provider !== null
        ? subagentPreconfig.provider
        : parentProviderId,
      variant: subagentPreconfig.variant ?? undefined,
      broadcast: broadcastFn,
      abortSignal,
      broadcastToSession: broadcastToSessionFn ?? ((msg: import('@jean2/sdk').ServerMessage) => {
        broadcastToSessionEvent(sessionId, msg);
      }),
      ...(responseFormat ? { responseFormat } : {}),
    });

    // Check if was aborted during execution
    if (wasAborted) {
      return {
        task_id: childSession.id,
        result: '',
        error: 'Subagent execution was interrupted',
      };
    }

    // Update subagent status based on execution result
    if (result.error) {
      updateSession(childSession.id, { subagentStatus: 'error' });
      const updatedSession = getSession(childSession.id);
      if (updatedSession) {
        broadcastSessUpdated(updatedSession);
      }
    } else {
      updateSession(childSession.id, { subagentStatus: 'completed' });
      const updatedSession = getSession(childSession.id);
      if (updatedSession) {
        broadcastSessUpdated(updatedSession);
      }
    }

    // Extract ONLY the last text part - matching OpenCode behavior
    // Note: executeChildSession now returns parts instead of content
    const text = result.parts
      .filter((part): part is TextPart => part.type === 'text')
      .map((part) => part.text || '')
      .pop() ?? '';

    // Extract structured output if it was captured
    const structuredResult = result.structuredOutput?.data;

    // If there's an error and no text, return it directly
    if (result.error && !text) {
      return {
        task_id: childSession.id,
        result: '',
        error: result.error,
      };
    }

    // Format output like OpenCode with task_result tags
    const output = [
      `task_id: ${childSession.id} (for resuming to continue this task if needed)`,
      '',
      '<task_result>',
      text || 'No response generated',
      '</task_result>',
      structuredResult
        ? '\n<structured_result>\n' + JSON.stringify(structuredResult, null, 2) + '\n</structured_result>'
        : '',
    ].join('\n');

    return {
      task_id: childSession.id,
      result: output,
      ...(structuredResult ? { structuredResult } : {}),
      ...(result.error && { error: result.error }),
    };
  } catch (err: unknown) {
    console.error('[executeSubagent] AI SDK error', {
      sessionId,
      childSessionId: childSession?.id,
      subagentType: subagent_type,
      rawError: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });

    if (childSession) {
      updateSession(childSession.id, { subagentStatus: abortSignal?.aborted ? 'interrupted' : 'error' });
      const updatedSession = getSession(childSession.id);
      if (updatedSession) {
        broadcastSessUpdated(updatedSession);
      }
    }
    return {
      task_id: childSession?.id ?? '',
      result: '',
      error: `Task tool error: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
  }
}
