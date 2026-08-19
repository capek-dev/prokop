import type { BroadcastFn, BroadcastSessionFn } from '../runtime/host';
import type { GoalEvaluation, MessageWithParts, TextPart, ToolPart } from '@capekai/types';
import { listMessagesWithParts } from '../storage/runtime';
import { runOrchestratorSession } from '../workflow/orchestrator-session';

/**
 * Goal domain: the goal evaluator model turn. Moved byte-for-byte from
 * `core/goal-evaluator.ts`; the unscoped export keeps the pre-C5 module
 * path (module storage plus the pinned core orchestrator-session
 * compatibility forwarder), and `evaluateGoalWithDeps` runs against the
 * injected transcript listing and orchestrator turn contract captured by
 * the goal domain plugin. The composed path never imports workflow
 * implementation code: the plugin bridges the shared
 * `capek.orchestrator-session` contract into these structural types.
 */

const MAX_TRANSCRIPT_MESSAGES = 20;
const MAX_TOOL_OUTPUT_CHARS = 500;

function summarizeToolState(toolPart: ToolPart): string {
  const state = toolPart.state;
  if (state.status === 'completed') {
    if (typeof state.output === 'string') return state.output.slice(0, MAX_TOOL_OUTPUT_CHARS);
    if (state.output && typeof state.output === 'object') return JSON.stringify(state.output).slice(0, MAX_TOOL_OUTPUT_CHARS);
    return '(completed)';
  }
  if (state.status === 'error') return `ERROR: ${state.error ?? 'unknown'}`;
  return `(${state.status})`;
}

async function buildTranscriptSummary(
  listTranscript: (sessionId: string) => MessageWithParts[] | Promise<MessageWithParts[]>,
  sessionId: string,
): Promise<string> {
  const messages = await listTranscript(sessionId);
  return messages.slice(-MAX_TRANSCRIPT_MESSAGES).map((entry) => {
    if (entry.message.role === 'user') {
      const text = entry.parts
        .filter((part): part is TextPart => part.type === 'text')
        .map((part) => part.text || '')
        .join('');
      return text ? `[USER]: ${text}` : '';
    }
    if (entry.message.role === 'assistant') {
      return entry.parts.map((part) => {
        if (part.type === 'text' && part.text) return `[ASSISTANT]: ${part.text}`;
        if (part.type === 'tool') return `[TOOL: ${part.name}]: ${summarizeToolState(part)}`;
        return '';
      }).filter(Boolean).join('\n');
    }
    return '';
  }).filter(Boolean).join('\n\n');
}

/** Structural copy of the shared orchestrator-session contract result. The
 * goal domain never imports workflow implementation code; the plugin
 * bridges the named `capek.orchestrator-session` contract into this shape. */
export interface GoalOrchestratorTurnOptions {
  parentSessionId: string;
  title: string;
  agentName: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
}

export interface GoalOrchestratorTurnResult {
  text: string;
  json: Record<string, unknown> | null;
  sessionId: string;
}

export interface GoalEvaluatorDeps {
  listTranscript(sessionId: string): MessageWithParts[] | Promise<MessageWithParts[]>;
  orchestrator: {
    run(options: GoalOrchestratorTurnOptions): Promise<GoalOrchestratorTurnResult>;
  };
}

export interface EvaluateGoalOptions {
  sessionId: string;
  condition: string;
  turn: number;
  maxTurns: number;
  abortSignal?: AbortSignal;
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
}

/** Unscoped evaluator: module storage transcript plus the pinned core
 * orchestrator-session forwarder, exactly like the pre-C5 path. */
export async function evaluateGoal(options: EvaluateGoalOptions): Promise<GoalEvaluation> {
  return evaluateGoalWithDeps(options, {
    listTranscript: listMessagesWithParts,
    orchestrator: { run: runOrchestratorSession },
  });
}

/** Composed evaluator over the injected transcript listing and orchestrator
 * turn contract. */
export async function evaluateGoalWithDeps(
  options: EvaluateGoalOptions,
  deps: GoalEvaluatorDeps,
): Promise<GoalEvaluation> {
  console.log('[goal:evaluator] Starting evaluation', {
    sessionId: options.sessionId,
    turn: options.turn,
    conditionPreview: options.condition.slice(0, 80),
  });

  const transcript = await buildTranscriptSummary(deps.listTranscript, options.sessionId);
  const system = [
    'You are a goal evaluator. Your job is to determine if a completion condition',
    'has been met based on the conversation transcript of an AI agent working on a task.',
    '',
    `Completion condition: "${options.condition}"`,
    '',
    'Rules:',
    '- Look for evidence in tool outputs (test results, lint output, build status, file contents).',
    '- Only return goalMet: true if you find CONCRETE evidence the condition is satisfied.',
    '- Do NOT assume the condition is met just because the agent said it was — verify from tool outputs.',
    '- If the condition requires tests to pass, look for actual test output showing all tests passing.',
    '',
    `Conversation transcript (turn ${options.turn} of ${options.maxTurns}):`,
    transcript,
    '',
    'Respond with ONLY valid JSON (no markdown fences, no extra text):',
    '{"goalMet": true/false, "reason": "explanation", "remainingWork": "what is left to do"}',
  ].join('\n');
  const result = await deps.orchestrator.run({
    parentSessionId: options.sessionId,
    title: `Goal Eval (Turn ${options.turn}): ${options.condition.slice(0, 40)}`,
    agentName: 'goal-evaluator',
    systemPrompt: system,
    userPrompt: `Evaluate: has the condition "${options.condition}" been met based on the transcript above?`,
    maxTokens: 2048,
    abortSignal: options.abortSignal,
    broadcast: options.broadcast,
    broadcastSessionCreated: options.broadcastSessionCreated,
    broadcastSessionUpdated: options.broadcastSessionUpdated,
  });

  console.log('[goal:evaluator] Evaluation complete', {
    goalMet: result.json?.goalMet === true,
    reason: result.json?.reason,
  });

  return {
    goalMet: result.json?.goalMet === true,
    reason: (result.json?.reason as string) ?? 'No reason provided',
    remainingWork: (result.json?.remainingWork as string) ?? undefined,
  };
}

/** The run directive for the next turn when the goal is not yet met. Moved
 * byte-for-byte from the pre-C5 goal-evaluator export. */
export function buildContinuationMessage(condition: string, reason: string, remainingWork?: string): string {
  return [
    `The goal is NOT yet met: ${condition}`,
    '',
    `Evaluator feedback: ${reason}`,
    remainingWork ? `\nRemaining work: ${remainingWork}` : '',
    '',
    'Continue working toward the goal. Do not repeat work you have already done.',
  ].join('\n');
}
