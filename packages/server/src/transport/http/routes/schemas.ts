import { z } from 'zod';

// ── Shared primitives ──────────────────────────────────────────

export const uuidParam = z.object({
  id: z.string().min(1),
});

export const workspaceIdParam = z.object({
  workspaceId: z.string().min(1),
});

export const jobIdParam = z.object({
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
});

// ── Session schemas ────────────────────────────────────────────

export const createSessionSchema = z.object({
  id: z.string().optional(),
  workspaceId: z.string().optional(),
  preconfigId: z.string().nullable().optional(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
}).loose();

export const updateSessionSchema = z.object({
  title: z.string().nullable().optional(),
  status: z.enum(['active', 'closed']).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string()).optional(),
  autoApproveSeverity: z.enum(['off', 'none', 'low', 'medium', 'high']).nullable().optional(),
}).loose();

// ── Response format schemas ────────────────────────────────────

export const createResponseFormatSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  description: z.string().optional(),
  schema: z.record(z.string(), z.unknown()),
});

export const updateResponseFormatSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
}).loose();

// ── Workspace schemas ──────────────────────────────────────────

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  path: z.string().optional(),
  isVirtual: z.boolean().optional(),
  additionalPaths: z.array(z.string()).optional(),
}).loose();

// ── MCP schemas ────────────────────────────────────────────────

export const mcpServerNameSchema = z.object({
  name: z.string().min(1, { message: 'Server name is required' }),
});

// ── Scheduler schemas ──────────────────────────────────────────

export const createScheduledJobSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  prompt: z.string().min(1, { message: 'Prompt is required' }),
  scheduleKind: z.string().min(1, { message: 'scheduleKind is required' }),
  scheduleConfig: z.record(z.string(), z.unknown()),
  preconfigId: z.string().nullable().optional(),
  repeatLimit: z.number().nullable().optional(),
  originSessionId: z.string().nullable().optional(),
  reuseSession: z.boolean().optional(),
  includeHistory: z.boolean().optional(),
  autoApproveSeverity: z.enum(['off', 'none', 'low', 'medium', 'high']).nullable().optional(),
  notificationsEnabled: z.boolean().optional(),
}).loose();

export const updateScheduledJobSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
  scheduleKind: z.string().optional(),
  scheduleConfig: z.record(z.string(), z.unknown()).optional(),
  preconfigId: z.string().nullable().optional(),
  repeatLimit: z.number().nullable().optional(),
  originSessionId: z.string().nullable().optional(),
  reuseSession: z.boolean().optional(),
  includeHistory: z.boolean().optional(),
  autoApproveSeverity: z.enum(['off', 'none', 'low', 'medium', 'high']).nullable().optional(),
  enabled: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
}).loose();

// ── Tool env schemas ───────────────────────────────────────────

export const setToolEnvSchema = z.object({
  value: z.string().min(1, { message: 'Value must be a non-empty string' }),
});

// ── File save schema ───────────────────────────────────────────

export const saveFileSchema = z.object({
  path: z.string().min(1, { message: 'path is required' }),
  content: z.string(),
  expectedRevision: z.string().min(1, { message: 'expectedRevision is required' }),
  root: z.string().optional(),
  force: z.boolean().optional(),
}).loose();

// ── Agent memory schemas ───────────────────────────────────────

export const updateAgentMemorySchema = z.object({
  target: z.enum(['user', 'memory']),
  content: z.string(),
});

// ── Preconfig schemas ──────────────────────────────────────────

export const createPreconfigSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).nullable().optional(),
  model: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: z.string().optional(),
  canSpawnSubagents: z.union([z.boolean(), z.array(z.string())]).optional(),
  allowSelfAsSubagent: z.boolean().optional(),
  skills: z.array(z.string()).nullable().optional(),
  format: z.enum(['md']).optional(),
}).loose();

