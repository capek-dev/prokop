import { randomUUID } from 'crypto';
import { simulateReadableStream } from 'ai';
import { getSandboxController } from '@/infrastructure/sandbox/controller';
import { getSession } from '@/infrastructure/storage/runtime';
import type {
  ErrorResponse,
  LlmCallContext,
  SandboxResponse,
  SandboxToolDefinition,
  SandboxUsage,
} from '@/infrastructure/sandbox/types';

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

interface SandboxModelUsage {
  inputTokens: { total: number; noCache: number; cacheRead: undefined; cacheWrite: undefined };
  outputTokens: { total: number; text: number; reasoning: undefined };
}

function toModelUsage(usage: SandboxUsage = { inputTokens: 10, outputTokens: 20 }): SandboxModelUsage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: usage.inputTokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: usage.outputTokens,
      reasoning: undefined,
    },
  };
}

function pushReasoning(chunks: unknown[], reasoning: string): void {
  const id = randomUUID();
  chunks.push(
    { type: 'reasoning-start', id },
    { type: 'reasoning-delta', id, delta: reasoning },
    { type: 'reasoning-end', id },
  );
}

function pushText(chunks: unknown[], text: string): void {
  const id = randomUUID();
  chunks.push(
    { type: 'text-start', id },
    { type: 'text-delta', id, delta: text },
    { type: 'text-end', id },
  );
}

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
        getSandboxController().complete(callId);
      }
    },
    async cancel(reason: unknown): Promise<void> {
      await stream.cancel(reason);
      getSandboxController().complete(callId);
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
    const context = await this.createContext(options, 'stream');
    const response = await getSandboxController().waitForResponse(context, options.abortSignal);
    const stream = wrapStreamWithCompletion(this.responseToStream(response), context.callId);

    return { stream };
  }

  async doGenerate(options: SandboxModelCallOptions): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    finishReason: { unified: 'stop'; raw: undefined };
    usage: SandboxModelUsage;
    warnings: [];
  }> {
    const context = await this.createContext(options, 'generate');
    const response = await getSandboxController().waitForResponse(context, options.abortSignal);

    try {
      return this.responseToGenerateResult(response);
    } finally {
      getSandboxController().complete(context.callId);
    }
  }

  private async createContext(
    options: SandboxModelCallOptions,
    mode: 'stream' | 'generate',
  ): Promise<LlmCallContext> {
    return {
      callId: randomUUID(),
      sessionId: this.sessionId,
      depth: await this.computeDepth(),
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
        const splitAt = Math.max(1, Math.floor(response.content.length / 2));
        const textChunks = response.content.length > 1
          ? [response.content.slice(0, splitAt), response.content.slice(splitAt)]
          : [response.content];
        chunks.push(
          { type: 'text-start', id: textId },
          ...textChunks.map((delta) => ({ type: 'text-delta', id: textId, delta })),
          { type: 'text-end', id: textId },
        );
        break;
      }

      case 'reasoning': {
        pushReasoning(chunks, response.reasoning);
        pushText(chunks, response.text);
        break;
      }

      case 'tool-call': {
        if (response.reasoning) pushReasoning(chunks, response.reasoning);
        if (response.text) pushText(chunks, response.text);
        chunks.push({
          type: 'tool-call',
          toolCallId: response.toolCallId ?? randomUUID(),
          toolName: response.toolName,
          input: JSON.stringify(response.args),
        });
        break;
      }

      case 'multi-tool-call': {
        if (response.reasoning) pushReasoning(chunks, response.reasoning);
        if (response.text) pushText(chunks, response.text);
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
      usage: toModelUsage(response.usage),
    });

    return simulateReadableStream({ chunks });
  }

  private responseToGenerateResult(response: SandboxResponse): {
    content: Array<{ type: 'text'; text: string }>;
    finishReason: { unified: 'stop'; raw: undefined };
    usage: SandboxModelUsage;
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
      usage: toModelUsage(response.usage),
      warnings: [],
    };
  }

  private async computeDepth(): Promise<number> {
    let depth = 0;
    let session = await getSession(this.sessionId);

    while (session?.parentId) {
      depth += 1;
      session = await getSession(session.parentId);
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
