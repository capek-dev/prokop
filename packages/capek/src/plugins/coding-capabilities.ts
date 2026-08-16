/**
 * C4 coding capability services.
 *
 * The six coding capability domains (filesystem, editing, search, shell,
 * question, tool-output) are agent-scoped capability services. Each
 * capability plugin provides its service and registers the current
 * standard model-facing tools of that capability as kernel tool
 * contributions. A contribution requires its capability service, so tool
 * visibility derives from the available services: a profile that omits a
 * capability plugin hides that capability's tools.
 *
 * The tool payloads are the exact current `LoadedTool` objects from
 * `tools/standard-tools.ts` and `tools/tool-output-artifacts.ts`, so
 * definitions, timeouts, capabilities arrays, builtin paths, and executor
 * semantics are preserved by identity. No tool implementation changed.
 */

import type { LoadedTool } from '@jean2/sdk';
import { serviceKey } from '../kernel/service-key';
import type {
  CapekPlugin,
  PluginContext,
  ServiceKey,
  ToolDefinition as KernelToolDefinition,
} from '../kernel/types';
import { getStandardTool } from '../tools/standard-tools';
import { retrieveToolOutputStandardTool } from '../tools/tool-output-artifacts';

export type CodingCapabilityId =
  | 'filesystem'
  | 'editing'
  | 'search'
  | 'shell'
  | 'question'
  | 'tool-output';

/** The contract carried by one coding capability service. The tools are
 * the current standard `LoadedTool` objects: one execution path, no
 * behavior change. */
export interface CodingCapabilityService {
  readonly capability: CodingCapabilityId;
  readonly tools: readonly LoadedTool[];
}

export const capekFilesystemCapabilityKey = serviceKey<CodingCapabilityService>(
  'capek.filesystem-capability',
  'agent',
);

export const capekEditingCapabilityKey = serviceKey<CodingCapabilityService>(
  'capek.editing-capability',
  'agent',
);

export const capekSearchCapabilityKey = serviceKey<CodingCapabilityService>(
  'capek.search-capability',
  'agent',
);

export const capekShellCapabilityKey = serviceKey<CodingCapabilityService>(
  'capek.shell-capability',
  'agent',
);

export const capekQuestionCapabilityKey = serviceKey<CodingCapabilityService>(
  'capek.question-capability',
  'agent',
);

export const capekToolOutputCapabilityKey = serviceKey<CodingCapabilityService>(
  'capek.tool-output-capability',
  'agent',
);

/** Deterministic capability order: filesystem, editing, search, shell,
 * question, tool-output. Contribution orders are derived from this order
 * plus the position inside each capability, so the effective tool order
 * reproduces the exact current standard tool order. */
export const CODING_CAPABILITY_KEYS = [
  capekFilesystemCapabilityKey,
  capekEditingCapabilityKey,
  capekSearchCapabilityKey,
  capekShellCapabilityKey,
  capekQuestionCapabilityKey,
  capekToolOutputCapabilityKey,
] as const;

const CAPABILITY_ORDER_BASE: Record<CodingCapabilityId, number> = {
  filesystem: 100,
  editing: 200,
  search: 300,
  shell: 400,
  question: 500,
  'tool-output': 600,
};

function standardTool(name: string): LoadedTool {
  const loaded = getStandardTool(name);
  if (loaded === null) {
    throw new Error(`standard tool '${name}' is missing from the current set`);
  }
  return loaded;
}

/** The current standard tools grouped by capability. Tool order inside
 * each capability reproduces the current standard tool insertion order. */
export const STANDARD_CODING_CAPABILITIES: Readonly<
  Record<CodingCapabilityId, CodingCapabilityService>
> = {
  filesystem: {
    capability: 'filesystem',
    tools: [standardTool('read-file'), standardTool('write-file')],
  },
  editing: {
    capability: 'editing',
    tools: [standardTool('edit'), standardTool('edit-range'), standardTool('apply-patch')],
  },
  search: {
    capability: 'search',
    tools: [standardTool('ls'), standardTool('glob'), standardTool('grep')],
  },
  shell: {
    capability: 'shell',
    tools: [standardTool('shell')],
  },
  question: {
    capability: 'question',
    tools: [standardTool('question')],
  },
  'tool-output': {
    capability: 'tool-output',
    tools: [retrieveToolOutputStandardTool],
  },
};

/** One canonical coding capability plugin entry: the deterministic plugin
 * id paired with its service key and the current standard tool payloads. */
export interface CodingCapabilityPluginEntry {
  readonly id: string;
  readonly key: ServiceKey<CodingCapabilityService>;
  readonly service: CodingCapabilityService;
}

/** Canonical entries mirror the current standard tool insertion order:
 * filesystem, editing, search, shell, question, tool-output. */
export const CODING_CAPABILITY_PLUGIN_ENTRIES: readonly CodingCapabilityPluginEntry[] = [
  { id: 'coding.filesystem', key: capekFilesystemCapabilityKey, service: STANDARD_CODING_CAPABILITIES.filesystem },
  { id: 'coding.editing', key: capekEditingCapabilityKey, service: STANDARD_CODING_CAPABILITIES.editing },
  { id: 'coding.search', key: capekSearchCapabilityKey, service: STANDARD_CODING_CAPABILITIES.search },
  { id: 'coding.shell', key: capekShellCapabilityKey, service: STANDARD_CODING_CAPABILITIES.shell },
  { id: 'coding.question', key: capekQuestionCapabilityKey, service: STANDARD_CODING_CAPABILITIES.question },
  { id: 'coding.tool-output', key: capekToolOutputCapabilityKey, service: STANDARD_CODING_CAPABILITIES['tool-output'] },
];

export const CODING_CAPABILITY_PLUGIN_IDS = CODING_CAPABILITY_PLUGIN_ENTRIES.map(
  (entry) => entry.id,
);

/** The canonical six capability plugins, shared by the coding bundle and
 * the Jean2 current composition so plugin ids, service keys, and tool
 * payloads stay a single source of truth. */
export function codingCapabilityPlugins(): CapekPlugin<unknown>[] {
  return CODING_CAPABILITY_PLUGIN_ENTRIES.map((entry) =>
    codingCapabilityPlugin(entry.id, entry.key, entry.service));
}

/** One capability plugin: provides the capability service and registers
 * the capability's current tools as deterministic contributions. */
export function codingCapabilityPlugin(
  id: string,
  key: ServiceKey<CodingCapabilityService>,
  capability: CodingCapabilityService,
): CapekPlugin<unknown> {
  const orderBase = CAPABILITY_ORDER_BASE[capability.capability];
  return {
    id,
    scope: 'agent',
    provides: [key],
    setup(context: PluginContext) {
      context.provide(key, capability);
      capability.tools.forEach((loaded, index) => {
        context.contributeTool({
          id: `coding.${loaded.definition.name}`,
          order: orderBase + index,
          // The kernel ToolDefinition is the dependency-free opaque
          // payload: the SDK definition is a structural subset carried
          // through unchanged.
          definition: loaded.definition as KernelToolDefinition,
          requiredCapabilities: [key],
        });
      });
    },
  };
}
