import type { ToolModelOutputPart } from '@prokopai/sdk/types';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CapabilityTool } from '@/infrastructure/providers/ai-sdk';

/** Čapek 1.1.x recognizes this envelope in its output policy and transcript writer.
 * Keep this compatibility mapping here until core exposes its envelope factory.
 * toModelOutput alone is insufficient: screenshots must also survive persistence
 * and large-output truncation, not just the current provider call.
 */
export function mcpOutputForCapek(output: unknown): unknown {
  const result = CallToolResultSchema.parse(output);
  if (!result.content.some(block => block.type === 'image')) return result;
  const modelOutput: ToolModelOutputPart[] = result.content.map(block => block.type === 'image'
    ? { type: 'image', data: block.data, mediaType: block.mimeType }
    : { type: 'text', text: block.type === 'text' ? block.text : JSON.stringify(block) });
  return { type: 'capek-tool-output', modelOutput, value: {
    ...result,
    content: result.content.map(block => block.type === 'image'
      ? { type: 'text', text: `[Image: ${block.mimeType}]` } : block),
  } };
}

export const mcpModelOutput: NonNullable<CapabilityTool['toModelOutput']> = ({ output }) => {
  if (output && typeof output === 'object' && 'type' in output && output.type === 'capek-tool-output'
    && 'modelOutput' in output && Array.isArray(output.modelOutput)) {
    const parts = output.modelOutput as ToolModelOutputPart[];
    return { type: 'content', value: parts.map(part => part.type === 'image'
      ? { type: 'image-data' as const, data: part.data, mediaType: part.mediaType }
      : { type: 'text' as const, text: part.text }) };
  }
  // The output policy can replace large text results with artifact references.
  return { type: 'text', value: JSON.stringify(output) };
};
