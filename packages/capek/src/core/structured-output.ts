import type { ResponseFormat } from '@jean2/sdk';

/**
 * Builds a system-prompt instruction that tells the model to respond with JSON
 * conforming to the given schema. Used for providers that strip the schema
 * from `response_format` (e.g. GLM/Zhipu, MiniMax) — they only send
 * `{ type: "json_object" }` to the API, so the model needs the schema inline.
 */
export function buildSchemaPromptInstruction(responseFormat: ResponseFormat): string {
  const schemaStr = JSON.stringify(responseFormat.schema, null, 2);
  return [
    `You must respond with ONLY valid JSON that conforms to the following JSON Schema.`,
    `Do not include any text before or after the JSON object. Do not wrap it in markdown code fences.`,
    `Response format name: ${responseFormat.name}`,
    ...(responseFormat.description ? [`Description: ${responseFormat.description}`] : []),
    '',
    'JSON Schema:',
    schemaStr,
  ].join('\n');
}

/**
 * Attempts to extract a JSON object from the raw text output of a model.
 * Handles common LLM quirks:
 * - Leading/trailing whitespace
 * - Markdown code fences (```json ... ```)
 * - Preamble text before the JSON (finds first `{` and last `}`)
 */
export function extractJsonFromText(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) {
    return null;
  }

  let cleaned = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // If the whole thing is valid JSON, use it directly
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to brace-matching
  }

  // Find the outermost JSON object via first `{` and last `}`
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON
    }
  }

  return null;
}
