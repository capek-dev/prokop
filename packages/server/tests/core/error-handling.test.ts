import { describe, test, expect } from 'bun:test';
import { createErrorEvent } from '@capekai/core/compat/jean2';
import { classifyApiError } from '@capekai/core/compat/jean2';

describe('createErrorEvent', () => {
  test('creates auth error event for authentication errors', () => {
    const classified = classifyApiError(
      Object.assign(new Error('unauthorized'), { status: 401 }),
    );
    const event = createErrorEvent(classified);
    expect(event.type).toBe('error.auth');
  });

  test('creates context overflow error event', () => {
    const classified = classifyApiError(
      Object.assign(new Error('context_length_exceeded'), { status: 400 }),
    );
    const event = createErrorEvent(classified);
    expect(event.type).toBe('error.context_overflow');
  });

  test('creates invalid request error event', () => {
    const classified = classifyApiError(
      Object.assign(new Error('bad request'), { status: 400 }),
    );
    const event = createErrorEvent(classified);
    expect(event.type).toBe('error.invalid_request');
  });

  test('creates generic error event for unknown errors', () => {
    const classified = classifyApiError(new Error('something broke'));
    const event = createErrorEvent(classified);
    expect(event.type).toBe('error');
  });

  test('creates generic error event for server errors', () => {
    const classified = classifyApiError(
      Object.assign(new Error('internal server error'), { status: 500 }),
    );
    const event = createErrorEvent(classified);
    expect(event.type).toBe('error');
  });

  test('preserves error message in event', () => {
    const classified = classifyApiError(
      Object.assign(new Error('specific error message'), { status: 401 }),
    );
    const event = createErrorEvent(classified);
    expect(event.message).toBe('specific error message');
  });
});
