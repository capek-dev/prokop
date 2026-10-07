import {
  createResponseFormat,
  deleteResponseFormat,
  getResponseFormat,
  listResponseFormats,
  updateResponseFormat,
} from '@/infrastructure/sqlite/response-formats';
import type { ResponseFormatsApplication } from '@/application/ports/response-formats';

export function createProkopResponseFormatsApplication(): ResponseFormatsApplication {
  return {
    list: listResponseFormats,
    get: getResponseFormat,
    create: createResponseFormat,
    update: updateResponseFormat,
    delete: deleteResponseFormat,
  };
}
