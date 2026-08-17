/**
 * HTTP error hierarchy for centralized error handling.
 *
 * Route handlers throw these instead of wrapping every call in try/catch.
 * The app.onError() handler in app.ts maps them to appropriate HTTP responses.
 */

export class HttpError extends Error {
  public status: number;
  public code: string;
  public details?: unknown;

  constructor(status: number, message: string, code: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'bad_request', details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string) {
    super(401, message, 'unauthorized');
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super(403, message, 'forbidden');
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message, 'not_found');
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, message, 'conflict', details);
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message: string) {
    super(413, message, 'payload_too_large');
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message: string) {
    super(422, message, 'unprocessable_entity');
  }
}
