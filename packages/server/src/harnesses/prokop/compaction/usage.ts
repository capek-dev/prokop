import type { ModelMessage } from 'ai';

/** Approximation for new model-facing items not covered by provider usage yet.
 * Count serialized UTF-8 bytes, not the raw tool payload before projection. */
export function estimateMessageTokens(messages: readonly ModelMessage[]): number {
  return Math.ceil(new TextEncoder().encode(JSON.stringify(messages)).byteLength / 4);
}

export function estimateNextStepTokens(step: {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  response?: { messages: readonly ModelMessage[] };
}): number {
  const messages = step.response?.messages ?? [];
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistant = i;
      break;
    }
  }
  const appended = messages.slice(lastAssistant + 1);
  const usage = step.usage;
  return (usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)))
    + (appended.length ? estimateMessageTokens(appended) : 0);
}
