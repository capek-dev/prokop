import { streamText, stepCountIs } from 'ai';
import type { MessageWithParts, ToolPart, StepPart, Preconfig, MessageEvent, AssistantMessage, ResponseFormat } from '@capekai/types';
import { createMessage, updateMessage, getSession, updateSession, transitionToolToInterrupted, syncMessageFts } from '../storage/runtime';

import { findModel, getMaxOutputTokens, getModelsConfig } from '../configuration/runtime';
import { randomUUID } from 'crypto';
import { interruptManager } from './interrupt';
import { emitSessionUpdated } from '../runtime/host-dependencies';
import { rejectPendingAsksBySession } from '../permission/ask-user-api';
import { getModelWithMetadata } from './model-utils';

import { createStepCallbacks, type CallbackEvent, type UsageEventData } from './step-handlers';
import { createStreamHandlers } from './stream-handlers';
import { convertToAiSdkMessages } from './message-utils';
import { buildAiSdkTools, type BuildToolsOptions } from './build-tools';
import { getContextAssembler } from '../context/assembler';
import { getAgentDirectory } from '../context';
import { initializeWorkspaceDiscovery } from '../tools/tool-source';
import { resolveEffectiveSubagentTargets } from '../subagent/policy';
import { join } from 'path';

import { classifyApiError } from '../utils/errors';
import { createErrorEvent, type ErrorEvent } from './error-handling';
import type { CompactionPolicy } from '../compaction/contracts';
import { computeAutoThreshold } from '../compaction/policy';
import { buildStreamConfig } from './stream/stream-config';
import { extractFinalizationData } from './stream/finalization';

export interface ChatOptions {
  sessionId: string;
  preconfig: Preconfig;
  messages: MessageWithParts[];
  modelId?: string;
  providerId?: string;
  variant?: string;
  workspacePath?: string;
  workspaceId?: string;
  additionalPaths?: string[];
  maxSteps?: number;
  compactionPolicy?: CompactionPolicy;
  broadcastFn?: BuildToolsOptions['broadcastFn'];
  responseFormat?: ResponseFormat;
  retryAbortController?: AbortController;
}

async function collectInterruptedToolPartEvents(
  toolParts: ToolPart[],
  sessionId: string,
): Promise<MessageEvent[]> {
  const events: MessageEvent[] = [];
  for (const toolPart of toolParts) {
    if (toolPart.state.status === 'pending' || toolPart.state.status === 'running') {
      const updatedPart = await transitionToolToInterrupted(toolPart.id, 'user_request');
      if (updatedPart) {
        events.push({ type: 'part.updated', sessionId, part: updatedPart });
      }
    }
  }
  return events;
}

function buildInterruptedMessage(assistantMessage: AssistantMessage): AssistantMessage {
  return {
    ...assistantMessage,
    status: 'interrupted' as const,
    error: 'Interrupted by user',
  };
}

export interface ChatResult {
  message: AssistantMessage;
  toolCalls: ToolPart[];
}

