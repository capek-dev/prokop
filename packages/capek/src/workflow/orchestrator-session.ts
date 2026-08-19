import { randomUUID } from 'crypto';
import { streamText } from 'ai';
import type { AssistantMessage, TextPart, UserMessage } from '@capekai/types';
import {
  emitRuntimeEvent,
  emitSessionCreated,
  emitSessionUpdated,
} from '../runtime/host-dependencies';
import { getModelsConfig } from '../configuration/runtime';
import {
  createMessage,
  createPart,
  createSession,
  getSession,
  getWorkspaceAutoApproveSeverity,
  updateSession,
} from '../storage/runtime';
import type { BroadcastFn, BroadcastSessionFn } from '../runtime/host';
import { getModelWithMetadata } from '../core/model-utils';
import { extractJsonFromText } from '../core/structured-output';

/**
 * Workflow domain: the shared workflow/goals orchestrator model-turn
 * service implementation. Moved verbatim from `core/workflow-orchestrator-
 * session.ts`; the named contract (`capek.orchestrator-session`) lives in
 * `plugins/service-keys.ts` and `plugins/orchestrator-session.ts` provides
 * this implementation, so the goals slice consumes the same contract
 * without owning workflow code. The two core edges below
 * (model-utils, structured-output) stay until C7.
 */

export interface OrchestratorSessionOptions {
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

export interface OrchestratorSessionResult {
  text: string;
  json: Record<string, unknown> | null;
  sessionId: string;
}

export async function runOrchestratorSession(options: OrchestratorSessionOptions): Promise<OrchestratorSessionResult> {
  const {
    parentSessionId,
    title,
    agentName,
    systemPrompt,
    userPrompt,
    maxTokens = 4096,
    abortSignal,
    broadcast = emitRuntimeEvent,
    broadcastSessionCreated: broadcastSessCreated = emitSessionCreated,
    broadcastSessionUpdated: broadcastSessUpdated = emitSessionUpdated,
  } = options;
  const parentSession = await getSession(parentSessionId);
  const config = getModelsConfig();
  const modelId = parentSession?.selectedModel || config.defaultModel;
  const providerId = parentSession?.selectedProvider || config.defaultProvider;
  const session = await createSession({
    id: randomUUID(),
    workspaceId: parentSession?.workspaceId || '',
    preconfigId: null,
    title,
    status: 'active',
    metadata: null,
    parentId: parentSessionId,
    agentName,
    subagentStatus: 'running',
    selectedModel: modelId,
    selectedProvider: providerId,
    autoApproveSeverity: await getWorkspaceAutoApproveSeverity(parentSession?.workspaceId || ''),
  });
  broadcastSessCreated(session);
  console.log(`[workflow:${agentName}] Session created`, { sessionId: session.id, modelId, providerId });

  try {
    const userMsgId = randomUUID();
    const userMessage: UserMessage = { id: userMsgId, sessionId: session.id, role: 'user', createdAt: Date.now() };
    const userTextPart: TextPart = { id: randomUUID(), messageId: userMsgId, createdAt: Date.now(), type: 'text', text: userPrompt };
    await createMessage(userMessage);
    await createPart(userTextPart, session.id);
    broadcast({ kind: 'message', action: 'created', message: userMessage });
    broadcast({ kind: 'part', action: 'created', sessionId: session.id, part: userTextPart });

    const { model, omitMaxOutputTokens, providerOptions, useProviderInstructions } = await getModelWithMetadata({
      modelId,
      providerId,
      systemPrompt,
      sessionId: parentSessionId,
    });
    console.log(`[workflow:${agentName}] Calling streamText...`);
    const stream = streamText({
      model,
      system: useProviderInstructions ? undefined : systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxOutputTokens: omitMaxOutputTokens ? undefined : maxTokens,
      providerOptions: providerOptions as unknown as Parameters<typeof streamText>[0]['providerOptions'],
      abortSignal,
    });
    const text = await stream.text;
    const streamUsage = await stream.usage;
    console.log(`[workflow:${agentName}] streamText returned`, { textLength: text?.length });
    const assistantMsgId = randomUUID();
    const assistantTextPart: TextPart = { id: randomUUID(), messageId: assistantMsgId, createdAt: Date.now(), type: 'text', text };
    const parsedJson = extractJsonFromText(text);
    const assistantMessage: AssistantMessage = {
      id: assistantMsgId,
      sessionId: session.id,
      role: 'assistant',
      status: 'completed',
      modelId,
      providerId,
      agent: agentName,
      tokens: {
        prompt: streamUsage?.inputTokens ?? 0,
        completion: streamUsage?.outputTokens ?? 0,
        cacheRead: streamUsage?.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWrite: streamUsage?.inputTokenDetails.cacheWriteTokens ?? 0,
        noCache: streamUsage?.inputTokenDetails.noCacheTokens ?? 0,
      },
      cost: 0,
      createdAt: Date.now(),
      completedAt: Date.now(),
      ...(parsedJson ? { structuredOutput: { formatName: title, data: parsedJson } } : {}),
    };
    await createMessage(assistantMessage);
    await createPart(assistantTextPart, session.id);
    broadcast({ kind: 'message', action: 'created', message: assistantMessage });
    broadcast({ kind: 'part', action: 'created', sessionId: session.id, part: assistantTextPart });
    await updateSession(session.id, { subagentStatus: 'completed' });
    const updatedSession = await getSession(session.id);
    if (updatedSession) broadcastSessUpdated(updatedSession);
    return { text, json: parsedJson, sessionId: session.id };
  } catch (err) {
    const errAny = err as Record<string, unknown>;
    console.error(`[workflow:${agentName}] FAILED`, {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
      statusCode: errAny?.statusCode ?? errAny?.status,
      url: errAny?.url,
      responseBody: errAny?.responseBody ?? errAny?.response,
      data: errAny?.data,
      cause: err instanceof Error ? err.cause : undefined,
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
    });

    await updateSession(session.id, { subagentStatus: abortSignal?.aborted ? 'interrupted' : 'error' });
    const updatedSession = await getSession(session.id);
    if (updatedSession) broadcastSessUpdated(updatedSession);
    throw err;
  }
}
