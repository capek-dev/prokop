import { createOpenAI } from '@ai-sdk/openai';
import {
  dynamicTool,
  jsonSchema,
  streamText,
  type JSONSchema7,
  type LanguageModel,
  type Tool,
} from 'ai';
import { getModelWithMetadata } from '../core/model-utils';
import type { ModelFactoryResult } from '../providers/types';

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
  const { model, omitMaxOutputTokens, providerOptions, useProviderInstructions } = await getModelWithMetadata({
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
    temperature: request.temperature,
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
    model: openai.responses(request.modelId) as unknown as LanguageModel,
    useProviderInstructions: true,
    omitMaxOutputTokens: true,
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
