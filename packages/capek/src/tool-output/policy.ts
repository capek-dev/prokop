/**
 * C6 tool-output policy default provider and scoped service.
 *
 * `createToolOutputService` reproduces the exact pre-C6 behavior: the
 * artifact envelope, the bounded fallback, the retrieval tool, the
 * per-service wrap WeakSet, and the legacy filesystem truncation. The
 * strict ID validation and session-scoped retrieval stay in the storage
 * layer (mandatory invariants); this service only decides what the model
 * sees and how retrieval is invoked.
 *
 * Scope ownership: a composed agent scope gets its own service instance
 * (frozen options and an isolated wrap WeakSet). Consumers that run outside
 * a composed scope (the current Jean2 server path) fall back to one lazily
 * created process-default service with the exact default constants, until
 * C8 retires the compat surface.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonSchema, tool, type Tool as AiTool } from 'ai';
import type { LoadedTool } from '@capekai/tool'
import { ToolContext, ToolDefinition, ToolResult } from '@capekai/tool';
import {
  createToolOutputArtifact,
  getToolOutputArtifactPage,
} from '../storage/runtime';
import type { ToolOutputArtifactFormat, ToolOutputArtifactPage } from '../storage/contracts';
import type {
  ToolOutputArtifactReference,
  ToolOutputArtifactService,
  ToolOutputFallback,
  ToolOutputPolicyContext,
  ToolOutputPolicyOptions,
} from './contracts';

export const TOOL_OUTPUT_THRESHOLD_CHARS = 50_000;
export const TOOL_OUTPUT_PREVIEW_CHARS = 10_000;
export const RETRIEVE_TOOL_OUTPUT_NAME = 'retrieve-tool-output';

export interface ToolOutputServiceCreateOptions {
  id?: string;
  /** Frozen composition-time options. When omitted (the process-default
   * fallback), the exact pre-C6 constants apply. */
  options?: ToolOutputPolicyOptions;
}

function defaultOptions(): ToolOutputPolicyOptions {
  return {
    thresholdChars: TOOL_OUTPUT_THRESHOLD_CHARS,
    previewChars: TOOL_OUTPUT_PREVIEW_CHARS,
    retrievalToolName: RETRIEVE_TOOL_OUTPUT_NAME,
    truncationMaxChars: 50_000,
    truncationPreviewChars: 10_000,
    truncationTempDir: path.join(os.tmpdir(), 'capek'),
  };
}

/** Pure envelope guard: an artifact reference must carry the strict type,
 * a string artifact id, a string preview, a json/text format, a numeric
 * total, and `complete: false`. */
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

function boundedFallback(value: unknown, totalChars: number | null, previewChars: number): ToolOutputFallback {
  let preview: string;
  try {
    preview = typeof value === 'string' ? value : String(value);
  } catch {
    preview = '[Tool output could not be serialized]';
  }
  return {
    type: 'tool-output-preview',
    preview: preview.slice(0, previewChars),
    totalChars,
    complete: false,
    message: 'Exact tool output was not persisted. Only this bounded preview is available.',
  };
}

