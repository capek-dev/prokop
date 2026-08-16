/**
 * Temporary forwarding module (S3).
 *
 * The HTTP session routes now live in `transport/http/routes/sessions` and
 * invoke the session HTTP application use cases. This module keeps the old
 * import path working until consumers migrate.
 */
export { registerSessionRoutes } from '@/transport/http/routes/sessions';
