import { describe, test, expect, mock, afterEach } from 'bun:test';
import type { ToolResult, Session } from '@jean2/sdk';
import type { BuildToolsOptions } from '@/core/build-tools';

function createMockLoadedTool(name: string, capabilities?: string[]) {
  return {
    definition: {
      name,
      description: `Mock ${name} tool`,
      inputSchema: {
        type: 'object',
        properties: { input: { type: 'string' } },
      },
      timeout: 60000,
      ...(capabilities ? { capabilities } : {}),
    },
    runtime: 'bun',
    scriptPath: '/mock/tool.ts',
  };
}

async function setupMocks(opts: {
  getToolReturns?: unknown[];
  executeToolResult?: ToolResult;
  canSpawnSubagent?: boolean;
  skillTool?: { name: string; tool: unknown } | null;
  mcpTools?: Record<string, unknown>;
  sessions?: Record<string, Partial<Session>>;
  sessionNotFound?: boolean;
}) {
  let getToolCallIndex = 0;
  const getToolReturns = opts.getToolReturns ?? [];

  mock.module('@/tools', () => ({
    getTool: mock(async (_name: string) => {
      return getToolReturns[getToolCallIndex++] ?? null;
    }),
    executeTool: mock(async (_opts: unknown): Promise<ToolResult> =>
      opts.executeToolResult ?? { success: true, result: 'mock-result' },
    ),
  }));

  mock.module('@/tools/llm-api', () => ({
    createLlmApi: mock(() => ({})),
  }));

  mock.module('@/tools/ask-user-api', () => ({
    createAskApi: mock(() => ({})),
    rejectPendingAsksByToolCallId: mock((_toolCallId: string, _error?: Error) => []),
  }));

  mock.module('@/core/subagent', () => ({
    getSubagentToolDefinition: mock(async () => ({
      name: 'task',
      description: 'Launch a subagent',
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, subagent_type: { type: 'string' } } },
      timeout: 300000,
    })),
    executeSubagent: mock(async () => ({ task_id: 'task-1', result: 'subagent result' })),
    canSpawnSubagent: mock((_sessionId: string) => opts.canSpawnSubagent ?? true),
  }));

  mock.module('@/core/interrupt', () => ({
    interruptManager: {
      registerToolExecution: mock(() => new AbortController()),
      unregisterToolExecution: mock((_sid: string, _tcid: string) => {}),
    },
  }));

  mock.module('@/store', () => ({
    transitionToolToRunningByCallId: mock(() => null),
    getSession: mock((id: string) => {
      if (opts.sessionNotFound) return null;
      if (opts.sessions && opts.sessions[id]) {
        return { id, parentId: null, metadata: null, ...opts.sessions[id] } as Session;
      }
      return { id, parentId: null, metadata: null } as Session;
    }),
    getWorkspace: mock(() => ({
      id: 'ws-1',
      path: '/workspace',
      settings: {},
    })),
  }));

  mock.module('@/paths', () => ({
    getUploadDir: mock(() => '/tmp/uploads'),
  }));

  mock.module('@/core/broadcast', () => ({
    broadcastEvent: mock(() => {}),
  }));

  mock.module('@/utils/truncate-tool-result', () => ({
    truncateToolResult: mock((result: unknown) => result),
  }));

  mock.module('@/memory', () => ({
    memoryToolDefinition: {
      name: 'memory',
      description: 'Mock memory tool',
      inputSchema: { type: 'object', properties: {} },
    },
    executeMemoryTool: mock(async () => ({ success: true })),
  }));

  mock.module('@/mcp', () => ({
    getTools: mock(async () => opts.mcpTools ?? {}),
  }));

  mock.module('@/agents/storage', () => ({
    getAgentDirectory: mock(async () => null),
  }));

  mock.module('@/core/workflow', () => ({
    executeWorkflow: mock(async () => ({ success: true })),
    getWorkflowToolDefinition: mock(async () => null),
  }));

  mock.module('@/session-search', () => ({
    sessionSearchToolDefinition: {
      name: 'session_search',
      description: 'Mock session search tool',
      inputSchema: { type: 'object', properties: {} },
    },
    executeSessionSearchTool: mock(async () => ({ success: true })),
  }));

  mock.module('@/scheduler/scheduler-tool', () => ({
    schedulerToolDefinition: {
      name: 'scheduler',
      description: 'Mock scheduler tool',
      inputSchema: { type: 'object', properties: {} },
    },
    executeSchedulerTool: mock(async () => ({ success: true })),
  }));

  mock.module('@/skills', () => ({
    createSkillTool: mock(async () => opts.skillTool ?? null),
    skillManageToolDefinition: {
      name: 'skill_manage',
      description: 'Mock skill manage tool',
      inputSchema: { type: 'object', properties: {} },
    },
    executeSkillManageTool: mock(async () => ({ success: true, title: 'Mock' })),
    buildSkillManageToolDescription: mock(async () => 'Mock skill manage description'),
  }));

  const { buildAiSdkTools } = await import('@/core/build-tools');
  return { buildAiSdkTools };
}

