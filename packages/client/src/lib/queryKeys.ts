export const queryKeys = {
  sessions: {
    all: ['sessions'] as const,
    byWorkspace: (workspaceId: string) => ['sessions', 'workspace', workspaceId] as const,
    byWorkspaceInfinite: (options: {
      workspaceId: string;
      status?: string;
      rootOnly?: boolean;
      limit: number;
    }) => ['sessions', 'workspace', 'infinite', options] as const,
    grouped: (workspaceIds: string[], status?: string) =>
      ['sessions', 'grouped', { workspaceIds: [...workspaceIds].sort(), status }] as const,
    groupedBounded: (workspaceIds: string[], status: string | undefined, limitPerWorkspace: number) =>
      ['sessions', 'grouped', 'bounded', { workspaceIds: [...workspaceIds].sort(), status, limitPerWorkspace }] as const,
    tags: (workspaceId: string) => ['sessions', 'tags', workspaceId] as const,
    toolDebug: (sessionId: string, partId: string) =>
      ['sessions', sessionId, 'tool-debug', partId] as const,
  },
  tools: {
    all: ['tools'] as const,
    envVars: ['tools', 'envVars'] as const,
  },
  config: {
    models: ['config', 'models'] as const,
    preconfigs: ['config', 'preconfigs'] as const,
    prompts: ['config', 'prompts'] as const,
    providers: {
      all: ['providers'] as const,
      credentials: ['providers', 'credentials'] as const,
    },
    responseFormats: ['config', 'responseFormats'] as const,
    agents: ['config', 'agents'] as const,
  },
  mcp: {
    status: (workspaceId: string) => ['mcp', 'status', workspaceId] as const,
  },
  files: {
    // Prefix keys for targeted invalidation (prefix-matched by TanStack Query)
    browsePrefix: ['files', 'browse'] as const,
    searchPrefix: ['files', 'search'] as const,
    browseFsPrefix: ['files', 'browseFs'] as const,
    drivesPrefix: ['files', 'drives'] as const,
    parentPrefix: ['files', 'parent'] as const,
    gitStatusPrefix: ['files', 'git-status'] as const,
    // Individual query key builders
    browse: (workspaceId: string, path?: string, opts?: { showHidden?: boolean; root?: string }) =>
      ['files', 'browse', workspaceId, path ?? '.', opts] as const,
    tree: (workspaceId: string, root?: string) => ['files', 'tree', workspaceId, root] as const,
    treePrefix: ['files', 'tree'] as const,
    search: (workspaceId: string, query: string, root?: string) =>
      ['files', 'search', workspaceId, query, root] as const,
    browseFs: (path: string) => ['files', 'browseFs', path] as const,
    drives: ['files', 'drives'] as const,
    parent: (path: string) => ['files', 'parent', path] as const,
    preview: (workspaceId: string, path: string, root?: string) =>
      ['files', 'preview', workspaceId, path, root] as const,
    gitDiff: (workspaceId: string, path: string, root?: string) =>
      ['files', 'git-diff', workspaceId, path, root] as const,
    gitStatus: (workspaceId: string, root?: string) =>
      ['files', 'git-status', workspaceId, root] as const,
  },
  serverInfo: ['serverInfo'] as const,
  pinnedMessages: {
    byWorkspace: (workspaceId: string) => ['pinnedMessages', 'workspace', workspaceId] as const,
  },
  transcript: {
    page: (sessionId: string, before?: number) =>
      ['transcript', sessionId, { before: before ?? 'latest' }] as const,
  },
  scheduledJobs: {
    byWorkspace: (workspaceId: string) => ['scheduledJobs', 'workspace', workspaceId] as const,
  },
} as const;
