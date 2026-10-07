import { APICallError, type LanguageModelMiddleware } from 'ai';
import { ApiErrorType, classifyApiError } from '@/infrastructure/providers/errors';

export const codexNetworkRetryMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  wrapStream: async ({ doStream, params }) => {
    try {
      return await doStream();
    } catch (error: unknown) {
      if (params.abortSignal?.aborted || APICallError.isInstance(error)
        || (error instanceof Error && error.name === 'AbortError')) throw error;
      const classified = classifyApiError(error);
      if (classified.type !== ApiErrorType.Network) throw error;
      // OpenAI's early stream probe can throw a raw socket error. Normalize
      // only before stream handoff so SDK retries this request, not prior tools.
      throw new APICallError({
        message: classified.message,
        url: 'https://chatgpt.com/backend-api/codex/responses',
        requestBodyValues: undefined,
        cause: error,
        isRetryable: true,
      });
    }
  },
};
