import type { ToolDefinition, ToolResult } from '@prokopai/sdk';
import { merge } from './mockHelpers';

// =============================================================================
// ToolDefinition Factory
// =============================================================================

export type MockToolDefinitionOverrides = Partial<ToolDefinition>;

export function createToolDefinition(
  overrides: MockToolDefinitionOverrides = {},
): ToolDefinition {
  return merge<ToolDefinition>(
    {
      name: 'read-file',
      description: 'Read the contents of a file from the filesystem.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
        },
        required: ['path'],
      },
      timeout: 30000,
    },
    overrides,
  );
}

// =============================================================================
// ToolResult Factory
// =============================================================================

export function createToolResult(
  overrides: Partial<ToolResult> = {},
): ToolResult {
  return merge<ToolResult>(
    {
      success: true,
      result: 'File contents loaded successfully.',
    },
    overrides,
  );
}

// =============================================================================
// Pre-built tool definitions
// =============================================================================

export const toolDefinitionPresets = {
  readFile: createToolDefinition({
    name: 'read-file',
    description: 'Read file contents from the filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Line number to start from' },
        limit: { type: 'number', description: 'Maximum number of lines' },
      },
      required: ['path'],
    },
  }),

  writeFile: createToolDefinition({
    name: 'write-file',
    description: 'Write content to a file, creating or overwriting.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  }),

  shell: createToolDefinition({
    name: 'shell',
    description: 'Execute a shell command.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
    timeout: 60000,
  }),

  edit: createToolDefinition({
    name: 'edit',
    description: 'Performs string replacements in files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldString: { type: 'string' },
        newString: { type: 'string' },
      },
      required: ['path', 'oldString', 'newString'],
    },
  }),

  glob: createToolDefinition({
    name: 'glob',
    description: 'Find files matching a glob pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
        path: { type: 'string', description: 'Directory to search' },
      },
      required: ['pattern'],
    },
  }),

  grep: createToolDefinition({
    name: 'grep',
    description: 'Search for text patterns in files.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'File or directory' },
        include: { type: 'string', description: 'File pattern filter' },
      },
      required: ['pattern', 'path'],
    },
  }),

  webfetch: createToolDefinition({
    name: 'webfetch',
    description: 'Fetch content from a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        format: { type: 'string', enum: ['markdown', 'text', 'html'] },
      },
      required: ['url'],
    },
  }),

  task: createToolDefinition({
    name: 'task',
    description: 'Launch a subagent to handle complex tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        prompt: { type: 'string' },
        subagent_type: { type: 'string', enum: ['explore'] },
      },
      required: ['description', 'prompt', 'subagent_type'],
    },
  }),
} as const;

/** Create a list of all built-in tool definitions */
export function createToolDefinitionList(): ToolDefinition[] {
  return Object.values(toolDefinitionPresets);
}
