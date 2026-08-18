import { HttpError } from '@/application/http-errors';

export class ConfigurationError extends HttpError {
  constructor(status: number, message: string, code: string, details?: unknown) {
    super(status, message, code, details);
  }
}

export class ConfigurationValidationError extends ConfigurationError {
  constructor(message: string, public readonly details?: string[]) {
    super(400, message, 'bad_request', details);
  }
}

export class ConfigurationNotFoundError extends ConfigurationError {
  constructor(resource: string, id: string) {
    super(404, `${resource} not found: ${id}`, 'not_found');
  }
}

export class ConfigurationConflictError extends ConfigurationError {
  constructor(message: string) {
    super(409, message, 'conflict');
  }
}

export class ConfigurationPersistenceError extends ConfigurationError {
  constructor(message: string) {
    super(500, message, 'persistence_error');
  }
}

export class ForbiddenDeleteError extends ConfigurationError {
  constructor(message: string) {
    super(403, message, 'forbidden');
  }
}
