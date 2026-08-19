import type { MessageWithParts, CompactionPart, ImagePart, FilePart } from '@capekai/types';
import type { ModelMessage } from 'ai';
import { isTextPart, isToolPart, isImagePart, isFilePart, parseToolInput } from './part-utils';
import { stripVisualization } from '../utils/strip-visualization';
import { getAttachment } from '../storage/runtime';
import { isToolOutputArtifactReference, RETRIEVE_TOOL_OUTPUT_NAME } from '../tool-output/policy';

type AiSdkContent = string | Array<{
  type: 'text' | 'tool-call' | 'tool-result' | 'image' | 'file';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  value?: unknown;
  output?: unknown;
  image?: URL | Uint8Array;
  data?: URL | Uint8Array;
  mediaType?: string;
  filename?: string;
}>;

interface ModelCapabilities {
  input?: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
    file?: string[];
  };
}

async function resolveAttachmentPath(part: ImagePart | FilePart): Promise<{ absolutePath: string; mimeType: string } | null> {
  const urlWithoutQuery = part.url.split('?')[0];
  const match = urlWithoutQuery.match(/^\/api\/sessions\/([^/]+)\/attachments\/([^/]+)\/content$/);
  if (!match) return null;

  const [, sessionId, attachmentId] = match;
  try {
    const attachment = await getAttachment(sessionId, attachmentId);
    if (!attachment) return null;
    return { absolutePath: attachment.absolutePath, mimeType: attachment.mimeType };
  } catch {
    return null;
  }
}

