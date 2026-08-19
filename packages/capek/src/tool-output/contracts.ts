/**
 * C6 tool-output policy contracts.
 *
 * The agent-scoped tool-output service owns the model-facing decisions that
 * previously lived as module-level constants and a module-global WeakSet in
 * `tools/tool-output-artifacts.ts` plus the legacy filesystem truncation in
 * `utils/truncate-tool-result.ts`:
 *
 * - Bounding thresholds: 50k serialized chars threshold, 10k preview chars,
 *   10k default page chars, 20k max page chars.
 * - The stable artifact envelope: `type: 'tool-output-artifact'` with the
 *   strict artifact id, bounded preview, format, totalChars, and the exact
 *   retrieval message; the bounded fallback envelope for unserializable
 *   output or failed persistence (`tool-output-preview`).
 * - The model-facing truncation decisions of the legacy
 *   `truncateToolResult` (exact note strings, `_persisted`/`_filePath`/
 *   `_originalSize` metadata, and the exact synchronous filesystem write
 *   behavior, including its pre-C6 non-fail-open filesystem errors).
 * - Retrieval: strict ID validation and session-scoped page retrieval
 *   remain mandatory invariants enforced by the storage layer
 *   (`isToolOutputArtifactId` and the session match); the service owns the
 *   retrieval tool construction and the exact `Tool output artifact not
 *   found` failure.
 *
 * There is no current environment source for these thresholds; the plugin
 * freezes the exact current constants into provider options at composition
 * (the same documented pattern as the generic ask timeout in C6 step 3).
 * The page-size limits (10k default, 20k max) are NOT options: they are
 * mandatory storage-layer invariants (`DEFAULT_TOOL_OUTPUT_PAGE_CHARS` and
 * `MAX_TOOL_OUTPUT_PAGE_CHARS` in `storage/tool-output-artifacts.ts`), so a
 * custom provider cannot change retrieval pagination. The
 * serialization/persistence failure behavior stays fail-open exactly
 * where the current behavior is fail-open (the policy returns the bounded
 * preview and never breaks the original tool result); the legacy filesystem
 * truncation keeps its exact pre-C6 non-fail-open error propagation.
 *
 * Compression/observe mode is NOT part of this slice: no compression code
 * exists in this branch (only an untracked plan document), so no observe
 * behavior is introduced.
 */

import type { Tool } from 'ai';
import type { ToolOutputArtifactFormat, ToolOutputArtifactPage } from '../storage/contracts';

export interface ToolOutputPolicyOptions {
  /** Serialized-char threshold above which output becomes an artifact. */
  thresholdChars: number;
  /** Bounded preview length for the model-facing envelope. */
  previewChars: number;
  /** Exact retrieval tool name. */
  retrievalToolName: string;
  /** Legacy filesystem truncation threshold in serialized chars. */
  truncationMaxChars: number;
  /** Legacy filesystem truncation preview length in chars. */
  truncationPreviewChars: number;
  /** Legacy filesystem truncation temp directory root. */
  truncationTempDir: string;
}

export interface ToolOutputArtifactReference {
  type: 'tool-output-artifact';
  artifactId: string;
  preview: string;
  format: ToolOutputArtifactFormat;
  totalChars: number;
  complete: false;
  message: string;
}

export interface ToolOutputFallback {
  type: 'tool-output-preview';
  preview: string;
  totalChars: number | null;
  complete: false;
  message: string;
}

export interface ToolOutputPolicyContext {
  sessionId: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolOutputArtifactService {
  readonly id: string;
  /** Frozen composition-time options. */
  readonly options: Readonly<ToolOutputPolicyOptions>;
  /** Applies the artifact envelope decision to one tool result. */
  applyToolOutputPolicy(result: unknown, context: ToolOutputPolicyContext): Promise<unknown>;
  /** Session-scoped retrieval over the active storage bundle. */
  retrieveToolOutput(
    sessionId: string,
    input: { artifactId: string; offset?: number; limit?: number },
  ): Promise<ToolOutputArtifactPage | null>;
  /** Builds the AI SDK retrieval tool bound to a session. */
  buildRetrieveToolOutputAiTool(sessionId: string): Tool;
  /** Wraps a tool map with the policy; per-service WeakSet excludes
   * self-wrapping, the retrieval tool, and non-function tools. */
  wrapToolsWithOutputPolicy(
    tools: Record<string, Tool>,
    context: Pick<ToolOutputPolicyContext, 'sessionId' | 'workspaceId'>,
  ): Record<string, Tool>;
  /** Legacy filesystem truncation with the exact pre-C6 behavior. */
  truncateToolResult(
    result: unknown,
    sessionId: string,
    toolName: string,
    outputDir?: string,
  ): unknown;
}
