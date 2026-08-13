import type { GoalEvaluation, TextPart, ToolPart } from '@jean2/sdk';
import { listMessagesWithParts } from '../compat/jean2-dependencies';
import type { BroadcastFn, BroadcastSessionFn } from '../compat/bindings';
import { runOrchestratorSession } from './workflow-orchestrator-session';

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

function buildTranscriptSummary(sessionId: string): string {
  return listMessagesWithParts(sessionId)
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((entry) => {
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
    })
    .filter(Boolean)
    .join('\n\n');
}

export async function evaluateGoal(options: {
  sessionId: string;
  condition: string;
  turn: number;
  maxTurns: number;
  abortSignal?: AbortSignal;
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
}): Promise<GoalEvaluation> {
  console.log('[goal:evaluator] Starting evaluation', {
    sessionId: options.sessionId,
    turn: options.turn,
    conditionPreview: options.condition.slice(0, 80),
  });

  const transcript = buildTranscriptSummary(options.sessionId);
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
  const result = await runOrchestratorSession({
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
