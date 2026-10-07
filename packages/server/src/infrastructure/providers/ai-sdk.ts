import { createOpenAI } from '@ai-sdk/openai';
import {
  wrapLanguageModel,
  dynamicTool,
  jsonSchema,
  streamText,
  type JSONSchema7,
  type Tool,
} from 'ai';
import { getModelWithMetadata } from '@/infrastructure/providers/model-resolution';
import { openAiModelOmitsTemperature } from '@/infrastructure/providers/model-selection';
import type { ModelFactoryResult } from '@/infrastructure/providers/types';
import { codexNetworkRetryMiddleware } from '@/infrastructure/providers/codex-network-retry';

export interface TextModelRequest {
  modelId?: string;
  providerId?: string;
  systemPrompt: string;
  prompt: string;
  sessionId?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export async function runTextModel(request: TextModelRequest): Promise<string> {
  const { model, omitMaxOutputTokens, omitTemperature, providerOptions, useProviderInstructions } = await getModelWithMetadata({
    modelId: request.modelId,
    providerId: request.providerId,
    systemPrompt: request.systemPrompt,
    sessionId: request.sessionId,
  });
  const stream = streamText({
    model,
    system: useProviderInstructions ? undefined : request.systemPrompt,
    prompt: request.prompt,
    ...(omitMaxOutputTokens || request.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: request.maxOutputTokens }),
    ...(omitTemperature ? {} : { temperature: request.temperature }),
    providerOptions: providerOptions as Parameters<typeof streamText>[0]['providerOptions'],
  });
  return stream.text;
}

export interface OpenAiResponsesModelRequest {
  modelId: string;
  apiKey: string;
  fetch: typeof globalThis.fetch;
  systemPrompt?: string;
  sessionId?: string;
}

export function createOpenAiResponsesModel(request: OpenAiResponsesModelRequest): ModelFactoryResult {
  const openai = createOpenAI({
    apiKey: request.apiKey,
    fetch: request.fetch,
  });
  return {
    model: wrapLanguageModel({
      model: openai.responses(request.modelId),
      middleware: codexNetworkRetryMiddleware,
    }),
    useProviderInstructions: true,
    omitMaxOutputTokens: true,
    omitTemperature: openAiModelOmitsTemperature(request.modelId),
    providerOptions: {
      openai: {
        instructions: request.systemPrompt || 'You are a helpful assistant.',
        promptCacheKey: request.sessionId,
        store: false,
      },
    },
  };
}

export interface CapabilityToolRequest {
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: unknown): Promise<unknown>;
}

export function createCapabilityTool(request: CapabilityToolRequest): Tool {
  return dynamicTool({
    description: request.description,
    inputSchema: jsonSchema(request.inputSchema as JSONSchema7),
    execute: request.execute,
  });
}

export type CapabilityTool = Tool;
