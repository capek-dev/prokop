import type { TextPart, ToolPart, StepPart, Part, ImagePart, FilePart } from '@jean2/sdk';
import { randomUUID } from 'crypto';

export function isTextPart(part: Part): part is TextPart {
  return part.type === 'text';
}

export function isToolPart(part: Part): part is ToolPart {
  return part.type === 'tool';
}

export function isImagePart(part: Part): part is ImagePart {
  return part.type === 'image';
}

export function isFilePart(part: Part): part is FilePart {
  return part.type === 'file';
}

const NULL_BYTE = '\u0000';

function stripNullBytes(value: string): string {
  if (!value.includes(NULL_BYTE)) {
    return value;
  }
  return value.split(NULL_BYTE).join('');
}

function sanitizeInput(input: unknown): unknown {
  if (typeof input === 'string') {
    return stripNullBytes(input);
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  if (input !== null && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      result[stripNullBytes(key)] = sanitizeInput((input as Record<string, unknown>)[key]);
    }
    return result;
  }
  return input;
}

export function parseToolInput(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) {
    return {};
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed === 'object' && parsed !== null) {
        return sanitizeInput(parsed) as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  return typeof input === 'object'
    ? sanitizeInput(input) as Record<string, unknown>
    : {};
}

export function createStepPart(options: {
  messageId: string;
  sessionId: string;
  number: number;
  status: 'started' | 'finished';
  finishReason?: 'stop' | 'tool-calls' | 'error' | 'length';
  tokens?: { prompt: number; completion: number };
  cost?: number;
  snapshot?: string;
}): StepPart {
  return {
    id: randomUUID(),
    messageId: options.messageId,
    createdAt: Date.now(),
    type: 'step',
    number: options.number,
    status: options.status,
    ...(options.finishReason && { finishReason: options.finishReason }),
    ...(options.tokens && { tokens: options.tokens }),
    ...(options.cost !== undefined && { cost: options.cost }),
    ...(options.snapshot && { snapshot: options.snapshot }),
  };
}
