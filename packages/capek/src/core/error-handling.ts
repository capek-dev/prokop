import type { AuthErrorMessage, ContextOverflowErrorMessage, InvalidRequestErrorMessage, ErrorMessage } from '@capekai/types';
import { ApiErrorType, ERROR_AUTH, ERROR_INVALID_REQUEST, ERROR_CHAT_FAILED } from '../utils/errors';
import type { ClassifiedError } from '../utils/errors';

export type ErrorEvent = AuthErrorMessage | ContextOverflowErrorMessage | InvalidRequestErrorMessage | ErrorMessage;

export function createErrorEvent(classified: ClassifiedError): ErrorEvent {
  switch (classified.type) {
    case ApiErrorType.Authentication:
      return { type: 'error.auth', code: ERROR_AUTH, message: classified.message };
    case ApiErrorType.ContextOverflow:
      return { type: 'error.context_overflow', code: 'context_overflow', message: classified.message };
    case ApiErrorType.InvalidRequest:
      return { type: 'error.invalid_request', code: ERROR_INVALID_REQUEST, message: classified.message };
    default:
      return { type: 'error', code: ERROR_CHAT_FAILED, message: classified.message };
  }
}
