import type {
  UserMessage,
  AssistantMessage,
  SystemMessage,
  TextPart,
  ReasoningPart,
  ToolPart,
  StepPart,
  CompactionPart,
  FilePart,
  ImagePart,
  MessageWithParts,
  QueuedMessage,
  AssistantStatus,
  ToolState,
  ToolStatePending,
  ToolStateRunning,
  ToolStateCompleted,
  ToolStateError,
  ToolStateInterrupted,
} from '@prokopai/sdk';
import { mockId, mockNow, mockSecondsAgo, merge } from './mockHelpers';

// =============================================================================
// Part Factories
// =============================================================================

export function createTextPart(
  overrides: Partial<TextPart> = {},
  text = 'Hello, this is a text part.',
): TextPart {
  return merge<TextPart>(
    {
      id: mockId('part'),
      messageId: overrides.messageId ?? mockId('msg'),
      createdAt: mockNow(),
      type: 'text',
      text,
    },
    overrides,
  );
}

export function createReasoningPart(
  overrides: Partial<ReasoningPart> = {},
  text = 'Let me think about this step by step...',
): ReasoningPart {
  return merge<ReasoningPart>(
    {
      id: mockId('part'),
      messageId: overrides.messageId ?? mockId('msg'),
      createdAt: mockNow(),
      type: 'reasoning',
      text,
    },
    overrides,
  );
}

export function createToolPart(
  overrides: Partial<ToolPart> = {},
  state?: ToolState,
): ToolPart {
  return merge<ToolPart>(
    {
      id: mockId('part'),
      messageId: overrides.messageId ?? mockId('msg'),
      createdAt: mockNow(),
      type: 'tool',
      callId: mockId('call'),
      name: 'read-file',
      state: state ?? createToolStateCompleted(),
    },
    overrides,
  );
}

export function createStepPart(overrides: Partial<StepPart> = {}): StepPart {
  return merge<StepPart>(
    {
      id: mockId('part'),
      messageId: overrides.messageId ?? mockId('msg'),
      createdAt: mockNow(),
      type: 'step',
      number: 1,
      status: 'finished',
      finishReason: 'stop',
      tokens: { prompt: 500, completion: 300 },
      cost: 0.003,
    },
    overrides,
  );
}

export function createCompactionPart(overrides: Partial<CompactionPart> = {}): CompactionPart {
  return merge<CompactionPart>(
    {
      id: mockId('part'),
      messageId: overrides.messageId ?? mockId('msg'),
      createdAt: mockNow(),
      type: 'compaction',
      auto: true,
      overflow: false,
    },
    overrides,
  );
}

export function createFilePart(overrides: Partial<FilePart> = {}): FilePart {
  return merge<FilePart>(
    {
      id: mockId('part'),
      messageId: overrides.messageId ?? mockId('msg'),
      createdAt: mockNow(),
      type: 'file',
      mimeType: 'text/plain',
      filename: 'example.txt',
      url: 'data:text/plain;base64,SGVsbG8gV29ybGQ=',
    },
    overrides,
  );
}

export function createImagePart(overrides: Partial<ImagePart> = {}): ImagePart {
  return merge<ImagePart>(
    {
      id: mockId('part'),
      messageId: overrides.messageId ?? mockId('msg'),
      createdAt: mockNow(),
      type: 'image',
      url: 'https://placehold.co/400x300/png',
      mimeType: 'image/png',
    },
    overrides,
  );
}

// =============================================================================
// Tool State Factories
// =============================================================================

export function createToolStatePending(
  overrides: Partial<ToolStatePending> = {},
): ToolStatePending {
  return merge<ToolStatePending>(
    { status: 'pending', input: { path: '/src/index.ts' } },
    overrides,
  );
}

export function createToolStateRunning(
  overrides: Partial<ToolStateRunning> = {},
): ToolStateRunning {
  return merge<ToolStateRunning>(
    {
      status: 'running',
      input: { path: '/src/index.ts' },
      startedAt: mockSecondsAgo(5),
    },
    overrides,
  );
}

export function createToolStateCompleted(
  overrides: Partial<ToolStateCompleted> = {},
): ToolStateCompleted {
  return merge<ToolStateCompleted>(
    {
      status: 'completed',
      input: { path: '/src/index.ts' },
      output: { success: true, content: 'File contents here...' },
      startedAt: mockSecondsAgo(10),
      completedAt: mockSecondsAgo(3),
    },
    overrides,
  );
}

export function createToolStateError(
  overrides: Partial<ToolStateError> = {},
): ToolStateError {
  return merge<ToolStateError>(
    {
      status: 'error',
      input: { path: '/src/missing.ts' },
      error: 'File not found: /src/missing.ts',
      startedAt: mockSecondsAgo(8),
      failedAt: mockSecondsAgo(7),
    },
    overrides,
  );
}

export function createToolStateInterrupted(
  overrides: Partial<ToolStateInterrupted> = {},
): ToolStateInterrupted {
  return merge<ToolStateInterrupted>(
    {
      status: 'interrupted',
      input: { command: 'npm run build' },
      startedAt: mockSecondsAgo(15),
      interruptedAt: mockSecondsAgo(12),
      reason: 'user_request',
    },
    overrides,
  );
}

// =============================================================================
// Message Factories
// =============================================================================

export function createUserMessage(overrides: Partial<UserMessage> = {}): UserMessage {
  return merge<UserMessage>(
    {
      id: mockId('msg'),
      sessionId: overrides.sessionId ?? mockId('sess'),
      role: 'user',
      createdAt: mockNow(),
    },
    overrides,
  );
}

