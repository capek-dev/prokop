import { describe, expect, test } from 'bun:test';
import { buildSchemaPromptInstruction, extractJsonFromText } from '@/core/structured-output';

const responseFormat = {
  id: 'format-1',
  name: 'answer',
  description: 'A structured answer',
  createdAt: 1,
  updatedAt: 1,
  schema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
    },
    required: ['answer'],
  },
};

describe('structured output', () => {
  test('builds the existing schema prompt instruction', () => {
    const instruction = buildSchemaPromptInstruction(responseFormat);

    expect(instruction).toContain('answer');
    expect(instruction).toContain('A structured answer');
    expect(instruction).toContain('"required"');
  });

  test('extracts JSON objects from plain and fenced text', () => {
    expect(extractJsonFromText('{"answer":"plain"}')).toEqual({ answer: 'plain' });
    expect(extractJsonFromText('```json\n{"answer":"fenced"}\n```')).toEqual({ answer: 'fenced' });
  });

  test('returns null for invalid or non-object JSON', () => {
    expect(extractJsonFromText('not json')).toBeNull();
    expect(extractJsonFromText('[1, 2, 3]')).toBeNull();
  });
});
