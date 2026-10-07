import type { JSONValue, Tool } from 'ai';
import type { ToolModelOutputPart } from '@prokopai/sdk/types';

type AiSdkToolResultOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>;

const CAPEK_TOOL_OUTPUT_TYPE = 'capek-tool-output';

export interface CapekToolOutputEnvelope {
  type: typeof CAPEK_TOOL_OUTPUT_TYPE;
  value: unknown;
  modelOutput: ToolModelOutputPart[];
}

function isToolModelOutputPart(value: unknown): value is ToolModelOutputPart {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const part = value as Record<string, unknown>;
  if (part.type === 'text') {
    return typeof part.text === 'string';
  }
  if (part.type === 'image') {
    return typeof part.data === 'string'
      && part.data.length > 0
      && !part.data.startsWith('data:')
      && typeof part.mediaType === 'string'
      && part.mediaType.startsWith('image/');
  }
  return false;
}

export function normalizeToolModelOutput(value: unknown): ToolModelOutputPart[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isToolModelOutputPart)) {
    return undefined;
  }
  return value;
}

export function createCapekToolOutputEnvelope(
  value: unknown,
  modelOutput: unknown,
): unknown {
  const normalized = normalizeToolModelOutput(modelOutput);
  return normalized
    ? { type: CAPEK_TOOL_OUTPUT_TYPE, value, modelOutput: normalized }
    : value;
}

export function isCapekToolOutputEnvelope(value: unknown): value is CapekToolOutputEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === CAPEK_TOOL_OUTPUT_TYPE
    && 'value' in record
    && normalizeToolModelOutput(record.modelOutput) !== undefined;
}

export function toolModelOutputToAiSdk(parts: ToolModelOutputPart[]): AiSdkToolResultOutput {
  return {
    type: 'content',
    value: parts.map((part) => part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : {
          type: 'image-data' as const,
          data: part.data,
          mediaType: part.mediaType,
        }),
  };
}

export function capekToolOutputToAiSdk(output: unknown): AiSdkToolResultOutput {
  if (isCapekToolOutputEnvelope(output)) {
    return toolModelOutputToAiSdk(output.modelOutput);
  }
  return typeof output === 'string'
    ? { type: 'text', value: output }
    : { type: 'json', value: (output ?? null) as JSONValue };
}
