import { jsonSchema, tool, type Tool as AiTool } from 'ai';
import type { LoadedTool, ToolContext, ToolDefinition, ToolResult } from '@jean2/sdk';
import type { ToolOutputArtifactFormat, ToolOutputArtifactPage } from '../storage/contracts';
import { createToolOutputArtifact, getToolOutputArtifactPage } from '../storage/runtime';
import type { ToolMap } from '../core/tool-builders/types';

export const RETRIEVE_TOOL_OUTPUT_NAME = 'retrieve-tool-output';
export const TOOL_OUTPUT_THRESHOLD_CHARS = 50_000;
export const TOOL_OUTPUT_PREVIEW_CHARS = 10_000;

export interface ToolOutputArtifactReference {
  type: 'tool-output-artifact';
  artifactId: string;
  preview: string;
  format: ToolOutputArtifactFormat;
  totalChars: number;
  complete: false;
  message: string;
}

export interface ToolOutputFallback {
  type: 'tool-output-preview';
  preview: string;
  totalChars: number | null;
  complete: false;
  message: string;
}

export interface ToolOutputPolicyContext {
  sessionId: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
}

const outputPolicyWrappedTools = new WeakSet<object>();

const retrievalDefinition: ToolDefinition = {
  name: RETRIEVE_TOOL_OUTPUT_NAME,
  description: 'Retrieve one bounded character page from an exact tool output artifact in the current session.',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', format: 'uuid' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1 },
    },
    required: ['artifactId'],
  },
  timeout: 30_000,
};

export function isToolOutputArtifactReference(value: unknown): value is ToolOutputArtifactReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === 'tool-output-artifact'
    && typeof record.artifactId === 'string'
    && typeof record.preview === 'string'
    && (record.format === 'json' || record.format === 'text')
    && typeof record.totalChars === 'number'
    && record.complete === false;
}

function withVisualization(value: unknown, visualization: unknown): unknown {
  if (visualization === undefined || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { ...value as Record<string, unknown>, _visualization: visualization };
}

function boundedFallback(value: unknown, totalChars: number | null): ToolOutputFallback {
  let preview: string;
  try {
    preview = typeof value === 'string' ? value : String(value);
  } catch {
    preview = '[Tool output could not be serialized]';
  }
  return {
    type: 'tool-output-preview',
    preview: preview.slice(0, TOOL_OUTPUT_PREVIEW_CHARS),
    totalChars,
    complete: false,
    message: 'Exact tool output was not persisted. Only this bounded preview is available.',
  };
}

export function applyToolOutputPolicy(result: unknown, context: ToolOutputPolicyContext): unknown {
  const visualization = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)._visualization
    : undefined;
  const exact = result;
  let serialized: string;
  let content: string;
  let format: ToolOutputArtifactFormat;
  try {
    serialized = JSON.stringify(exact, (key, value) => key === '_visualization' ? undefined : value);
    if (serialized === undefined) throw new TypeError('Tool output is not JSON serializable');
    format = typeof exact === 'string' ? 'text' : 'json';
    content = format === 'text' ? exact as string : serialized;
  } catch {
    return withVisualization(boundedFallback(exact, null), visualization);
  }
  if (serialized.length <= TOOL_OUTPUT_THRESHOLD_CHARS) return result;

  const preview = content.slice(0, TOOL_OUTPUT_PREVIEW_CHARS);
  try {
    const artifact = createToolOutputArtifact({
      sessionId: context.sessionId,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      toolCallId: context.toolCallId,
      toolName: context.toolName,
      content,
      format,
    });
    const reference: ToolOutputArtifactReference = {
      type: 'tool-output-artifact',
      artifactId: artifact.id,
      preview,
      format,
      totalChars: artifact.size,
      complete: false,
      message: `Exact output is available with ${RETRIEVE_TOOL_OUTPUT_NAME} using artifactId ${artifact.id}.`,
    };
    return withVisualization(reference, visualization);
  } catch {
    return withVisualization(boundedFallback(preview, content.length), visualization);
  }
}

export function retrieveToolOutput(
  sessionId: string,
  input: { artifactId: string; offset?: number; limit?: number },
): ToolOutputArtifactPage | null {
  return getToolOutputArtifactPage(sessionId, input.artifactId, input.offset, input.limit);
}

async function executeRetrieval(
  input: Record<string, unknown>,
  sessionId: string,
): Promise<ToolResult> {
  const page = retrieveToolOutput(sessionId, {
    artifactId: String(input.artifactId ?? ''),
    ...(input.offset === undefined ? {} : { offset: Number(input.offset) }),
    ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
  });
  return page
    ? { success: true, result: page }
    : { success: false, error: 'Tool output artifact not found' };
}

export const retrieveToolOutputStandardTool: LoadedTool = {
  definition: retrievalDefinition,
  path: 'builtin:@capekai/core',
  execute: (input: Record<string, unknown>, context: ToolContext) => executeRetrieval(input, context.sessionId),
};

export function buildRetrieveToolOutputAiTool(sessionId: string): AiTool {
  return tool({
    description: retrievalDefinition.description,
    inputSchema: jsonSchema(retrievalDefinition.inputSchema),
    execute: async (input: Record<string, unknown>) => {
      const result = await executeRetrieval(input, sessionId);
      return result.success ? result.result : { error: result.error };
    },
  });
}

export function wrapToolsWithOutputPolicy(
  tools: ToolMap,
  context: Pick<ToolOutputPolicyContext, 'sessionId' | 'workspaceId'>,
): ToolMap {
  const wrapped: ToolMap = {};
  for (const [toolName, original] of Object.entries(tools)) {
    const execute = original.execute;
    if (toolName === RETRIEVE_TOOL_OUTPUT_NAME || typeof execute !== 'function' || outputPolicyWrappedTools.has(original)) {
      wrapped[toolName] = original;
      continue;
    }
    const policyWrapped = {
      ...original,
      execute: async (...args: unknown[]) => {
        const result = await (execute as (...executeArgs: unknown[]) => unknown).apply(original, args);
        const options = args[1];
        const toolCallId = options && typeof options === 'object'
          ? (options as { toolCallId?: unknown }).toolCallId
          : undefined;
        if (typeof toolCallId !== 'string' || !toolCallId) return result;
        return applyToolOutputPolicy(result, {
          ...context,
          toolCallId,
          toolName,
        });
      },
    } as AiTool;
    outputPolicyWrappedTools.add(policyWrapped);
    wrapped[toolName] = policyWrapped;
  }
  return wrapped;
}
