import { randomUUID } from 'crypto';
import { simulateReadableStream } from 'ai';
import { sandboxController } from './controller';
import { getSession } from '../storage/runtime';
import type {
  ErrorResponse,
  LlmCallContext,
  SandboxResponse,
  SandboxToolDefinition,
} from './types';

const ERROR_TYPE_TO_STATUS: Record<NonNullable<ErrorResponse['errorType']>, number> = {
  rate_limit: 429,
  server: 500,
  timeout: 408,
  auth: 401,
  invalid_request: 400,
};

interface SandboxPromptMessage {
  role: string;
  content: unknown;
}

interface SandboxModelCallOptions {
  prompt: SandboxPromptMessage[];
  tools?: unknown;
  abortSignal?: AbortSignal;
}

interface SandboxLanguageModelOptions {
  sessionId: string;
  modelId: string;
  providerId: string;
}

const defaultGenerateUsage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 20,
    text: 20,
    reasoning: undefined,
  },
} as const;

function toTools(tools: unknown): SandboxToolDefinition[] {
  if (!tools) {
    return [];
  }

  if (Array.isArray(tools)) {
    return tools.map((tool, index) => {
      const candidate = tool as {
        name?: string;
        description?: string;
        inputSchema?: unknown;
      };

      return {
        name: candidate.name ?? `tool-${index + 1}`,
        description: candidate.description ?? '',
        inputSchema: candidate.inputSchema,
      };
    });
  }

  return Object.entries(tools as Record<string, { description?: string; inputSchema?: unknown }>).map(([name, tool]) => ({
    name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  }));
}

function toSystemPrompt(prompt: SandboxPromptMessage[]): string | undefined {
  const systemMessage = prompt.find((message) => message.role === 'system');
  if (!systemMessage) {
    return undefined;
  }

  return typeof systemMessage.content === 'string' ? systemMessage.content : undefined;
}

function wrapStreamWithCompletion(
  stream: ReadableStream<unknown>,
  callId: string,
): ReadableStream<unknown> {
  return new ReadableStream<unknown>({
    async start(controller): Promise<void> {
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          controller.enqueue(value);
        }

        controller.close();
      } catch (error: unknown) {
        controller.error(error);
      } finally {
        reader.releaseLock();
        sandboxController.complete(callId);
      }
    },
    async cancel(reason: unknown): Promise<void> {
      await stream.cancel(reason);
      sandboxController.complete(callId);
    },
  });
}

export class SandboxLanguageModel {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls = Promise.resolve({});

  private sessionId: string;

  constructor(options: SandboxLanguageModelOptions) {
    this.sessionId = options.sessionId;
    this.modelId = options.modelId;
    this.provider = options.providerId;
  }

  async doStream(options: SandboxModelCallOptions): Promise<{ stream: ReadableStream<unknown> }> {
    const context = this.createContext(options, 'stream');
    const response = await sandboxController.waitForResponse(context, options.abortSignal);
    const stream = wrapStreamWithCompletion(this.responseToStream(response), context.callId);

    return { stream };
  }

  async doGenerate(options: SandboxModelCallOptions): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    finishReason: { unified: 'stop'; raw: undefined };
    usage: typeof defaultGenerateUsage;
    warnings: [];
  }> {
    const context = this.createContext(options, 'generate');
    const response = await sandboxController.waitForResponse(context, options.abortSignal);

    try {
      return this.responseToGenerateResult(response);
    } finally {
      sandboxController.complete(context.callId);
    }
  }

  private createContext(
    options: SandboxModelCallOptions,
    mode: 'stream' | 'generate',
  ): LlmCallContext {
    return {
      callId: randomUUID(),
      sessionId: this.sessionId,
      depth: this.computeDepth(),
      mode,
      messages: options.prompt.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      systemPrompt: toSystemPrompt(options.prompt),
      tools: toTools(options.tools),
      modelId: this.modelId,
      providerId: this.provider,
      timestamp: Date.now(),
    };
  }

  private responseToStream(response: SandboxResponse): ReadableStream<unknown> {
    if (response.type === 'error') {
      throw createClassifiedError(response);
    }

    const chunks: unknown[] = [];

    switch (response.type) {
      case 'text': {
        const textId = randomUUID();
        chunks.push(
          { type: 'text-start', id: textId },
          { type: 'text-delta', id: textId, delta: response.content },
          { type: 'text-end', id: textId },
        );
        break;
      }

      case 'reasoning': {
        const reasoningId = randomUUID();
        const textId = randomUUID();
        chunks.push(
          { type: 'reasoning-start', id: reasoningId },
          { type: 'reasoning-delta', id: reasoningId, delta: response.reasoning },
          { type: 'reasoning-end', id: reasoningId },
          { type: 'text-start', id: textId },
          { type: 'text-delta', id: textId, delta: response.text },
          { type: 'text-end', id: textId },
        );
        break;
      }

      case 'tool-call': {
        chunks.push({
          type: 'tool-call',
          toolCallId: response.toolCallId ?? randomUUID(),
          toolName: response.toolName,
          input: JSON.stringify(response.args),
        });
        break;
      }

      case 'multi-tool-call': {
        for (const call of response.calls) {
          chunks.push({
            type: 'tool-call',
            toolCallId: call.toolCallId ?? randomUUID(),
            toolName: call.toolName,
            input: JSON.stringify(call.args),
          });
        }
        break;
      }
    }

    chunks.push({
      type: 'finish',
      finishReason: { unified: 'stop' as const, raw: undefined },
      logprobs: undefined,
      usage: defaultGenerateUsage,
    });

    return simulateReadableStream({ chunks });
  }

  private responseToGenerateResult(response: SandboxResponse): {
    content: Array<{ type: 'text'; text: string }>;
    finishReason: { unified: 'stop'; raw: undefined };
    usage: typeof defaultGenerateUsage;
    warnings: [];
  } {
    if (response.type === 'error') {
      throw createClassifiedError(response);
    }

    const text = response.type === 'text'
      ? response.content
      : response.type === 'reasoning'
        ? response.text
        : JSON.stringify(response);

    return {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: defaultGenerateUsage,
      warnings: [],
    };
  }

  private computeDepth(): number {
    let depth = 0;
    let session = getSession(this.sessionId);

    while (session?.parentId) {
      depth += 1;
      session = getSession(session.parentId);
    }

    return depth;
  }
}

function createClassifiedError(response: ErrorResponse): Error & { status?: number; isRateLimitError?: boolean; isRetryableError?: boolean; isTimeoutError?: boolean } {
  const err = new Error(response.error) as Error & { status?: number; isRateLimitError?: boolean; isRetryableError?: boolean; isTimeoutError?: boolean };

  if (response.errorType) {
    const status = ERROR_TYPE_TO_STATUS[response.errorType];
    err.status = status;

    if (response.errorType === 'rate_limit') {
      err.isRateLimitError = true;
      err.isRetryableError = true;
    } else if (response.errorType === 'server') {
      err.isRetryableError = true;
    } else if (response.errorType === 'timeout') {
      err.isTimeoutError = true;
      err.isRetryableError = true;
    }
  }

  return err;
}
