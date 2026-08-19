import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';
import { BadRequestError } from '@/application/http-errors';

/**
 * Wraps zValidator with a custom hook that throws BadRequestError on validation failure.
 * This ensures all validation errors flow through the centralized onError handler
 * and return the standard { error: 'bad_request', message, details } format.
 */
export function validate<T extends ZodSchema>(
  target: 'json' | 'form' | 'query' | 'param' | 'header' | 'cookie',
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new BadRequestError('Validation failed', issues);
    }
  });
}
