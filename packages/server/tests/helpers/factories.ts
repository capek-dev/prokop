import type {
  Session,
  UserMessage,
  AssistantMessage,
  TextPart,
  ToolPart,
} from '@prokopai/sdk';

export function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    workspaceId: 'test-workspace',
    preconfigId: null,
    title: 'Test Session',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: null,
    selectedModel: null,
    selectedProvider: null,
    selectedVariant: null,
    parentId: null,
    agentName: null,
    subagentStatus: null,
    runningAt: null,
    compacting: false,
    ...overrides,
  };
}

export function createTestUserMessage(
  sessionId: string,
  overrides: Partial<UserMessage> = {},
): UserMessage {
  return {
    id: crypto.randomUUID(),
    sessionId,
    role: 'user',
    createdAt: Date.now(),
    ...overrides,
  };
}

export function createTestAssistantMessage(
  sessionId: string,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    status: 'completed',
    modelId: 'gpt-4o',
    providerId: 'openai',
    tokens: { prompt: 100, completion: 50 },
    cost: 0,
    createdAt: Date.now(),
    completedAt: Date.now(),
    ...overrides,
  };
}

export function createTestTextPart(
  messageId: string,
  text: string = 'Hello world',
  overrides: Partial<TextPart> = {},
): TextPart {
  return {
    id: crypto.randomUUID(),
    messageId,
    createdAt: Date.now(),
    type: 'text',
    text,
    ...overrides,
  };
}

export function createTestToolPart(
  messageId: string,
  overrides: Partial<ToolPart> = {},
): ToolPart {
  return {
    id: crypto.randomUUID(),
    messageId,
    createdAt: Date.now(),
    type: 'tool',
    callId: crypto.randomUUID(),
    name: 'test-tool',
    state: {
      status: 'pending',
      input: { path: '/test' },
    },
    ...overrides,
  };
}
