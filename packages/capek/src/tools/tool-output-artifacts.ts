/**
 * C6 pinned compatibility forwarder. The tool-output policy (envelope,
 * bounded fallback, retrieval tool, wrap WeakSet) moved to the tool-output
 * domain (`tool-output/policy.ts` owns the scoped service). Every prior
 * export resolves to the same function identity or a stable singleton over
 * the NON-REPLACEABLE retrieval runtime, so `core/build-tools.ts`,
 * `core/message-utils.ts`, `plugins/coding-capabilities.ts`, and
 * `tools/standard-tools.ts` keep working unchanged until C8 retires the
 * compat surface.
 */

import type { LoadedTool } from '@jean2/sdk';
import {
  getRetrieveToolOutputStandardTool,
  isToolOutputArtifactReference,
  RETRIEVE_TOOL_OUTPUT_NAME,
  TOOL_OUTPUT_PREVIEW_CHARS,
  TOOL_OUTPUT_THRESHOLD_CHARS,
} from '../tool-output/policy';
import type {
  ToolOutputArtifactReference,
  ToolOutputFallback,
  ToolOutputPolicyContext,
} from '../tool-output/policy';

export {
  applyToolOutputPolicy,
  buildRetrieveToolOutputAiTool,
  retrieveToolOutput,
  wrapToolsWithOutputPolicy,
} from '../tool-output/policy';
export {
  isToolOutputArtifactReference,
  RETRIEVE_TOOL_OUTPUT_NAME,
  TOOL_OUTPUT_PREVIEW_CHARS,
  TOOL_OUTPUT_THRESHOLD_CHARS,
};
export type {
  ToolOutputArtifactReference,
  ToolOutputFallback,
  ToolOutputPolicyContext,
};

/** Stable singleton (identity preserved) over the non-replaceable retrieval
 * runtime: the caller session is derived from the execution context and the
 * strict UUID/session-scoped storage lookup is performed by the runtime, so
 * a replaced envelope/bounding provider can never return foreign pages. */
export const retrieveToolOutputStandardTool: LoadedTool =
  getRetrieveToolOutputStandardTool();
