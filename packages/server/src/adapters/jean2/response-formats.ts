import {
  createResponseFormat,
  deleteResponseFormat,
  getResponseFormat,
  listResponseFormats,
  updateResponseFormat,
} from '@/infrastructure/sqlite/response-formats';
import type { ResponseFormatsApplication } from '@/application/ports/response-formats';

export function createJean2ResponseFormatsApplication(): ResponseFormatsApplication {
  return {
    list: listResponseFormats,
    get: getResponseFormat,
    create: createResponseFormat,
    update: updateResponseFormat,
    delete: deleteResponseFormat,
  };
}
