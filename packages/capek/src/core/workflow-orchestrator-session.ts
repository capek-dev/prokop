import { randomUUID } from 'crypto';
import { streamText } from 'ai';
import type { AssistantMessage, TextPart, UserMessage } from '@jean2/sdk';
import {
  broadcastEvent,
  broadcastSessionCreated,
  broadcastSessionUpdated,
  getModelsConfig,
} from '../compat/jean2-dependencies';
import {
  createMessage,
  createPart,
  createSession,
  getSession,
  getWorkspaceAutoApproveSeverity,
  updateSession,
} from '../storage/runtime';
import type { BroadcastFn, BroadcastSessionFn } from '../compat/bindings';
import { getModelWithMetadata } from './model-utils';
import { extractJsonFromText } from './structured-output';

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
    broadcast = broadcastEvent,
    broadcastSessionCreated: broadcastSessCreated = broadcastSessionCreated,
    broadcastSessionUpdated: broadcastSessUpdated = broadcastSessionUpdated,
  } = options;
  const parentSession = getSession(parentSessionId);
  const config = getModelsConfig();
  const modelId = parentSession?.selectedModel || config.defaultModel;
  const providerId = parentSession?.selectedProvider || config.defaultProvider;
  const session = createSession({
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
    autoApproveSeverity: getWorkspaceAutoApproveSeverity(parentSession?.workspaceId || ''),
  });
  broadcastSessCreated(session);
  console.log(`[workflow:${agentName}] Session created`, { sessionId: session.id, modelId, providerId });

  try {
    const userMsgId = randomUUID();
    const userMessage: UserMessage = { id: userMsgId, sessionId: session.id, role: 'user', createdAt: Date.now() };
    const userTextPart: TextPart = { id: randomUUID(), messageId: userMsgId, createdAt: Date.now(), type: 'text', text: userPrompt };
    createMessage(userMessage);
    createPart(userTextPart, session.id);
    broadcast({ type: 'message.created', message: userMessage });
    broadcast({ type: 'part.created', sessionId: session.id, part: userTextPart });

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
    createMessage(assistantMessage);
    createPart(assistantTextPart, session.id);
    broadcast({ type: 'message.created', message: assistantMessage });
    broadcast({ type: 'part.created', sessionId: session.id, part: assistantTextPart });
    updateSession(session.id, { subagentStatus: 'completed' });
    const updatedSession = getSession(session.id);
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

    updateSession(session.id, { subagentStatus: abortSignal?.aborted ? 'interrupted' : 'error' });
    const updatedSession = getSession(session.id);
    if (updatedSession) broadcastSessUpdated(updatedSession);
    throw err;
  }
}
