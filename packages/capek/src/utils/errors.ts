'use strict';

const OVERFLOW_PATTERNS = [
  /context window exceeds limit/i,
  /prompt is too long/i,
  /exceeds the context window/i,
  /input token count.*exceeds.*maximum/i,
  /maximum context length is \d+/i,
  /exceeds the limit of \d+/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
];

export enum ApiErrorType {
  RateLimit = 'rate_limit',
  ServerError = 'server_error',
  Timeout = 'timeout',
  Network = 'network',
  Quota = 'quota',
  Authentication = 'authentication',
  ContextOverflow = 'context_overflow',
  InvalidRequest = 'invalid_request',
  Unknown = 'unknown',
}

export interface ClassifiedError {
  type: ApiErrorType;
  retryable: boolean;
  retryAfterMs?: number;
  message: string;
  originalError: unknown;
}

export const ERROR_RATE_LIMIT = 'rate_limit';
export const ERROR_SERVER_ERROR = 'server_error';
export const ERROR_TIMEOUT = 'timeout';
export const ERROR_AUTH = 'authentication';
export const ERROR_INVALID_REQUEST = 'invalid_request';
export const ERROR_CHAT_FAILED = 'chat_error';

interface HeaderGetter {
  get(name: string): string | null;
}

interface AiSdkError {
  status?: number;
  statusCode?: number;
  isRateLimitError?: boolean;
  isRetryableError?: boolean;
  isTimeoutError?: boolean;
  message?: string;
  name?: string;
  code?: string;
  cause?: unknown;
  originalError?: unknown;
  response?: {
    headers?: HeaderGetter;
  };
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  data?: {
    error?: {
      type?: string;
      message?: string;
      resets_in_seconds?: number;
    };
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return String(error);
}

function getStatusCode(error: AiSdkError): number | undefined {
  return error.status ?? error.statusCode;
}

function getRetryAfterMsFromHeaders(headers: HeaderGetter | Record<string, string> | undefined): number | undefined {
  if (!headers) {
    return undefined;
  }

  let retryAfter: string | null | undefined;

  if (typeof (headers as HeaderGetter).get === 'function') {
    retryAfter = (headers as HeaderGetter).get('retry-after');
  } else {
    const recordHeaders = headers as Record<string, string>;
    retryAfter = recordHeaders['retry-after'] ?? recordHeaders['Retry-After'];
  }

  if (!retryAfter) {
    return undefined;
  }

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  return Math.max(0, retryAt - Date.now());
}

function getRetryAfterMsFromError(error: AiSdkError): number | undefined {
  const headerRetryAfter = getRetryAfterMsFromHeaders(error.response?.headers)
    ?? getRetryAfterMsFromHeaders(error.responseHeaders);
  if (headerRetryAfter !== undefined) {
    return headerRetryAfter;
  }

  const resetSeconds = error.data?.error?.resets_in_seconds;
  if (typeof resetSeconds === 'number' && Number.isFinite(resetSeconds) && resetSeconds >= 0) {
    return resetSeconds * 1000;
  }

  return undefined;
}

function getNestedErrors(error: AiSdkError): unknown[] {
  return [error.cause, error.originalError].filter(value => value !== undefined);
}

function isUsageLimitError(error: AiSdkError, message: string): boolean {
  if (error.data?.error?.type === 'usage_limit_reached') {
    return true;
  }

  const responseBody = error.responseBody;
  if (typeof responseBody === 'string' && responseBody.toLowerCase().includes('usage_limit_reached')) {
    return true;
  }

  const lower = message.toLowerCase();
  return lower.includes('usage limit has been reached') || lower.includes('usage_limit_reached');
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isTransientNetworkError(error: AiSdkError, message: string): boolean {
  if (error.code && TRANSIENT_NETWORK_CODES.has(error.code)) {
    return true;
  }

  const lower = message.toLowerCase();
  return lower.includes('fetch failed')
    || lower.includes('network error')
    || lower.includes('socket hang up')
    || lower.includes('connection reset')
    || lower.includes('connection closed');
}

export function classifyApiError(error: unknown): ClassifiedError {
  const message = getErrorMessage(error);

  if (error && typeof error === 'object') {
    const aiError = error as AiSdkError;

    if (aiError.isTimeoutError || aiError.name === 'TimeoutError' || aiError.code === 'ETIMEDOUT') {
      return {
        type: ApiErrorType.Timeout,
        retryable: true,
        message,
        originalError: error,
      };
    }

    const status = getStatusCode(aiError);

    if (isTransientNetworkError(aiError, message)) {
      return {
        type: ApiErrorType.Network,
        retryable: true,
        message,
        originalError: error,
      };
    }

    if (isUsageLimitError(aiError, message)) {
      return {
        type: ApiErrorType.Quota,
        retryable: false,
        message,
        originalError: error,
      };
    }

    if (aiError.isRateLimitError || status === 429) {
      const retryAfterMs = getRetryAfterMsFromError(aiError) ?? 60000;
      return {
        type: ApiErrorType.RateLimit,
        retryable: true,
        retryAfterMs,
        message,
        originalError: error,
      };
    }

    if (status === 401 || status === 403) {
      return {
        type: ApiErrorType.Authentication,
        retryable: false,
        message,
        originalError: error,
      };
    }

    if (status === 400 || status === 413) {
      const errorMessage = message;
      for (const pattern of OVERFLOW_PATTERNS) {
        if (pattern.test(errorMessage)) {
          return {
            type: ApiErrorType.ContextOverflow,
            retryable: false,
            message: errorMessage,
            originalError: error,
          };
        }
      }
    }

    if (status === 400) {
      return {
        type: ApiErrorType.InvalidRequest,
        retryable: false,
        message,
        originalError: error,
      };
    }

    if (status !== undefined && status >= 500 && status < 600) {
      return {
        type: ApiErrorType.ServerError,
        retryable: true,
        message,
        originalError: error,
      };
    }

    for (const nestedError of getNestedErrors(aiError)) {
      const nestedClassified = classifyApiError(nestedError);
      if (nestedClassified.type !== ApiErrorType.Unknown) {
        return {
          ...nestedClassified,
          message: nestedClassified.message || message,
          originalError: error,
        };
      }
    }

    if (aiError.isRetryableError) {
      return {
        type: ApiErrorType.Unknown,
        retryable: true,
        message,
        originalError: error,
      };
    }
  }

  return {
    type: ApiErrorType.Unknown,
    retryable: false,
    message,
    originalError: error,
  };
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, classifiedError: ClassifiedError) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    onRetry,
  } = options;

  let lastError: ClassifiedError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const classifiedError = classifyApiError(err);
      lastError = classifiedError;

      if (!classifiedError.retryable || attempt >= maxRetries) {
        throw classifiedError;
      }

      const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const delay = classifiedError.retryAfterMs
        ? Math.max(exponentialDelay, classifiedError.retryAfterMs)
        : exponentialDelay;

      onRetry?.(attempt + 1, classifiedError);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
