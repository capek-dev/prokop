import type { MessageEvent, StepPart } from '@capekai/types';
import { createPart, updatePart } from '../storage/runtime';
import { createStepPart } from './part-utils';
import { randomUUID } from 'crypto';
import { getModelsConfig } from '../configuration/runtime';

interface StepUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
}

export interface UsageEventData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  noCacheTokens: number;
}

export interface StepCallbacksContext {
  messageId: string;
  sessionId: string;
  stepParts: StepPart[];
  yieldFn: ((event: CallbackEvent) => void) | null;
  isMainSession: boolean | null;
  contextWindow: number | undefined;
  autoThreshold: number;
  resolvedModelId: string | undefined;
  variant: string | undefined;
  needsCompaction: boolean;
  latestUsage: UsageEventData;
}

export type CallbackEvent = MessageEvent | {
  type: 'usage';
  usage: UsageEventData;
  model: string;
  variant: string | null;
};

export function createStepCallbacks(ctx: StepCallbacksContext) {
  return {
    experimental_onStepStart: async (stepStartEvent: { stepNumber: number }) => {
      const stepNumber = stepStartEvent.stepNumber + 1;

      const startedStepPart = createStepPart({
        messageId: ctx.messageId,
        sessionId: ctx.sessionId,
        number: stepNumber,
        status: 'started',
      });
      ctx.stepParts.push(startedStepPart);

      if (ctx.yieldFn) {
        ctx.yieldFn({ type: 'part.created', sessionId: ctx.sessionId, part: startedStepPart });
      }
      await createPart(startedStepPart, ctx.sessionId);
    },
    onStepFinish: async (stepFinishEvent: { stepNumber: number; finishReason: string | null; usage?: StepUsage; totalUsage?: StepUsage }) => {
      const stepNumber = stepFinishEvent.stepNumber + 1;

      const stepUsage = stepFinishEvent.usage;
      const stepPromptTokens = stepUsage?.inputTokens ?? 0;
      const stepCompletionTokens = stepUsage?.outputTokens ?? 0;
      const stepCacheReadTokens = stepUsage?.inputTokenDetails?.cacheReadTokens ?? 0;
      const stepCacheWriteTokens = stepUsage?.inputTokenDetails?.cacheWriteTokens ?? 0;
      const stepNoCacheTokens = stepUsage?.inputTokenDetails?.noCacheTokens ?? 0;

      if (ctx.isMainSession && ctx.contextWindow) {
        const latestStepInputTokens = stepUsage?.inputTokens ?? 0;
        if (latestStepInputTokens >= ctx.autoThreshold) {
          ctx.needsCompaction = true;
        }
      }

      let finishReason: 'stop' | 'tool-calls' | 'error' | 'length' | undefined;
      if (stepFinishEvent.finishReason) {
        if (stepFinishEvent.finishReason === 'stop') {
          finishReason = 'stop';
        } else if (stepFinishEvent.finishReason === 'tool-calls') {
          finishReason = 'tool-calls';
        } else if (stepFinishEvent.finishReason === 'length') {
          finishReason = 'length';
        } else if (stepFinishEvent.finishReason === 'error' || stepFinishEvent.finishReason === 'other') {
          finishReason = 'error';
        }
      }

      const existingStepPart = ctx.stepParts.find(sp => sp.number === stepNumber);

      const finishedStepPart: StepPart = {
        id: existingStepPart?.id || randomUUID(),
        messageId: ctx.messageId,
        createdAt: existingStepPart?.createdAt || Date.now(),
        type: 'step',
        number: stepNumber,
        status: 'finished',
        finishReason,
        tokens: {
          prompt: stepPromptTokens,
          completion: stepCompletionTokens,
          cacheRead: stepCacheReadTokens,
          cacheWrite: stepCacheWriteTokens,
          noCache: stepNoCacheTokens,
        },
      };

      if (existingStepPart) {
        const index = ctx.stepParts.indexOf(existingStepPart);
        ctx.stepParts[index] = finishedStepPart;
      } else {
        ctx.stepParts.push(finishedStepPart);
      }

      if (ctx.yieldFn) {
        ctx.yieldFn({ type: 'part.updated', sessionId: ctx.sessionId, part: finishedStepPart });
      }
      await updatePart(finishedStepPart.id, {
        status: finishedStepPart.status,
        finishReason: finishedStepPart.finishReason,
        tokens: finishedStepPart.tokens,
      });

      if (stepUsage) {
        ctx.latestUsage.promptTokens = stepUsage.inputTokens ?? 0;
        ctx.latestUsage.completionTokens = stepUsage.outputTokens ?? 0;
        ctx.latestUsage.totalTokens = stepUsage.totalTokens ?? 0;
        ctx.latestUsage.cacheReadTokens = stepUsage.inputTokenDetails?.cacheReadTokens ?? 0;
        ctx.latestUsage.cacheWriteTokens = stepUsage.inputTokenDetails?.cacheWriteTokens ?? 0;
        ctx.latestUsage.noCacheTokens = stepUsage.inputTokenDetails?.noCacheTokens ?? 0;

        if (ctx.yieldFn) {
          ctx.yieldFn({
            type: 'usage',
            usage: {
              promptTokens: ctx.latestUsage.promptTokens,
              completionTokens: ctx.latestUsage.completionTokens,
              totalTokens: ctx.latestUsage.totalTokens,
              cacheReadTokens: ctx.latestUsage.cacheReadTokens,
              cacheWriteTokens: ctx.latestUsage.cacheWriteTokens,
              noCacheTokens: ctx.latestUsage.noCacheTokens,
            },
            model: ctx.resolvedModelId ?? getModelsConfig().defaultModel,
            variant: ctx.variant ?? null,
          });
        }
      }
    },
  };
}
