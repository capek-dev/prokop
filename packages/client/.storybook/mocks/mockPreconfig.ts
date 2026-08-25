import type { Preconfig } from '@prokopai/sdk';
import { mockId, merge } from './mockHelpers';

// =============================================================================
// Preconfig Factory
// =============================================================================

export type MockPreconfigOverrides = Partial<Preconfig>;

export function createPreconfig(
  overrides: MockPreconfigOverrides = {},
): Preconfig {
  return merge<Preconfig>(
    {
      id: mockId('preconfig'),
      name: 'Default Agent',
      description: 'A general-purpose coding assistant.',
      systemPrompt: 'You are a helpful AI coding assistant.',
      tools: null,
      model: null,
      provider: null,
      variant: null,
      settings: null,
      isDefault: true,
      mode: 'primary',
      canSpawnSubagents: true,
      skills: null,
    },
    overrides,
  );
}

// =============================================================================
// Presets
// =============================================================================

export const preconfigPresets = {
  default: createPreconfig({
    name: 'Default Agent',
    description: 'A general-purpose coding assistant.',
    isDefault: true,
    mode: 'primary',
  }),
  codeReviewer: createPreconfig({
    name: 'Code Reviewer',
    description: 'Specialized in code review and quality feedback.',
    systemPrompt: 'You are a code reviewer. Focus on bugs, performance, and best practices.',
    tools: ['read-file', 'glob', 'grep'],
    mode: 'primary',
    canSpawnSubagents: false,
  }),
  explorer: createPreconfig({
    name: 'Explorer',
    description: 'Explores codebases and answers questions about code structure.',
    systemPrompt: 'You are an explorer agent. Find files, search code, and answer questions.',
    tools: ['read-file', 'glob', 'grep', 'ls'],
    mode: 'subagent',
    canSpawnSubagents: false,
  }),
  planner: createPreconfig({
    name: 'Planner',
    description: 'Plans architecture and creates implementation roadmaps.',
    systemPrompt: 'You are a planning agent. Break down tasks into actionable steps.',
    tools: ['read-file', 'glob', 'grep'],
    mode: 'both',
    canSpawnSubagents: ['explore'],
  }),
  restricted: createPreconfig({
    name: 'Read-Only Agent',
    description: 'Can only read files, no write access.',
    systemPrompt: 'You are a read-only assistant.',
    tools: ['read-file', 'glob', 'grep'],
    canSpawnSubagents: false,
    skills: [],
  }),
} as const;

/** Create a list of preconfigs */
export function createPreconfigList(): Preconfig[] {
  return [
    preconfigPresets.default,
    preconfigPresets.codeReviewer,
    preconfigPresets.explorer,
    preconfigPresets.planner,
  ];
}
