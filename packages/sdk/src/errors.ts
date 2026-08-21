export class ProkopaiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProkopaiError';
  }
}

export class ConnectionError extends ProkopaiError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConnectionError';
  }
}

export class AuthError extends ProkopaiError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends ProkopaiError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class TimeoutError extends ProkopaiError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TimeoutError';
  }
}

export class ServerError extends ProkopaiError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServerError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends ProkopaiError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

export class ApiError extends ProkopaiError {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    options?: ErrorOptions & { details?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}