export async function* streamChat(options: ChatOptions): AsyncGenerator<MessageEvent | { type: 'usage'; usage: UsageEventData; model: string; variant: string | null } | { type: 'needs_compaction'; sessionId: string } | ErrorEvent> {
  const { sessionId: _sessionId, preconfig, messages, modelId, providerId, variant, workspacePath, workspaceId, maxSteps, compactionPolicy } = options;

  const managesSessionLifecycle = !options.retryAbortController;
  const session = await getSession(_sessionId);
  const abortController = options.retryAbortController
    ?? interruptManager.registerSession(_sessionId, session?.parentId ?? undefined);

  // Initialize MCP for workspace
  if (workspacePath) {
    initializeWorkspaceDiscovery(workspacePath).catch((err: unknown) => {
      console.error('Failed to initialize MCP:', err);
    });
  }

  // Check if this is a main session (not a subagent) and set runningAt
  const isMainSession = session && !session.parentId;
  if (isMainSession && managesSessionLifecycle) {
    const updatedSession = await updateSession(_sessionId, { runningAt: new Date().toISOString() });
    if (updatedSession) {
      emitSessionUpdated(updatedSession);
    }
  }

  // Resolve model: session override > preconfig > env default
  const resolvedModelId = modelId || (preconfig.model ?? undefined);

  const toolNames = preconfig.tools || [];
  const resolvedProviderId = providerId;

  // Inject agent home directory as additional path if this is an agent
  const agentDir = await getAgentDirectory(preconfig.id);
  const effectiveAdditionalPaths = agentDir
    ? [...(options.additionalPaths || []), join(agentDir, 'home')]
    : options.additionalPaths;

  const aiTools = await buildAiSdkTools({
    toolNames,
    workspacePath,
    workspaceId,
    sessionId: _sessionId,
    modelId: resolvedModelId,
    providerId: resolvedProviderId,
    canSpawnSubagents: preconfig.canSpawnSubagents,
    allowSelfAsSubagent: preconfig.allowSelfAsSubagent,
    allowedSkills: preconfig.skills,
    broadcastFn: options.broadcastFn,
    additionalPaths: effectiveAdditionalPaths,
    agentId: preconfig.id,
  });

  const selfDelegationAvailable = Boolean(aiTools.task)
    && preconfig.allowSelfAsSubagent === true
    && (await resolveEffectiveSubagentTargets({
      sessionId: _sessionId,
      canSpawnSubagents: preconfig.canSpawnSubagents,
      allowSelfAsSubagent: true,
    })).some((candidate: { id: string }) => candidate.id === preconfig.id);

  // Build system message through the ordered context assembler contract
  const systemMessage = await getContextAssembler().build({
    preconfig,
    workspacePath,
    workspaceId,
    additionalPaths: effectiveAdditionalPaths,
    selfDelegationAvailable,
  });

  const { model, useProviderInstructions, omitMaxOutputTokens, providerOptions: baseProviderOptions } =
    await getModelWithMetadata({
      modelId: resolvedModelId,
      providerId,
      systemPrompt: systemMessage,
      sessionId: _sessionId,
    });

  // Compute auto-compaction threshold
  const { threshold: autoThreshold, contextWindow } = computeAutoThreshold(resolvedModelId, compactionPolicy);

  // Convert messages for ai-sdk
  const modelDef = resolvedModelId ? findModel(resolvedModelId) : undefined;
  const aiMessages = await convertToAiSdkMessages(messages, modelDef?.capabilities);

  // Build stream config (variants, providerOptions, structured output)
  const streamConfig = buildStreamConfig({
    modelId: resolvedModelId,
    providerId,
    variant,
    systemMessage,
    baseProviderOptions,
    responseFormat: options.responseFormat,
    temperature: preconfig.settings?.temperature as number | undefined,
    maxSteps,
  });

  const messageId = randomUUID();
  const stepCtx = {
    messageId,
    sessionId: _sessionId,
    stepParts: [] as StepPart[],
    yieldFn: null as ((event: CallbackEvent) => void) | null,
    isMainSession,
    contextWindow,
    autoThreshold,
    resolvedModelId,
    variant,
    needsCompaction: false,
    latestUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      noCacheTokens: 0,
    },
  };

  const { experimental_onStepStart, onStepFinish } = createStepCallbacks(stepCtx);

  const result = streamText({
    model,
    system: useProviderInstructions ? undefined : streamConfig.systemMessage,
    messages: aiMessages,
    tools: aiTools,
    maxOutputTokens: omitMaxOutputTokens ? undefined : getMaxOutputTokens(resolvedModelId),
    providerOptions: streamConfig.providerOptions as Parameters<typeof streamText>[0]['providerOptions'],
    temperature: streamConfig.temperature,
    stopWhen: stepCountIs(streamConfig.maxSteps),
    abortSignal: abortController.signal,
    experimental_onStepStart,
    onStepFinish,
    ...(streamConfig.streamOutput ? { output: streamConfig.streamOutput } : {}),
  });

  // Create assistant message
  const assistantMessage: AssistantMessage = {
    id: messageId,
    sessionId: _sessionId,
    role: 'assistant',
    status: 'streaming',
    createdAt: Date.now(),
    modelId: resolvedModelId || getModelsConfig().defaultModel,
    providerId: providerId || getModelsConfig().defaultProvider,
    tokens: { prompt: 0, completion: 0 },
    cost: 0,
  };

  await createMessage(assistantMessage);
  yield { type: 'message.created', message: assistantMessage };

  // Set up event queue for callbacks
  const eventQueue: Array<CallbackEvent> = [];
  stepCtx.yieldFn = (event) => { eventQueue.push(event); };

  const streamCtx = {
    messageId,
    sessionId: _sessionId,
    toolParts: [] as ToolPart[],
    currentText: '',
    currentTextPartId: null as string | null,
    currentTextCreatedAt: null as number | null,
    currentReasoning: '',
    currentReasoningPartId: null as string | null,
    currentReasoningCreatedAt: null as number | null,
    yieldFn: (event: MessageEvent) => { eventQueue.push(event); },
  };

  const handlers = createStreamHandlers(streamCtx);

  try {
    for await (const delta of result.fullStream) {
      if (abortController.signal.aborted) {
        await handlers.flushPending();
        for (const event of await collectInterruptedToolPartEvents(streamCtx.toolParts, _sessionId)) {
          yield event;
        }
        const interruptedMessage = buildInterruptedMessage(assistantMessage);
        yield { type: 'message.updated', message: interruptedMessage };
        await updateMessage(messageId, interruptedMessage, { syncFts: false });
        await syncMessageFts(messageId);
        return;
      }

      switch (delta.type) {
      case 'text-delta':
        await handlers.handleTextDelta(delta);
        break;
      case 'reasoning-delta':
        await handlers.handleReasoningDelta(delta);
        break;
      case 'tool-call':
        await handlers.handleToolCall(delta);
        break;
      case 'tool-result':
        await handlers.handleToolResult(delta);
        break;
      case 'error': {
        const error = (delta as { type: 'error'; error: unknown }).error;
        throw error;
      }
      }

      while (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        yield event;
      }
    }
    await handlers.flushPending();
  } catch (err) {
    await handlers.flushPending();
    const classified = classifyApiError(err);

    console.error('[streamChat] AI SDK error', {
      sessionId: _sessionId,
      model: resolvedModelId,
      provider: providerId,
      errorType: classified.type,
      errorMessage: classified.message,
      retryable: classified.retryable,
      rawError: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });

    if (abortController.signal.aborted) {
      for (const event of await collectInterruptedToolPartEvents(streamCtx.toolParts, _sessionId)) {
        yield event;
      }
      const interruptedMessage = buildInterruptedMessage(assistantMessage);
      yield { type: 'message.updated', message: interruptedMessage };
      await updateMessage(messageId, interruptedMessage, { syncFts: false });
      await syncMessageFts(messageId);
      return;
    }

    if (!classified.retryable) {
      const errorMessage: AssistantMessage = {
        ...assistantMessage,
        status: 'error',
        error: classified.message,
      };
      yield { type: 'message.updated', message: errorMessage };
      await updateMessage(messageId, errorMessage, { syncFts: false });
      await syncMessageFts(messageId);
      yield createErrorEvent(classified);
      return;
    }

    throw classified;
  } finally {
    if (managesSessionLifecycle) {
      interruptManager.unregisterSession(_sessionId);
      await rejectPendingAsksBySession(_sessionId);

      if (isMainSession) {
        const updatedSession = await updateSession(_sessionId, { runningAt: null });
        if (updatedSession) {
          emitSessionUpdated(updatedSession);
        }
      }
    }
  }

  // Extract finalization data (usage + structured output)
  const { usageData, structuredOutputData } = await extractFinalizationData({
    result,
    responseFormat: options.responseFormat,
    usePromptBasedStructuredOutput: streamConfig.usePromptBasedStructuredOutput,
    accumulatedText: streamCtx.currentText,
  });

  const finalMessage: AssistantMessage = {
    ...assistantMessage,
    status: 'completed',
    completedAt: Date.now(),
    tokens: {
      prompt: usageData?.inputTokens ?? 0,
      completion: usageData?.outputTokens ?? 0,
      cacheRead: usageData?.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWrite: usageData?.inputTokenDetails.cacheWriteTokens ?? 0,
      noCache: usageData?.inputTokenDetails.noCacheTokens ?? 0,
    },
    ...(structuredOutputData ? { structuredOutput: structuredOutputData } : {}),
  };

  yield { type: 'message.updated', message: finalMessage };

  // Sync FTS once after all final parts and message state are persisted
  await syncMessageFts(messageId);

  if (usageData) {
    yield {
      type: 'usage',
      usage: {
        promptTokens: stepCtx.latestUsage.promptTokens,
        completionTokens: stepCtx.latestUsage.completionTokens,
        totalTokens: stepCtx.latestUsage.totalTokens,
        cacheReadTokens: stepCtx.latestUsage.cacheReadTokens,
        cacheWriteTokens: stepCtx.latestUsage.cacheWriteTokens,
        noCacheTokens: stepCtx.latestUsage.noCacheTokens,
      },
      model: resolvedModelId || getModelsConfig().defaultModel,
      variant: variant || null,
    };
  }

  if (isMainSession && stepCtx.needsCompaction) {
    yield { type: 'needs_compaction', sessionId: _sessionId };
  }
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  let finalMessage: AssistantMessage | null = null;
  const toolCalls: ToolPart[] = [];

  for await (const event of streamChat(options)) {
    if (event.type === 'part.created' && event.part.type === 'tool') {
      toolCalls.push(event.part);
    }
    if (event.type === 'message.updated' && event.message.role === 'assistant') {
      finalMessage = event.message;
    }
  }

  return {
    message: finalMessage!,
    toolCalls,
  };
}
