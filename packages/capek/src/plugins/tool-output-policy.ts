import { getHostLayout } from '../runtime/host-layout';
import type { CapekPlugin, PluginContext, ToolDefinition as KernelToolDefinition } from '../kernel/types';
import {
  createToolOutputService,
  retrieveToolOutputStandardTool,
  type ToolOutputPolicyOptions,
} from '../tool-output/policy';
import { capekToolOutputPolicyKey } from './service-keys';

/**
 * C6 provider for the agent-scoped tool-output policy service
 * (`capek.tool-output-policy`). The bounding thresholds and legacy
 * truncation constants translate into provider options here, at
 * composition: there is no current environment source for them, so the
 * exact pre-C6 constants freeze into the service options (the same
 * documented pattern as the generic ask timeout in C6 step 3). The page
 * limits (10k default, 20k max) are mandatory storage invariants and are
 * NOT options. The default provider reproduces the exact envelope,
 * fallback, retrieval, wrap, and truncation behavior; the strict ID
 * validation and session-scoped retrieval invariants stay in the storage
 * layer.
 */
export function toolOutputPolicyPlugin(id: string, tempRoot?: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekToolOutputPolicyKey],
    setup(context: PluginContext) {
      const options: ToolOutputPolicyOptions = {
        thresholdChars: 50_000,
        previewChars: 10_000,
        retrievalToolName: 'retrieve-tool-output',
        truncationMaxChars: 50_000,
        truncationPreviewChars: 10_000,
        truncationTempDir: tempRoot ?? getHostLayout().toolOutputTempRoot(),
      };
      context.provide(
        capekToolOutputPolicyKey,
        createToolOutputService({ id, options }),
      );
      // The retrieval tool is the tool-output capability's own contribution:
      // it enters the effective catalog through the service it depends on.
      context.contributeTool({
        id: 'tool-output.retrieve-tool-output',
        order: 600,
        definition: retrieveToolOutputStandardTool.definition as KernelToolDefinition,
        payload: retrieveToolOutputStandardTool,
        requiredCapabilities: [capekToolOutputPolicyKey],
      });
    },
  };
}
