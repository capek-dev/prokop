export {
  ApiErrorType,
  ERROR_AUTH,
  ERROR_CHAT_FAILED,
  ERROR_INVALID_REQUEST,
  ERROR_RATE_LIMIT,
  ERROR_SERVER_ERROR,
  ERROR_TIMEOUT,
  classifyApiError,
  withRetry,
} from '@capekai/core/compat/jean2';
export type {
  ClassifiedError,
  RetryOptions,
} from '@capekai/core/compat/jean2';
