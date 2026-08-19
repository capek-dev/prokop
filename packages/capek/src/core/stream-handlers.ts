import type { TextPart, ToolPart, ReasoningPart, MessageEvent } from '@capekai/types';
import { createPart, updatePart, getPart, persistStreamingPartSnapshots } from '../storage/runtime';
import { parseToolInput } from './part-utils';
import { randomUUID } from 'crypto';

const STREAM_PART_PERSIST_INTERVAL_MS = 300;

export interface StreamHandlerContext {
  messageId: string;
  sessionId: string;
  toolParts: ToolPart[];
  currentText: string;
  currentTextPartId: string | null;
  currentTextCreatedAt: number | null;
  currentReasoning: string;
  currentReasoningPartId: string | null;
  currentReasoningCreatedAt: number | null;
  yieldFn: (event: MessageEvent) => void;
}

interface StreamPersistenceState {
  persistedText: string;
  persistedReasoning: string;
  lastTextPersistedAt: number;
  lastReasoningPersistedAt: number;
}

export function createStreamHandlers(ctx: StreamHandlerContext) {
  const persistence: StreamPersistenceState = {
    persistedText: '',
    persistedReasoning: '',
    lastTextPersistedAt: 0,
    lastReasoningPersistedAt: 0,
  };

  function shouldPersist(lastPersistedAt: number): boolean {
    return Date.now() - lastPersistedAt >= STREAM_PART_PERSIST_INTERVAL_MS;
  }

  async function persistText(syncFts: boolean): Promise<void> {
    if (!ctx.currentTextPartId || ctx.currentText === persistence.persistedText) return;
    if (syncFts) {
      // Final flush persists the complete text; message finalization performs explicit FTS sync.
      await updatePart(ctx.currentTextPartId, { text: ctx.currentText }, { syncFts: false });
      persistence.persistedText = ctx.currentText;
      persistence.lastTextPersistedAt = Date.now();
    } else {
      // Intermediate snapshot: no read-before-write
      await persistStreamingPartSnapshots([{
        id: ctx.currentTextPartId,
        messageId: ctx.messageId,
        sessionId: ctx.sessionId,
        type: 'text',
        createdAt: ctx.currentTextCreatedAt ?? Date.now(),
        text: ctx.currentText,
      }]);
      persistence.persistedText = ctx.currentText;
      persistence.lastTextPersistedAt = Date.now();
    }
  }

  async function persistReasoning(syncFts: boolean): Promise<void> {
    if (!ctx.currentReasoningPartId || ctx.currentReasoning === persistence.persistedReasoning) return;
    if (syncFts) {
      await updatePart(ctx.currentReasoningPartId, { text: ctx.currentReasoning }, { syncFts: false });
      persistence.persistedReasoning = ctx.currentReasoning;
      persistence.lastReasoningPersistedAt = Date.now();
    } else {
      await persistStreamingPartSnapshots([{
        id: ctx.currentReasoningPartId,
        messageId: ctx.messageId,
        sessionId: ctx.sessionId,
        type: 'reasoning',
        createdAt: ctx.currentReasoningCreatedAt ?? Date.now(),
        text: ctx.currentReasoning,
      }]);
      persistence.persistedReasoning = ctx.currentReasoning;
      persistence.lastReasoningPersistedAt = Date.now();
    }
  }

  function resetTextState(): void {
    ctx.currentTextPartId = null;
    ctx.currentTextCreatedAt = null;
    ctx.currentText = '';
    persistence.persistedText = '';
    persistence.lastTextPersistedAt = 0;
  }

  function resetReasoningState(): void {
    ctx.currentReasoningPartId = null;
    ctx.currentReasoningCreatedAt = null;
    ctx.currentReasoning = '';
    persistence.persistedReasoning = '';
    persistence.lastReasoningPersistedAt = 0;
  }

  return {
    async handleTextDelta(delta: { text: string | undefined }): Promise<void> {
      const textContent = delta.text || '';
      if (textContent) {
        ctx.currentText += textContent;

        if (ctx.currentTextPartId) {
          ctx.yieldFn({ type: 'part.append', sessionId: ctx.sessionId, partId: ctx.currentTextPartId, field: 'text', delta: textContent });
          if (shouldPersist(persistence.lastTextPersistedAt)) {
            await persistText(false);
          }
        } else {
          ctx.currentTextPartId = randomUUID();
          ctx.currentTextCreatedAt = Date.now();
          const textPart: TextPart = {
            id: ctx.currentTextPartId,
            messageId: ctx.messageId,
            createdAt: ctx.currentTextCreatedAt,
            type: 'text',
            text: textContent,
          };
          ctx.yieldFn({ type: 'part.created', sessionId: ctx.sessionId, part: textPart });
          await createPart(textPart, ctx.sessionId, { syncFts: false });
          persistence.persistedText = textContent;
          persistence.lastTextPersistedAt = Date.now();
        }
      }
    },

    async handleReasoningDelta(delta: { text: string | undefined }): Promise<void> {
      const reasoningContent = delta.text || '';
      if (reasoningContent) {
        ctx.currentReasoning += reasoningContent;

        if (ctx.currentReasoningPartId) {
          ctx.yieldFn({ type: 'part.append', sessionId: ctx.sessionId, partId: ctx.currentReasoningPartId, field: 'reasoning', delta: reasoningContent });
          if (shouldPersist(persistence.lastReasoningPersistedAt)) {
            await persistReasoning(false);
          }
        } else {
          ctx.currentReasoningPartId = randomUUID();
          ctx.currentReasoningCreatedAt = Date.now();
          const reasoningPart: ReasoningPart = {
            id: ctx.currentReasoningPartId,
            messageId: ctx.messageId,
            createdAt: ctx.currentReasoningCreatedAt,
            type: 'reasoning',
            text: reasoningContent,
          };
          ctx.yieldFn({ type: 'part.created', sessionId: ctx.sessionId, part: reasoningPart });
          await createPart(reasoningPart, ctx.sessionId, { syncFts: false });
          persistence.persistedReasoning = reasoningContent;
          persistence.lastReasoningPersistedAt = Date.now();
        }
      }
    },

    async handleToolCall(delta: { toolCallId: string; toolName: string; input: unknown }): Promise<void> {
      await this.flushPending();

      const toolPartId = randomUUID();
      const toolPart: ToolPart = {
        id: toolPartId,
        messageId: ctx.messageId,
        createdAt: Date.now(),
        type: 'tool',
        callId: delta.toolCallId,
        name: delta.toolName,
        state: {
          status: 'pending',
          input: parseToolInput(delta.input),
        },
      };
      ctx.toolParts.push(toolPart);

      ctx.yieldFn({ type: 'part.created', sessionId: ctx.sessionId, part: toolPart });
      await createPart(toolPart, ctx.sessionId, { syncFts: false });

      resetTextState();
      resetReasoningState();
    },

    async handleToolResult(delta: { toolCallId: string; output: unknown }): Promise<void> {
      const existingToolPart = ctx.toolParts.find((tp) => tp.callId === delta.toolCallId);

      if (existingToolPart) {
        const latestPart = await getPart(existingToolPart.id) as ToolPart | null;
        const latestState = latestPart?.state;

        let resultData: unknown;
        if (typeof delta.output === 'string') {
          try {
            resultData = JSON.parse(delta.output);
          } catch {
            resultData = delta.output;
          }
        } else if (delta.output && typeof delta.output === 'object' && 'value' in delta.output) {
          resultData = (delta.output as { value: unknown }).value;
        } else {
          resultData = delta.output;
        }

        const isErrorResult = !!(resultData && typeof resultData === 'object' && 'error' in resultData);

        const existingChildSessionId = latestState && 'childSessionId' in latestState
          ? latestState.childSessionId
          : undefined;

        const updatedToolPart: ToolPart = {
          ...existingToolPart,
          state: isErrorResult
            ? {
                status: 'error' as const,
                input: existingToolPart.state.input,
                error: String((resultData as { error: unknown }).error),
                startedAt: Date.now(),
                failedAt: Date.now(),
                ...(existingChildSessionId && { childSessionId: existingChildSessionId }),
              }
            : {
                status: 'completed' as const,
                input: existingToolPart.state.input,
                output: resultData,
                startedAt: Date.now(),
                completedAt: Date.now(),
                ...(existingChildSessionId && { childSessionId: existingChildSessionId }),
              },
        };

        const index = ctx.toolParts.indexOf(existingToolPart);
        if (index !== -1) {
          ctx.toolParts[index] = updatedToolPart;
        }

        ctx.yieldFn({ type: 'part.updated', sessionId: ctx.sessionId, part: updatedToolPart });
        await updatePart(updatedToolPart.id, { state: updatedToolPart.state }, { syncFts: false });
      }
    },

    async flushPending(): Promise<void> {
      await persistText(true);
      await persistReasoning(true);
    },
  };
}
