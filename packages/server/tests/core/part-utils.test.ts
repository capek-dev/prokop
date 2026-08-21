import { describe, test, expect } from 'bun:test';
import { isTextPart, isToolPart, isImagePart, isFilePart, parseToolInput, createStepPart } from '@capekai/core/execution';
import type { Part } from '@prokopai/sdk';

describe('type guards', () => {
  test('isTextPart returns true for text parts', () => {
    const part: Part = {
      type: 'text',
      id: 'p1',
      messageId: 'm1',
      createdAt: Date.now(),
      text: 'hello',
    };
    expect(isTextPart(part)).toBe(true);
    expect(isToolPart(part)).toBe(false);
  });

  test('isToolPart returns true for tool parts', () => {
    const part: Part = {
      type: 'tool',
      id: 'p1',
      messageId: 'm1',
      createdAt: Date.now(),
      callId: 'call-1',
      name: 'bash',
      state: { status: 'pending', input: {} },
    };
    expect(isToolPart(part)).toBe(true);
    expect(isTextPart(part)).toBe(false);
  });

  test('isImagePart returns true for image parts', () => {
    const part: Part = {
      type: 'image',
      id: 'p1',
      messageId: 'm1',
      createdAt: Date.now(),
      url: 'http://example.com/img.png',
    };
    expect(isImagePart(part)).toBe(true);
  });

  test('isFilePart returns true for file parts', () => {
    const part: Part = {
      type: 'file',
      id: 'p1',
      messageId: 'm1',
      createdAt: Date.now(),
      mimeType: 'text/plain',
      filename: 'test.txt',
      url: 'http://example.com/file.txt',
    };
    expect(isFilePart(part)).toBe(true);
  });

  test('type guards are mutually exclusive', () => {
    const textPart: Part = { type: 'text', id: '1', messageId: 'm1', createdAt: 0, text: '' };
    const toolPart: Part = { type: 'tool', id: '2', messageId: 'm1', createdAt: 0, callId: 'c1', name: 'test', state: { status: 'pending', input: {} } };

    expect(isTextPart(textPart)).toBe(true);
    expect(isToolPart(textPart)).toBe(false);
    expect(isImagePart(textPart)).toBe(false);
    expect(isFilePart(textPart)).toBe(false);

    expect(isTextPart(toolPart)).toBe(false);
    expect(isToolPart(toolPart)).toBe(true);
  });
});

describe('parseToolInput', () => {
  test('parses JSON string input', () => {
    expect(parseToolInput('{"path": "/foo"}')).toEqual({ path: '/foo' });
  });

  test('returns empty object for invalid JSON string', () => {
    expect(parseToolInput('not json')).toEqual({});
  });

  test('returns parsed value for JSON string that is not an object', () => {
    expect(parseToolInput('42')).toEqual({});
    expect(parseToolInput('"hello"')).toEqual({});
  });

  test('returns object as-is', () => {
    expect(parseToolInput({ path: '/foo' })).toEqual({ path: '/foo' });
  });

  test('returns empty object for null', () => {
    expect(parseToolInput(null)).toEqual({});
  });

  test('returns empty object for undefined', () => {
    expect(parseToolInput(undefined)).toEqual({});
  });

  test('returns empty object for primitives', () => {
    expect(parseToolInput(42)).toEqual({});
    expect(parseToolInput(true)).toEqual({});
  });

  test('strips null bytes from string values in JSON input', () => {
    const input = JSON.stringify({ path: '/foo', newString: 'hello\u0000\u0000world' });
    const result = parseToolInput(input);
    expect(result).toEqual({ path: '/foo', newString: 'helloworld' });
    expect(result.newString).not.toContain('\u0000');
  });

  test('strips null bytes from object input (pre-parsed by AI SDK)', () => {
    const input = { path: '/foo', oldString: 'ab\u0000cd', newString: 'ef\u0000gh' };
    const result = parseToolInput(input);
    expect(result).toEqual({ path: '/foo', oldString: 'abcd', newString: 'efgh' });
  });

  test('strips null bytes recursively from nested objects and arrays', () => {
    const input = {
      items: [{ content: 'a\u0000b' }, { content: 'c\u0000d' }],
      nested: { text: 'deep\u0000value' },
    };
    const result = parseToolInput(input);
    expect(result).toEqual({
      items: [{ content: 'ab' }, { content: 'cd' }],
      nested: { text: 'deepvalue' },
    });
  });

  test('handles strings without null bytes unchanged', () => {
    const result = parseToolInput({ path: '/foo', content: 'hello world' });
    expect(result).toEqual({ path: '/foo', content: 'hello world' });
  });

  test('strips null bytes from object keys', () => {
    const input = { 'key\u0000name': 'value' };
    const result = parseToolInput(input);
    expect(result).toEqual({ keyname: 'value' });
  });
});

describe('createStepPart', () => {
  test('creates step part with required fields', () => {
    const part = createStepPart({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      number: 1,
      status: 'started',
    });
    expect(part.type).toBe('step');
    expect(part.number).toBe(1);
    expect(part.status).toBe('started');
    expect(part.id).toBeDefined();
    expect(part.messageId).toBe('msg-1');
  });

  test('includes optional fields when provided', () => {
    const part = createStepPart({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      number: 2,
      status: 'finished',
      finishReason: 'stop',
      tokens: { prompt: 100, completion: 50 },
      cost: 0.002,
    });
    expect(part.finishReason).toBe('stop');
    expect(part.tokens).toEqual({ prompt: 100, completion: 50 });
    expect(part.cost).toBe(0.002);
  });

  test('omits optional fields when not provided', () => {
    const part = createStepPart({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      number: 1,
      status: 'started',
    });
    expect(part.finishReason).toBeUndefined();
    expect(part.tokens).toBeUndefined();
    expect(part.cost).toBeUndefined();
  });

  test('creates sequential step parts with incrementing numbers', () => {
    const part1 = createStepPart({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      number: 1,
      status: 'started',
    });
    const part2 = createStepPart({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      number: 2,
      status: 'finished',
      finishReason: 'tool-calls',
    });
    expect(part1.number).toBe(1);
    expect(part2.number).toBe(2);
    expect(part1.id).not.toBe(part2.id);
  });
});
