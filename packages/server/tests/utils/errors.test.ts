import { describe, test, expect } from 'bun:test';
import { classifyApiError, withRetry, ApiErrorType, type ClassifiedError } from '@capekai/core/internal/execution';

describe('classifyApiError', () => {
  test('classifies timeout errors by name', () => {
    const error = new Error('timeout');
    error.name = 'TimeoutError';
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Timeout);
    expect(result.retryable).toBe(true);
  });

  test('classifies timeout errors by isTimeoutError flag', () => {
    const error = Object.assign(new Error('timeout'), { isTimeoutError: true });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Timeout);
    expect(result.retryable).toBe(true);
  });

  test('classifies ETIMEDOUT code as timeout', () => {
    const error = Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Timeout);
    expect(result.retryable).toBe(true);
  });

  test('classifies 429 rate limit', () => {
    const error = Object.assign(new Error('rate limited'), {
      status: 429,
      isRateLimitError: true,
    });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.RateLimit);
    expect(result.retryable).toBe(true);
  });

  test('extracts retryAfterMs from rate limit headers', () => {
    const error = Object.assign(new Error('rate limited'), {
      status: 429,
      isRateLimitError: true,
      response: {
        headers: {
          get: (name: string) => (name === 'retry-after' ? '30' : null),
        },
      },
    });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.RateLimit);
    expect(result.retryAfterMs).toBe(30000);
  });

  test('falls back to 60s retry delay for rate limit without header', () => {
    const error = Object.assign(new Error('rate limited'), {
      status: 429,
      isRateLimitError: true,
    });
    const result = classifyApiError(error);
    expect(result.retryAfterMs).toBe(60000);
  });

  test('extracts retryAfterMs from an HTTP-date header', () => {
    const retryAt = new Date(Date.now() + 60_000).toUTCString();
    const error = Object.assign(new Error('rate limited'), {
      status: 429,
      responseHeaders: { 'Retry-After': retryAt },
    });
    const result = classifyApiError(error);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(58_000);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  test('classifies exhausted usage quota as non-retryable', () => {
    const error = Object.assign(new Error('usage limit has been reached'), {
      status: 429,
      data: { error: { type: 'usage_limit_reached' } },
    });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Quota);
    expect(result.retryable).toBe(false);
  });

  test('classifies transient network errors as retryable', () => {
    const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Network);
    expect(result.retryable).toBe(true);
  });

  test('classifies 401 as auth error (non-retryable)', () => {
    const error = Object.assign(new Error('unauthorized'), { status: 401 });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Authentication);
    expect(result.retryable).toBe(false);
  });

  test('classifies 403 as auth error (non-retryable)', () => {
    const error = Object.assign(new Error('forbidden'), { status: 403 });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Authentication);
    expect(result.retryable).toBe(false);
  });

  test('classifies 400 with context overflow pattern', () => {
    const error = Object.assign(
      new Error('prompt is too long: exceeds the context window'),
      { status: 400 },
    );
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.ContextOverflow);
    expect(result.retryable).toBe(false);
  });

  test('classifies 400 with context_length_exceeded pattern', () => {
    const error = Object.assign(new Error('context_length_exceeded'), { status: 400 });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.ContextOverflow);
    expect(result.retryable).toBe(false);
  });

  test('classifies 413 as context overflow', () => {
    const error = Object.assign(new Error('request entity too large'), { status: 413 });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.ContextOverflow);
    expect(result.retryable).toBe(false);
  });

  test('classifies 400 without overflow pattern as invalid request', () => {
    const error = Object.assign(new Error('bad request'), { status: 400 });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.InvalidRequest);
    expect(result.retryable).toBe(false);
  });

  test('classifies 500 as server error (retryable)', () => {
    const error = Object.assign(new Error('internal server error'), { status: 500 });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.ServerError);
    expect(result.retryable).toBe(true);
  });

  test('classifies 502/503/504 as server error (retryable)', () => {
    for (const status of [502, 503, 504]) {
      const error = Object.assign(new Error('bad gateway'), { status });
      const result = classifyApiError(error);
      expect(result.type).toBe(ApiErrorType.ServerError);
      expect(result.retryable).toBe(true);
    }
  });

  test('classifies unknown errors as non-retryable', () => {
    const result = classifyApiError('something went wrong');
    expect(result.type).toBe(ApiErrorType.Unknown);
    expect(result.retryable).toBe(false);
  });

  test('classifies errors with isRetryableError flag as retryable unknown', () => {
    const error = Object.assign(new Error('retryable'), { isRetryableError: true });
    const result = classifyApiError(error);
    expect(result.type).toBe(ApiErrorType.Unknown);
    expect(result.retryable).toBe(true);
  });

  test('preserves original error', () => {
    const error = new Error('test');
    const result = classifyApiError(error);
    expect(result.originalError).toBe(error);
    expect(result.message).toBe('test');
  });
});

describe('withRetry', () => {
  test('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('retries retryable errors and eventually succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) {
          throw Object.assign(new Error('server error'), { status: 500 });
        }
        return Promise.resolve('ok');
      },
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  test('throws ClassifiedError on non-retryable error immediately', async () => {
    const error = Object.assign(new Error('unauthorized'), { status: 401 });
    try {
      await withRetry(() => Promise.reject(error), { maxRetries: 3, baseDelayMs: 1 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      const classified = err as ClassifiedError;
      expect(classified.type).toBe(ApiErrorType.Authentication);
      expect(classified.retryable).toBe(false);
    }
  });

  test('throws ClassifiedError after max retries exceeded', async () => {
    const error = Object.assign(new Error('server error'), { status: 500 });
    try {
      await withRetry(() => Promise.reject(error), {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 10,
      });
      expect.unreachable('Should have thrown');
    } catch (err) {
      const classified = err as ClassifiedError;
      expect(classified.type).toBe(ApiErrorType.ServerError);
    }
  });

  test('calls onRetry callback on each retry', async () => {
    const retryAttempts: number[] = [];
    const error = Object.assign(new Error('server error'), { status: 500 });

    try {
      await withRetry(
        () => Promise.reject(error),
        {
          maxRetries: 2,
          baseDelayMs: 1,
          maxDelayMs: 10,
          onRetry: (attempt) => retryAttempts.push(attempt),
        },
      );
    } catch {
      // expected
    }

    expect(retryAttempts).toEqual([1, 2]);
  });
});