const retrievalDefinitionBase: ToolDefinition = {
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

/** The C6 default provider wrapping the exact pre-C6 behavior. */
export function createToolOutputService(
  createOptions: ToolOutputServiceCreateOptions = {},
): ToolOutputArtifactService {
  const id = createOptions.id ?? 'tool-output.default';
  const options = createOptions.options ?? defaultOptions();
  const outputPolicyWrappedTools = new WeakSet<object>();

  async function applyToolOutputPolicy(result: unknown, context: ToolOutputPolicyContext): Promise<unknown> {
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
      return withVisualization(boundedFallback(exact, null, options.previewChars), visualization);
    }
    if (serialized.length <= options.thresholdChars) return result;

    const preview = content.slice(0, options.previewChars);
    try {
      const artifact = await createToolOutputArtifact({
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
        message: `Exact output is available with ${options.retrievalToolName} using artifactId ${artifact.id}.`,
      };
      return withVisualization(reference, visualization);
    } catch {
      return withVisualization(boundedFallback(preview, content.length, options.previewChars), visualization);
    }
  }

  async function retrieveToolOutput(
    sessionId: string,
    input: { artifactId: string; offset?: number; limit?: number },
  ): Promise<ToolOutputArtifactPage | null> {
    return getToolOutputArtifactPage(sessionId, input.artifactId, input.offset, input.limit);
  }

  async function executeRetrieval(
    input: Record<string, unknown>,
    sessionId: string,
  ): Promise<ToolResult> {
    // C6 step 6: the execution path uses the NON-REPLACEABLE runtime
    // retrieval, so a replaced provider can never return foreign pages.
    const page = await retrieveToolOutputForSession(sessionId, {
      artifactId: String(input.artifactId ?? ''),
      ...(input.offset === undefined ? {} : { offset: Number(input.offset) }),
      ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
    });
    return page
      ? { success: true, result: page }
      : { success: false, error: 'Tool output artifact not found' };
  }

  function createRetrieveToolOutputStandardTool(): LoadedTool {
    return {
      definition: retrievalDefinitionBase,
      path: 'builtin:@capekai/core',
      execute: (input: Record<string, unknown>, context: ToolContext) =>
        executeRetrieval(input, context.sessionId),
    };
  }

  function buildRetrieveToolOutputAiTool(sessionId: string): AiTool {
    return tool({
      description: retrievalDefinitionBase.description,
      inputSchema: jsonSchema(retrievalDefinitionBase.inputSchema),
      execute: async (input: Record<string, unknown>) => {
        const result = await executeRetrieval(input, sessionId);
        return result.success ? result.result : { error: result.error };
      },
    });
  }

  function wrapToolsWithOutputPolicy(
    tools: Record<string, AiTool>,
    context: Pick<ToolOutputPolicyContext, 'sessionId' | 'workspaceId'>,
  ): Record<string, AiTool> {
    const wrapped: Record<string, AiTool> = {};
    for (const [toolName, original] of Object.entries(tools)) {
      const execute = original.execute;
      if (toolName === options.retrievalToolName || typeof execute !== 'function' || outputPolicyWrappedTools.has(original)) {
        wrapped[toolName] = original;
        continue;
      }
      const policyWrapped = {
        ...original,
        execute: async (...args: unknown[]) => {
          const result = await (execute as (...executeArgs: unknown[]) => unknown).apply(original, args);
          const executeOptions = args[1];
          const toolCallId = executeOptions && typeof executeOptions === 'object'
            ? (executeOptions as { toolCallId?: unknown }).toolCallId
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

  function truncateToolResult(
    result: unknown,
    sessionId: string,
    toolName: string,
    outputDir: string = path.join(options.truncationTempDir, sessionId),
  ): unknown {
    const serialized = JSON.stringify(result);

    if (serialized.length <= options.truncationMaxChars) {
      return result;
    }

    const dir = outputDir;
    mkdirSync(dir, { recursive: true });

    const sanitizedToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = `${dir}/${sanitizedToolName}-${Date.now()}.json`;
    writeFileSync(filePath, serialized);

    if (typeof result === 'string') {
      const preview = result.slice(0, options.truncationPreviewChars);
      const note = `\n\n[Result truncated: ${result.length} chars total. Full result persisted to ${filePath}. Use read-file tool to read it.]`;
      return preview + note;
    }

    const truncatedJson = serialized.slice(0, options.truncationPreviewChars);

    try {
      const partialResult = JSON.parse(truncatedJson) as Record<string, unknown>;
      const note = `[Result truncated: ${serialized.length} chars total. Full result persisted to ${filePath}. Use read-file tool to read it.]`;

      if (partialResult && typeof partialResult === 'object' && !Array.isArray(partialResult)) {
        if (typeof partialResult.content === 'string') {
          partialResult.content = (partialResult.content as string).slice(0, options.truncationPreviewChars - note.length) + note;
        } else {
          partialResult._truncatedNote = note;
        }
        partialResult._persisted = true;
        partialResult._filePath = filePath;
        partialResult._originalSize = serialized.length;
        return partialResult;
      }

      return {
        ...partialResult,
        _persisted: true,
        _filePath: filePath,
        _originalSize: serialized.length,
      };
    } catch {
      return {
        content: truncatedJson + `\n\n[Result truncated: ${serialized.length} chars total. Full result persisted to ${filePath}. Use read-file tool to read it.]`,
        _persisted: true,
        _filePath: filePath,
        _originalSize: serialized.length,
      };
    }
  }

  return {
    id,
    options,
    applyToolOutputPolicy,
    retrieveToolOutput,
    buildRetrieveToolOutputAiTool,
    createRetrieveToolOutputStandardTool,
    wrapToolsWithOutputPolicy,
    truncateToolResult,
  } as ToolOutputArtifactService & { createRetrieveToolOutputStandardTool(): LoadedTool };
}

const scopedService = new AsyncLocalStorage<ToolOutputArtifactService>();
let processDefaultService: ToolOutputArtifactService | undefined;

/** Resolves the service seeded for the active agent scope, falling back to
 * one lazily created process-default service for consumers that run outside
 * a composed scope (the current Jean2 server path). The process default
 * carries the exact pre-C6 constants. */
export function getToolOutputService(): ToolOutputArtifactService {
  return scopedService.getStore()
    ?? (processDefaultService ??= createToolOutputService({ id: 'tool-output.process-default' }));
}

/** Seeds a service for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's service here. */
export function withToolOutputService<T>(service: ToolOutputArtifactService, callback: () => T): T {
  return scopedService.run(service, callback);
}

/** Test-only reset of the lazily created process default. Exported from this
 * module only; no package subpath re-exports it. */
export function resetDefaultToolOutputServiceForTests(): void {
  processDefaultService = undefined;
}

// ── Compatibility free functions over the scoped service ────────────────

/** NON-REPLACEABLE retrieval runtime: derives the caller session from the
 * execution context and performs strict UUID/session-scoped storage
 * retrieval itself. Provider advice (envelope/bounding) never controls
 * which artifact or session can be read. */
export function retrieveToolOutputForSession(
  sessionId: string,
  input: { artifactId: string; offset?: number; limit?: number },
): Promise<ToolOutputArtifactPage | null> {
  return getToolOutputArtifactPage(sessionId, input.artifactId, input.offset, input.limit);
}

/** Stable singleton factory over the non-replaceable retrieval runtime. */
export function getRetrieveToolOutputStandardTool(): LoadedTool {
  return {
    definition: retrievalDefinitionBase,
    path: 'builtin:@capekai/core',
    execute: async (input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
      const page = await retrieveToolOutputForSession(context.sessionId, {
        artifactId: String(input.artifactId ?? ''),
        ...(input.offset === undefined ? {} : { offset: Number(input.offset) }),
        ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
      });
      return page
        ? { success: true, result: page }
        : { success: false, error: 'Tool output artifact not found' };
    },
  };
}

/** Stable singleton used by the standard coding capability inventory. */
export const retrieveToolOutputStandardTool: LoadedTool = getRetrieveToolOutputStandardTool();

export async function applyToolOutputPolicy(result: unknown, context: ToolOutputPolicyContext): Promise<unknown> {
  return getToolOutputService().applyToolOutputPolicy(result, context);
}

export async function retrieveToolOutput(
  sessionId: string,
  input: { artifactId: string; offset?: number; limit?: number },
): Promise<ToolOutputArtifactPage | null> {
  return getToolOutputService().retrieveToolOutput(sessionId, input);
}

export function wrapToolsWithOutputPolicy(
  tools: Record<string, AiTool>,
  context: Pick<ToolOutputPolicyContext, 'sessionId' | 'workspaceId'>,
): Record<string, AiTool> {
  return getToolOutputService().wrapToolsWithOutputPolicy(tools, context);
}

export function truncateToolResult(
  result: unknown,
  sessionId: string,
  toolName: string,
  outputDir?: string,
): unknown {
  return getToolOutputService().truncateToolResult(result, sessionId, toolName, outputDir);
}

/** The retrieval standard tool singleton lives in the compat forwarder for
 * export-identity stability; the factory stays here and always uses the
 * non-replaceable retrieval runtime. */
export function createRetrieveToolOutputStandardTool(): LoadedTool {
  return getRetrieveToolOutputStandardTool();
}

export function buildRetrieveToolOutputAiTool(sessionId: string): AiTool {
  return getToolOutputService().buildRetrieveToolOutputAiTool(sessionId);
}

export type {
  ToolOutputArtifactReference,
  ToolOutputArtifactService,
  ToolOutputFallback,
  ToolOutputPolicyContext,
  ToolOutputPolicyOptions,
} from './contracts';
