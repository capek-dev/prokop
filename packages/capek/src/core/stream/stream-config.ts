import { Output, jsonSchema } from 'ai';
import { findModel, findModelVariant, getLLMTemperature, getLLMMaxSteps, getModelsConfig } from '../../configuration/runtime';
import { getProvider } from '../../providers/registry';
import { buildSchemaPromptInstruction } from '../structured-output';
import type { ResponseFormat } from '@capekai/types';

export interface StreamConfigResult {
  providerOptions: Record<string, Record<string, unknown>> | undefined;
  usePromptBasedStructuredOutput: boolean;
  streamOutput: ReturnType<typeof Output.object> | undefined;
  temperature: number;
  maxSteps: number;
  /** System message with structured output instruction appended (if prompt-based mode) */
  systemMessage: string;
}

export interface StreamConfigOptions {
  modelId: string | undefined;
  providerId: string | undefined;
  variant: string | undefined;
  systemMessage: string;
  baseProviderOptions: Record<string, Record<string, unknown>> | undefined;
  responseFormat?: ResponseFormat;
  temperature?: number;
  maxSteps?: number;
}

export function buildStreamConfig(options: StreamConfigOptions): StreamConfigResult {
  const {
    modelId,
    providerId,
    variant,
    systemMessage,
    baseProviderOptions,
    responseFormat,
    temperature,
    maxSteps,
  } = options;

  // Resolve variant providerOptions
  const variantOpts = variant ? findModelVariant(modelId || '', variant) : undefined;

  // Determine the provider-specific providerOptions key
  const resolvedProvider = providerId || getModelsConfig().defaultProvider;
  const registered = resolvedProvider ? getProvider(resolvedProvider) : undefined;
  const providerOptionsKey = registered?.descriptor.providerOptionsKey ?? resolvedProvider;

  // Build merged providerOptions
  let providerOptions: Record<string, Record<string, unknown>> | undefined;
  if (baseProviderOptions) {
    providerOptions = {
      ...baseProviderOptions,
      ...(variantOpts ? { [providerOptionsKey]: { ...(baseProviderOptions[providerOptionsKey] || {}), ...variantOpts } } : {}),
    };
  } else if (variantOpts) {
    providerOptions = { [providerOptionsKey]: variantOpts };
  }

  // Structured output handling
  const modelDef = modelId ? findModel(modelId) : undefined;
  const structuredOutputMode = modelDef?.capabilities?.structuredOutput?.mode ?? 'native';
  const usePromptBasedStructuredOutput: boolean =
    !!(responseFormat && structuredOutputMode === 'prompt');

  let finalSystemMessage = systemMessage;
  if (usePromptBasedStructuredOutput && responseFormat && systemMessage) {
    finalSystemMessage = systemMessage + '\n\n' + buildSchemaPromptInstruction(responseFormat);
  }

  const streamOutput = responseFormat && !usePromptBasedStructuredOutput
    ? Output.object({ schema: jsonSchema(responseFormat.schema) })
    : undefined;

  return {
    providerOptions,
    usePromptBasedStructuredOutput,
    streamOutput,
    temperature: temperature ?? getLLMTemperature(),
    maxSteps: maxSteps ?? getLLMMaxSteps(),
    systemMessage: finalSystemMessage,
  };
}