export function createAssistantMessage(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return merge<AssistantMessage>(
    {
      id: mockId('msg'),
      sessionId: overrides.sessionId ?? mockId('sess'),
      role: 'assistant',
      createdAt: mockNow(),
      status: 'completed',
      modelId: 'claude-3.5-sonnet',
      providerId: 'anthropic',
      tokens: { prompt: 1200, completion: 800 },
      cost: 0.012,
      completedAt: mockNow(),
    },
    overrides,
  );
}

export function createSystemMessage(overrides: Partial<SystemMessage> = {}): SystemMessage {
  return merge<SystemMessage>(
    {
      id: mockId('msg'),
      sessionId: overrides.sessionId ?? mockId('sess'),
      role: 'system',
      createdAt: mockNow(),
    },
    overrides,
  );
}

// =============================================================================
// MessageWithParts Factories
// =============================================================================

/** A simple user message with one text part */
export function createUserMessageWithParts(
  text = 'Hello, can you help me with something?',
  sessionId?: string,
): MessageWithParts {
  const message = createUserMessage({ sessionId });
  return {
    message,
    parts: [createTextPart({ messageId: message.id }, text)],
  };
}

/** A simple assistant message with one text part */
export function createAssistantMessageWithParts(
  text = 'Sure! I would be happy to help. What do you need?',
  sessionId?: string,
): MessageWithParts {
  const message = createAssistantMessage({ sessionId });
  return {
    message,
    parts: [createTextPart({ messageId: message.id }, text)],
  };
}

/** An assistant message with reasoning + text */
export function createReasonedAssistantMessageWithParts(
  reasoning = 'The user is asking about TypeScript types...',
  text = 'In TypeScript, you can use interfaces for object shapes...',
  sessionId?: string,
): MessageWithParts {
  const message = createAssistantMessage({ sessionId });
  return {
    message,
    parts: [
      createReasoningPart({ messageId: message.id }, reasoning),
      createTextPart({ messageId: message.id }, text),
    ],
  };
}

/** An assistant message with a running tool call */
export function createAssistantMessageWithRunningTool(
  toolName = 'read-file',
  sessionId?: string,
): MessageWithParts {
  const message = createAssistantMessage({
    sessionId,
    status: 'streaming' as AssistantStatus,
  });
  return {
    message,
    parts: [
      createTextPart({ messageId: message.id }, 'Let me read that file for you.'),
      createToolPart(
        { messageId: message.id, name: toolName },
        createToolStateRunning(),
      ),
    ],
  };
}

/** An assistant message with a completed tool call + result text */
export function createAssistantMessageWithCompletedTool(
  toolName = 'read-file',
  sessionId?: string,
): MessageWithParts {
  const message = createAssistantMessage({ sessionId });
  return {
    message,
    parts: [
      createTextPart({ messageId: message.id }, 'Let me check that file.'),
      createToolPart(
        { messageId: message.id, name: toolName },
        createToolStateCompleted(),
      ),
      createTextPart({ messageId: message.id }, 'Here is what I found in the file. The main export is...'),
    ],
  };
}

/** An assistant message with an errored tool call */
export function createAssistantMessageWithErrorTool(
  toolName = 'shell',
  sessionId?: string,
): MessageWithParts {
  const message = createAssistantMessage({ sessionId });
  return {
    message,
    parts: [
      createTextPart({ messageId: message.id }, 'Running the build command...'),
      createToolPart(
        { messageId: message.id, name: toolName },
        createToolStateError(),
      ),
      createTextPart({ messageId: message.id }, 'The build failed. Let me check the error details...'),
    ],
  };
}

/** An assistant message with a step part */
export function createAssistantMessageWithStep(
  sessionId?: string,
): MessageWithParts {
  const message = createAssistantMessage({ sessionId });
  return {
    message,
    parts: [
      createStepPart({ messageId: message.id }),
      createTextPart({ messageId: message.id }, 'Here is my response after processing.'),
    ],
  };
}

// =============================================================================
// Conversation Builders
// =============================================================================

/** Build a full conversation (user + assistant alternating) */
export function createConversation(
  turns: Array<{ user: string; assistant: string }>,
  sessionId?: string,
): MessageWithParts[] {
  const sid = sessionId ?? mockId('sess');
  const messages: MessageWithParts[] = [];

  for (const turn of turns) {
    messages.push(createUserMessageWithParts(turn.user, sid));
    messages.push(createAssistantMessageWithParts(turn.assistant, sid));
  }

  return messages;
}

/** A realistic multi-turn conversation */
export function createTypicalConversation(sessionId?: string): MessageWithParts[] {
  const sid = sessionId ?? mockId('sess');
  return [
    createUserMessageWithParts('Can you look at the main entry point?', sid),
    {
      message: createAssistantMessage({ sessionId: sid }),
      parts: [
        createTextPart({}, 'Let me read the main entry file.'),
        createToolPart(
          { name: 'read-file' },
          createToolStateCompleted({
            input: { path: 'src/index.ts' },
            output: { success: true, content: 'export { main } from "./main";' },
          }),
        ),
        createTextPart({}, 'The main entry point exports a `main` function from `./main`. It looks well-structured.'),
      ],
    },
    createUserMessageWithParts('Can you add error handling to it?', sid),
    createAssistantMessageWithParts(
      'I will add proper error handling with try/catch blocks and error logging.',
      sid,
    ),
  ];
}

// =============================================================================
// Queued Message Factory
// =============================================================================

export function createQueuedMessage(
  overrides: Partial<QueuedMessage> = {},
): QueuedMessage {
  return merge<QueuedMessage>(
    {
      id: mockId('queued'),
      sessionId: overrides.sessionId ?? mockId('sess'),
      content: 'This is a queued message',
      position: 0,
      createdAt: mockNow(),
    },
    overrides,
  );
}
