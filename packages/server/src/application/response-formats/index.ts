import type { ResponseFormatsApplication } from '@/application/ports/response-formats';

export function createResponseFormatsApplication(
  responseFormats: ResponseFormatsApplication,
): ResponseFormatsApplication {
  return responseFormats;
}