function defaultOptions(overrides: Partial<BuildToolsOptions> = {}): BuildToolsOptions {
  return {
    toolNames: [],
    workspacePath: undefined,
    workspaceId: undefined,
    sessionId: 'sess-1',
    modelId: 'gpt-4o',
    providerId: 'openai',
    canSpawnSubagents: false,
    allowedSkills: null,
    broadcastFn: undefined,
    ...overrides,
  };
}

describe('build-tools', () => {
  afterEach(() => mock.restore());

  describe('empty tool list', () => {
    test('returns empty object when no tools and no workspace', async () => {
      const { buildAiSdkTools } = await setupMocks({});
      const tools = await buildAiSdkTools(defaultOptions({ toolNames: [] }));
      expect(Object.keys(tools)).toHaveLength(0);
    });

    test('returns empty object when workspace has no skill or mcp tools', async () => {
      const { buildAiSdkTools } = await setupMocks({ skillTool: null, mcpTools: {} });
      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        workspacePath: '/workspace',
        workspaceId: 'ws-1',
      }));
      expect(Object.keys(tools)).toHaveLength(0);
    });
  });

  describe('regular tool loading', () => {
    test('loads each tool from toolNames', async () => {
      const { buildAiSdkTools } = await setupMocks({
        getToolReturns: [
          createMockLoadedTool('read-file'),
          createMockLoadedTool('write-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['read-file', 'write-file'],
      }));

      expect(tools).toHaveProperty('read-file');
      expect(tools).toHaveProperty('write-file');
      expect(Object.keys(tools)).toHaveLength(2);
    });

    test('skips tools that are not found', async () => {
      const { buildAiSdkTools } = await setupMocks({
        getToolReturns: [
          createMockLoadedTool('read-file'),
          null,
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['read-file', 'nonexistent'],
      }));

      expect(tools).toHaveProperty('read-file');
      expect(tools).not.toHaveProperty('nonexistent');
      expect(Object.keys(tools)).toHaveLength(1);
    });

    test('created tool has execute function', async () => {
      const { buildAiSdkTools } = await setupMocks({
        getToolReturns: [createMockLoadedTool('test-tool')],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['test-tool'],
      }));

      const aiTool = tools['test-tool'];
      expect(aiTool).toBeDefined();
      expect(typeof aiTool.execute).toBe('function');
    });
  });

  describe('tool execution', () => {
    test('returns error object when executeTool fails', async () => {
      const { buildAiSdkTools } = await setupMocks({
        getToolReturns: [createMockLoadedTool('test-tool')],
        executeToolResult: { success: false, error: 'Tool crashed' },
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['test-tool'],
      }));

      const tool = tools['test-tool']!;
      const result = await tool.execute!({}, { toolCallId: 'call-1', messages: [] });
      expect(result).toEqual({ error: 'Tool crashed' });
    });
  });

  describe('subagent tool', () => {
    test('includes task tool when canSpawnSubagents is true and canSpawnSubagent returns true', async () => {
      const { buildAiSdkTools } = await setupMocks({
        canSpawnSubagent: true,
        getToolReturns: [createMockLoadedTool('read-file')],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['read-file'],
        canSpawnSubagents: true,
      }));

      expect(tools).toHaveProperty('task');
    });

    test('excludes task tool when canSpawnSubagents is false', async () => {
      const { buildAiSdkTools } = await setupMocks({ canSpawnSubagent: true });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['read-file'],
        canSpawnSubagents: false,
      }));

      expect(tools).not.toHaveProperty('task');
    });

    test('excludes task tool when canSpawnSubagent returns false', async () => {
      const { buildAiSdkTools } = await setupMocks({ canSpawnSubagent: false });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        canSpawnSubagents: true,
      }));

      expect(tools).not.toHaveProperty('task');
    });

    test('excludes task tool when canSpawnSubagents is an empty array', async () => {
      const { buildAiSdkTools } = await setupMocks({ canSpawnSubagent: true });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        canSpawnSubagents: [],
      }));

      expect(tools).not.toHaveProperty('task');
    });

    test('includes task tool when canSpawnSubagents is non-empty array', async () => {
      const { buildAiSdkTools } = await setupMocks({ canSpawnSubagent: true });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        canSpawnSubagents: ['explore'],
      }));

      expect(tools).toHaveProperty('task');
    });
  });

  describe('skill tool', () => {
    test('adds skill tool to tools when returned', async () => {
      const { buildAiSdkTools } = await setupMocks({
        skillTool: {
          name: 'agent-browser',
          tool: { execute: async () => {} },
        },
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        workspacePath: '/workspace',
        workspaceId: 'ws-1',
      }));

      expect(tools).toHaveProperty('agent-browser');
    });

    test('does not load skill tool when workspacePath is undefined', async () => {
      const { buildAiSdkTools } = await setupMocks({});

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        workspacePath: undefined,
      }));

      expect(Object.keys(tools)).toHaveLength(0);
    });
  });

  describe('MCP tools', () => {
    test('merges MCP tools into result', async () => {
      const { buildAiSdkTools } = await setupMocks({
        skillTool: null,
        mcpTools: {
          'mcp-tool-1': { execute: async () => 'mcp1' },
          'mcp-tool-2': { execute: async () => 'mcp2' },
        },
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        workspacePath: '/workspace',
        workspaceId: 'ws-1',
      }));

      expect(tools).toHaveProperty('mcp-tool-1');
      expect(tools).toHaveProperty('mcp-tool-2');
    });

    test('does not load MCP tools when workspacePath is undefined', async () => {
      const { buildAiSdkTools } = await setupMocks({});

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: [],
        workspacePath: undefined,
      }));

      expect(Object.keys(tools)).toHaveLength(0);
    });
  });

  describe('integration scenarios', () => {
    test('combines regular tools, skill tool, and MCP tools', async () => {
      const { buildAiSdkTools } = await setupMocks({
        getToolReturns: [createMockLoadedTool('read-file')],
        skillTool: { name: 'agent-browser', tool: { execute: async () => {} } },
        mcpTools: { 'mcp-server': { execute: async () => {} } },
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['read-file'],
        workspacePath: '/workspace',
        workspaceId: 'ws-1',
      }));

      expect(tools).toHaveProperty('read-file');
      expect(tools).toHaveProperty('agent-browser');
      expect(tools).toHaveProperty('mcp-server');
      expect(Object.keys(tools)).toHaveLength(3);
    });

    test('combines regular tools with subagent tool', async () => {
      const { buildAiSdkTools } = await setupMocks({
        canSpawnSubagent: true,
        getToolReturns: [createMockLoadedTool('read-file')],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        toolNames: ['read-file'],
        canSpawnSubagents: true,
      }));

      expect(tools).toHaveProperty('read-file');
      expect(tools).toHaveProperty('task');
      expect(Object.keys(tools)).toHaveLength(2);
    });
  });

  describe('capability filtering', () => {
    test('includes question tool in a normal top-level interactive session', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'top-1': { parentId: null, metadata: null },
        },
        getToolReturns: [
          createMockLoadedTool('question', ['interactive-user-input']),
          createMockLoadedTool('read-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'top-1',
        toolNames: ['question', 'read-file'],
      }));

      expect(tools).toHaveProperty('question');
      expect(tools).toHaveProperty('read-file');
    });

    test('excludes question tool when current session has a parent', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'parent-1': { parentId: null, metadata: null },
          'child-1': { parentId: 'parent-1', metadata: null },
        },
        getToolReturns: [
          createMockLoadedTool('question', ['interactive-user-input']),
          createMockLoadedTool('read-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'child-1',
        toolNames: ['question', 'read-file'],
      }));

      expect(tools).not.toHaveProperty('question');
      expect(tools).toHaveProperty('read-file');
    });

    test('excludes question tool when root session has metadata.scheduledJobId', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'sched-1': { parentId: null, metadata: { scheduledJobId: 'job-42' } },
        },
        getToolReturns: [
          createMockLoadedTool('question', ['interactive-user-input']),
          createMockLoadedTool('read-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'sched-1',
        toolNames: ['question', 'read-file'],
      }));

      expect(tools).not.toHaveProperty('question');
      expect(tools).toHaveProperty('read-file');
    });

    test('excludes question tool from a child whose root is scheduled', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'sched-1': { parentId: null, metadata: { scheduledJobId: 'job-42' } },
          'child-1': { parentId: 'sched-1', metadata: null },
        },
        getToolReturns: [
          createMockLoadedTool('question', ['interactive-user-input']),
          createMockLoadedTool('read-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'child-1',
        toolNames: ['question', 'read-file'],
      }));

      expect(tools).not.toHaveProperty('question');
      expect(tools).toHaveProperty('read-file');
    });

    test('keeps a tool without capabilities available in all scopes', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'sched-1': { parentId: null, metadata: { scheduledJobId: 'job-1' } },
          'child-1': { parentId: 'sched-1', metadata: null },
        },
        getToolReturns: [
          createMockLoadedTool('read-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'child-1',
        toolNames: ['read-file'],
      }));

      expect(tools).toHaveProperty('read-file');
    });

    test('keeps tools with unknown capabilities available', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'child-1': { parentId: 'parent-1', metadata: null },
          'parent-1': { parentId: null, metadata: null },
        },
        getToolReturns: [
          createMockLoadedTool('read-file', ['some-future-capability']),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'child-1',
        toolNames: ['read-file'],
      }));

      expect(tools).toHaveProperty('read-file');
    });

    test('keeps non-question tools available in restricted scopes', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'sched-1': { parentId: null, metadata: { scheduledJobId: 'job-1' } },
          'child-1': { parentId: 'sched-1', metadata: null },
        },
        getToolReturns: [
          createMockLoadedTool('read-file'),
          createMockLoadedTool('grep'),
          createMockLoadedTool('ls'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'child-1',
        toolNames: ['read-file', 'grep', 'ls'],
      }));

      expect(tools).toHaveProperty('read-file');
      expect(tools).toHaveProperty('grep');
      expect(tools).toHaveProperty('ls');
    });

    test('uses unrestricted top-level fallback when session record is missing', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessionNotFound: true,
        getToolReturns: [
          createMockLoadedTool('question', ['interactive-user-input']),
          createMockLoadedTool('read-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'gone',
        toolNames: ['question', 'read-file'],
      }));

      expect(tools).toHaveProperty('question');
      expect(tools).toHaveProperty('read-file');
    });

    test('parent-cycle protection returns a deterministic scope set', async () => {
      const { buildAiSdkTools } = await setupMocks({
        sessions: {
          'a': { parentId: 'a', metadata: null },
        },
        getToolReturns: [
          createMockLoadedTool('question', ['interactive-user-input']),
          createMockLoadedTool('read-file'),
        ],
      });

      const tools = await buildAiSdkTools(defaultOptions({
        sessionId: 'a',
        rootSessionId: 'a',
        toolNames: ['question', 'read-file'],
      }));

      expect(tools).not.toHaveProperty('question');
      expect(tools).toHaveProperty('read-file');
    });
  });
});
