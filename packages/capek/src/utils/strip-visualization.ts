import type { AnyVisualization } from '@jean2/sdk';

/**
 * Recursively strip _visualization fields from any object.
 * Used before passing tool output to LLM context to avoid token bloat.
 *
 * @param output - The object to strip visualization from
 * @returns A new object with all _visualization fields removed
 */
export function stripVisualization<T>(output: T): T {
  if (output === null || output === undefined) {
    return output;
  }

  if (Array.isArray(output)) {
    return output.map(item => stripVisualization(item)) as T;
  }

  if (typeof output === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      // Skip _visualization field
      if (key === '_visualization') {
        continue;
      }

      result[key] = stripVisualization(value);
    }

    return result as T;
  }

  return output;
}

/**
 * Extract visualization metadata from tool output.
 *
 * @param output - The tool output object
 * @returns The visualization metadata if present, undefined otherwise
 */
export function extractVisualization(
  output: unknown,
): AnyVisualization | undefined {
  if (output && typeof output === 'object' && '_visualization' in output) {
    return (output as Record<string, unknown>)._visualization as AnyVisualization;
  }
  return undefined;
}