export async function convertToAiSdkMessages(
  messages: MessageWithParts[],
  modelCapabilities?: ModelCapabilities,
): Promise<ModelMessage[]> {
  const result: { role: 'user' | 'assistant' | 'system' | 'tool'; content: AiSdkContent }[] = [];

  for (const msgWithParts of messages) {
    const msg = msgWithParts.message;
    const parts = msgWithParts.parts;

    const textBlocks: string[] = [];
    const toolCallBlocks: Array<{
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: unknown;
    }> = [];
    const toolResultBlocks: Array<{
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      output: unknown;
    }> = [];
    const imageParts: ImagePart[] = [];
    const fileParts: FilePart[] = [];

    const hasCompactionTrigger = parts.some(p => p.type === 'compaction');

    if (msg.role === 'assistant' && (msg.mode === 'compact_failed' || msg.mode === 'retry_failed')) {
      continue;
    }

    for (const part of parts) {
      if (isTextPart(part)) {
        textBlocks.push(part.text);
      } else if (part.type === 'compaction') {
        const compactionPart = part as CompactionPart;
        if (compactionPart.overflow) {
          textBlocks.push('Continue from where we left off, summarizing what we did so far.');
        } else {
          textBlocks.push('What did we do so far?');
        }
      } else if (isToolPart(part)) {
        const toolPart = part;

        toolCallBlocks.push({
          type: 'tool-call' as const,
          toolCallId: toolPart.callId,
          toolName: toolPart.name,
          input: parseToolInput(toolPart.state.input),
        });

        if (toolPart.state.status === 'completed') {
          const isCompacted = !!(toolPart.state as { compactedAt?: number }).compactedAt;
          const isSkillTool = toolPart.name === 'skill';

          if (isCompacted && !isSkillTool) {
            const output = stripVisualization(toolPart.state.output);
            const value = isToolOutputArtifactReference(output)
              ? {
                ...output,
                preview: '[Old tool result content cleared]',
                message: `[Old tool result content cleared] Exact output remains available with ${RETRIEVE_TOOL_OUTPUT_NAME} using artifactId ${output.artifactId}.`,
              }
              : '[Old tool result content cleared]';
            toolResultBlocks.push({
              type: 'tool-result' as const,
              toolCallId: toolPart.callId,
              toolName: toolPart.name,
              output: isToolOutputArtifactReference(output)
                ? { type: 'json' as const, value }
                : { type: 'text' as const, value },
            });
          } else {
            toolResultBlocks.push({
              type: 'tool-result' as const,
              toolCallId: toolPart.callId,
              toolName: toolPart.name,
              output: { type: 'json' as const, value: stripVisualization(toolPart.state.output) },
            });
          }
        } else if (toolPart.state.status === 'error') {
          toolResultBlocks.push({
            type: 'tool-result' as const,
            toolCallId: toolPart.callId,
            toolName: toolPart.name,
            output: { type: 'text' as const, value: JSON.stringify(stripVisualization({ error: toolPart.state.error })) },
          });
        } else {
          // Handle 'pending', 'running', or 'interrupted' tool states
          // These can occur when a session was interrupted or crashed mid-execution.
          // Synthesize an error result so the AI SDK gets a valid tool-result for every tool-call.
          const statusLabel = toolPart.state.status === 'interrupted'
            ? 'interrupted'
            : `${toolPart.state.status} (session interrupted)`;
          toolResultBlocks.push({
            type: 'tool-result' as const,
            toolCallId: toolPart.callId,
            toolName: toolPart.name,
            output: { type: 'text' as const, value: JSON.stringify({ error: `Tool execution was ${statusLabel}` }) },
          });
        }
      } else if (isImagePart(part)) {
        if (modelCapabilities?.input?.image) {
          imageParts.push(part);
        } else {
          const attachmentRecord = await resolveAttachmentPath(part);
          const fallbackText = attachmentRecord
            ? `User attached an image.\nFile path: ${attachmentRecord.absolutePath}\nIf the image contents matter, ask the user to describe it or inspect the file if your runtime supports access to that path.`
            : 'User attached an image (file path unavailable).';
          textBlocks.push(fallbackText);
        }
      } else if (isFilePart(part)) {
        if (modelCapabilities?.input?.file && modelCapabilities.input.file.includes(part.mimeType)) {
          fileParts.push(part);
        } else {
          const attachmentRecord = await resolveAttachmentPath(part);
          const fallbackText = attachmentRecord
            ? `User attached a file: ${part.filename || 'unnamed'} (type: ${part.mimeType}).\nFile path: ${attachmentRecord.absolutePath}\nIf the file contents matter, ask the user to describe it or inspect the file if your runtime supports access to that path.`
            : `User attached a file: ${part.filename || 'unnamed'} (type: ${part.mimeType}).`;
          textBlocks.push(fallbackText);
        }
      }
    }

    const hasText = textBlocks.length > 0;
    const hasToolCalls = toolCallBlocks.length > 0;
    const hasImages = imageParts.length > 0;
    const hasFiles = fileParts.length > 0;
    const hasContentParts = hasText || hasImages || hasFiles || hasToolCalls;

    if (!hasContentParts) {
      continue;
    }

    const contentParts: Array<{
      type: 'text' | 'tool-call' | 'image' | 'file';
      text?: string;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      image?: URL | Uint8Array;
      data?: URL | Uint8Array;
      mimeType?: string;
      mediaType?: string;
      filename?: string;
    }> = [];

    if (hasText) {
      contentParts.push({ type: 'text', text: textBlocks.join('\n\n') });
    }

    for (const imgPart of imageParts) {
      const resolved = await resolveAttachmentPath(imgPart);
      if (resolved) {
        try {
          const file = Bun.file(resolved.absolutePath);
          const buffer = await file.arrayBuffer();
          contentParts.push({ type: 'image', image: new Uint8Array(buffer), mimeType: resolved.mimeType });
        } catch {
          // skip if file can't be read
        }
      }
    }

    for (const filePart of fileParts) {
      const resolved = await resolveAttachmentPath(filePart);
      if (resolved) {
        try {
          const file = Bun.file(resolved.absolutePath);
          const buffer = await file.arrayBuffer();
          contentParts.push({
            type: 'file',
            data: new Uint8Array(buffer),
            mediaType: resolved.mimeType,
            filename: filePart.filename || 'unnamed',
          });
        } catch {
          // skip if file can't be read
        }
      }
    }

    for (const toolCall of toolCallBlocks) {
      contentParts.push({
        type: 'tool-call',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
      });
    }

    if (!hasToolCalls && !hasImages && !hasFiles) {
      const content = textBlocks.join('\n\n');
      result.push({
        role: hasCompactionTrigger ? 'user' : (msg.role as 'user' | 'assistant' | 'system'),
        content,
      });
      continue;
    }

    result.push({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: contentParts,
    });

    for (const toolResult of toolResultBlocks) {
      result.push({
        role: 'tool' as const,
        content: [toolResult],
      });
    }
  }

  return result as unknown as ModelMessage[];
}