export const updatePreconfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).nullable().optional(),
  model: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: z.string().optional(),
  canSpawnSubagents: z.union([z.boolean(), z.array(z.string())]).nullable().optional(),
  allowSelfAsSubagent: z.boolean().optional(),
  skills: z.array(z.string()).nullable().optional(),
}).loose();

// ── Prompt schemas ─────────────────────────────────────────────

export const createPromptSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  description: z.string().optional(),
}).loose();

export const updatePromptSchema = z.object({
  content: z.string().optional(),
  description: z.string().optional(),
}).loose();

// ── Provider credentials schema ────────────────────────────────

export const providerCredentialsSchema = z.object({
  apiKey: z.string().nullable().optional(),
}).loose();

// ── Workspace settings schemas ─────────────────────────────────

const riskLevel = z.enum(['none', 'low', 'medium', 'high', 'critical']);
const severity = z.enum(['off', 'none', 'low', 'medium', 'high']);

export const workspaceSettingsSchema = z.object({
  memory: z.object({
    enabled: z.boolean(),
    permissionRisk: riskLevel,
  }).partial().optional(),
  skills: z.object({
    managementEnabled: z.boolean(),
    permissionRisk: riskLevel,
  }).partial().optional(),
  sessionSearch: z.object({
    enabled: z.boolean(),
    permissionRisk: riskLevel,
    includeToolResults: z.boolean(),
  }).partial().optional(),
  workflow: z.object({
    enabled: z.boolean(),
  }).partial().optional(),
  scheduling: z.object({
    enabled: z.boolean(),
    permissionRisk: riskLevel,
  }).partial().optional(),
  autoApproveSeverity: severity.nullable().optional(),
  preconfigs: z.object({
    selectedIds: z.array(z.string()).nullable().optional(),
    defaultId: z.string().nullable().optional(),
  }).optional(),
}).loose();

export const updateWorkspaceSettingsSchema = z.object({
  name: z.string().optional(),
  additionalPaths: z.array(z.string()).optional(),
  settings: workspaceSettingsSchema.optional(),
}).loose();

export const pinMessageSchema = z.object({
  sessionId: z.string().min(1, { message: 'sessionId is required' }),
  messageId: z.string().min(1, { message: 'messageId is required' }),
});

// ── Config route schemas (loose, config modules do deeper validation) ──

export const providerConnectSchema = z.object({
  redirectStrategy: z.enum(['client_redirect', 'manual_paste', 'server_callback']).optional(),
}).loose();

export const oauthCallbackSchema = z.object({
  flowId: z.string(),
  code: z.string(),
  state: z.string().optional(),
  redirectUri: z.string().optional(),
}).loose();

export const modelsSyncSchema = z.object({
  mode: z.enum(['override', 'merge']).optional(),
}).loose();

export const looseObjectSchema = z.record(z.string(), z.unknown());

// ── Notification / Web Push schemas ────────────────────────────

const httpsUrl = z.string().url().refine(
  (url) => url.startsWith('https://'),
  { message: 'Push endpoint must use HTTPS' },
);

export const upsertSubscriptionSchema = z.object({
  clientId: z.string().min(1, { message: 'clientId is required' }).max(256),
  clientServerId: z.string().min(1, { message: 'clientServerId is required' }).max(256),
  clientOrigin: z.string().url().max(2048).refine(
    (url) => url.startsWith('http://') || url.startsWith('https://'),
    { message: 'clientOrigin must be a valid URL' },
  ),
  subscription: z.object({
    endpoint: httpsUrl.max(2048, { message: 'Endpoint URL too long' }),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1, { message: 'p256dh key is required' }).max(256),
      auth: z.string().min(1, { message: 'auth key is required' }).max(256),
    }),
  }),
  preferences: z.object({
    completion: z.boolean(),
    permission: z.boolean(),
  }),
}).loose();

export const updateSubscriptionPreferencesSchema = z.object({
  preferences: z.object({
    completion: z.boolean(),
    permission: z.boolean(),
  }),
}).loose();
