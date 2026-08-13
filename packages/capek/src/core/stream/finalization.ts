import type { LanguageModelUsage } from 'ai';
import { extractJsonFromText } from '../structured-output';
import type { StructuredOutputData, ResponseFormat } from '@jean2/sdk';

export interface FinalizationData {
  usageData: LanguageModelUsage | null;
  structuredOutputData: StructuredOutputData | undefined;
}

export interface FinalizationOptions {
  result: {
    totalUsage: PromiseLike<LanguageModelUsage>;
    usage: PromiseLike<LanguageModelUsage | undefined>;
    output: PromiseLike<unknown>;
  };
  responseFormat?: ResponseFormat;
  usePromptBasedStructuredOutput: boolean;
  accumulatedText: string;
}

export async function extractFinalizationData(options: FinalizationOptions): Promise<FinalizationData> {
  const { result, responseFormat, usePromptBasedStructuredOutput, accumulatedText } = options;

  let usageData: LanguageModelUsage | null = null;
  let structuredOutputData: StructuredOutputData | undefined;

  try {
    const totalUsagePromise = result.totalUsage;
    const usagePromise = result.usage;
    const [totalUsage, usage] = await Promise.all([totalUsagePromise, usagePromise]);
    usageData = usage ?? totalUsage;

    if (responseFormat) {
      try {
        if (usePromptBasedStructuredOutput) {
          const parsed = extractJsonFromText(accumulatedText);
          if (parsed) {
            structuredOutputData = {
              formatName: responseFormat.name,
              data: parsed,
              schema: responseFormat.schema,
            };
          } else {
            console.warn('Failed to parse structured output from text response');
          }
        } else {
          const output = await result.output;
          if (output && typeof output === 'object') {
            structuredOutputData = {
              formatName: responseFormat.name,
              data: output as Record<string, unknown>,
              schema: responseFormat.schema,
            };
          }
        }
      } catch (_outputErr) {
        console.warn('Failed to get structured output:', _outputErr);
      }
    }
  } catch (_usageErr) {
    console.warn('Failed to get usage data:', _usageErr);
  }

  return { usageData, structuredOutputData };
}
