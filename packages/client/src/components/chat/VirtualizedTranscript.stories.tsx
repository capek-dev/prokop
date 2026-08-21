import type { Meta, StoryObj } from '@storybook/react-vite';
import type { MessageWithParts } from '@prokopai/sdk';
import { VirtualizedTranscript } from './VirtualizedTranscript';
import {
  createUserMessageWithParts,
  createAssistantMessageWithParts,
  createAssistantMessageWithRunningTool,
  createAssistantMessageWithCompletedTool,
  createAssistantMessageWithErrorTool,
  createReasonedAssistantMessageWithParts,
  createConversation,
  createTypicalConversation,
  createToolStateCompleted,
  createToolPart,
  createTextPart,
  createAssistantMessage,
  createCompactionPart,
} from '../../../.storybook/mocks/mockMessage';
import { mockId } from '../../../.storybook/mocks/mockHelpers';
import { createPermissionAsk } from '../../../.storybook/mocks/mockPermission';
import { createSession } from '../../../.storybook/mocks/mockSession';

const session = createSession({ title: 'Transcript Session' });

function makeDisplayItems(messagesWithParts: ReturnType<typeof createTypicalConversation>) {
  return messagesWithParts.map((mwp) => ({
    message: mwp.message,
    parts: mwp.parts,
    isQueued: false,
  }));
}

const meta = {
  title: 'Composite/VirtualizedTranscript',
  component: VirtualizedTranscript,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    displayItems: makeDisplayItems(createTypicalConversation(session.id)),
    messagesWithParts: createTypicalConversation(session.id),
    sessionId: session.id,
    sessionStatus: 'active',
    pendingAskRequests: [],
    onAskResponse: () => {},
    onRemoveFromQueue: () => {},
    isMainActiveSession: true,
    autoFollow: true,
    onAutoScrollChange: () => {},
  },
} satisfies Meta<typeof VirtualizedTranscript>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyTranscript: Story = {
  args: {
    displayItems: [],
    messagesWithParts: [],
  },
};

export const LongConversation: Story = {
  args: {
    messagesWithParts: createConversation([
      { user: 'What is the project structure?', assistant: 'The project is organized as a monorepo with three main packages: server, client, and SDK.' },
      { user: 'What framework does the server use?', assistant: 'The server uses Hono, a lightweight web framework, along with the Vercel AI SDK for LLM interactions.' },
      { user: 'What about the client?', assistant: 'The client is built with React 19, Vite, TanStack Router, and Zustand for state management.' },
      { user: 'How is authentication handled?', assistant: 'Authentication uses a token-based system with middleware on the server side and secure storage on the client.' },
      { user: 'Can you explain the store architecture?', assistant: 'There are seven Zustand stores managing different aspects: session, server data, UI state, connection, chat layout, ask/permissions, and completion tracking.' },
      { user: 'What testing tools are available?', assistant: 'Currently no formal test framework is configured, but the plan is to use Bun\'s built-in test runner.' },
      { user: 'How does the virtualization work?', assistant: 'The transcript uses @tanstack/react-virtual for efficient rendering of large message lists with overscan and dynamic size estimation.' },
      { user: 'What about the theme system?', assistant: 'Themes use CSS custom properties with a light/dark mode and five color schemes: neutral, ocean, forest, sunset, and amethyst.' },
      { user: 'Tell me about the tool system.', assistant: 'Tools are separately versioned scripts that run as independent executables. They communicate with the server through a standardized protocol.' },
      { user: 'How are subagents handled?', assistant: 'Subagents are child sessions spawned by the main agent. They run independently and report results back to the parent session.' },
    ], session.id),
    displayItems: (() => {
      const mwps = createConversation([
        { user: 'What is the project structure?', assistant: 'The project is organized as a monorepo with three main packages: server, client, and SDK.' },
        { user: 'What framework does the server use?', assistant: 'The server uses Hono, a lightweight web framework, along with the Vercel AI SDK for LLM interactions.' },
        { user: 'What about the client?', assistant: 'The client is built with React 19, Vite, TanStack Router, and Zustand for state management.' },
        { user: 'How is authentication handled?', assistant: 'Authentication uses a token-based system with middleware on the server side and secure storage on the client.' },
        { user: 'Can you explain the store architecture?', assistant: 'There are seven Zustand stores managing different aspects: session, server data, UI state, connection, chat layout, ask/permissions, and completion tracking.' },
        { user: 'What testing tools are available?', assistant: 'Currently no formal test framework is configured, but the plan is to use Bun\'s built-in test runner.' },
        { user: 'How does the virtualization work?', assistant: 'The transcript uses @tanstack/react-virtual for efficient rendering of large message lists with overscan and dynamic size estimation.' },
        { user: 'What about the theme system?', assistant: 'Themes use CSS custom properties with a light/dark mode and five color schemes: neutral, ocean, forest, sunset, and amethyst.' },
        { user: 'Tell me about the tool system.', assistant: 'Tools are separately versioned scripts that run as independent executables. They communicate with the server through a standardized protocol.' },
        { user: 'How are subagents handled?', assistant: 'Subagents are child sessions spawned by the main agent. They run independently and report results back to the parent session.' },
      ], session.id);
      return mwps.map((mwp) => ({ message: mwp.message, parts: mwp.parts }));
    })(),
  },
};

export const WithToolCalls: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Read the main config file', session.id),
      createAssistantMessageWithCompletedTool('read-file', session.id),
      createUserMessageWithParts('Check the directory structure', session.id),
      createAssistantMessageWithCompletedTool('glob', session.id),
      createUserMessageWithParts('Run the build', session.id),
      createAssistantMessageWithCompletedTool('shell', session.id),
    ],
    displayItems: [
      { message: createUserMessageWithParts('Read the main config file', session.id).message, parts: createUserMessageWithParts('Read the main config file', session.id).parts },
      { message: createAssistantMessageWithCompletedTool('read-file', session.id).message, parts: createAssistantMessageWithCompletedTool('read-file', session.id).parts },
      { message: createUserMessageWithParts('Check the directory structure', session.id).message, parts: createUserMessageWithParts('Check the directory structure', session.id).parts },
      { message: createAssistantMessageWithCompletedTool('glob', session.id).message, parts: createAssistantMessageWithCompletedTool('glob', session.id).parts },
      { message: createUserMessageWithParts('Run the build', session.id).message, parts: createUserMessageWithParts('Run the build', session.id).parts },
      { message: createAssistantMessageWithCompletedTool('shell', session.id).message, parts: createAssistantMessageWithCompletedTool('shell', session.id).parts },
    ],
  },
};

export const WithStreamingTool: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Search the entire codebase for TODO comments', session.id),
      createAssistantMessageWithRunningTool('grep', session.id),
    ],
    displayItems: [
      { message: createUserMessageWithParts('Search the entire codebase for TODO comments', session.id).message, parts: createUserMessageWithParts('Search the entire codebase for TODO comments', session.id).parts },
      { message: createAssistantMessageWithRunningTool('grep', session.id).message, parts: createAssistantMessageWithRunningTool('grep', session.id).parts },
    ],
  },
};

export const WithErrorTool: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Try to deploy to production', session.id),
      createAssistantMessageWithErrorTool('shell', session.id),
    ],
    displayItems: [
      { message: createUserMessageWithParts('Try to deploy to production', session.id).message, parts: createUserMessageWithParts('Try to deploy to production', session.id).parts },
      { message: createAssistantMessageWithErrorTool('shell', session.id).message, parts: createAssistantMessageWithErrorTool('shell', session.id).parts },
    ],
  },
};

export const WithReasoning: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Explain the difference between the two approaches', session.id),
      createReasonedAssistantMessageWithParts(
        'Let me analyze both approaches systematically. The first approach uses a centralized store while the second uses local state with context...',
        'The key differences are: 1) Centralized state is easier to debug but harder to scale. 2) Local state with context provides better encapsulation...',
        session.id,
      ),
    ],
    displayItems: [
      { message: createUserMessageWithParts('Explain the difference between the two approaches', session.id).message, parts: createUserMessageWithParts('Explain the difference between the two approaches', session.id).parts },
      { message: createReasonedAssistantMessageWithParts('', '', session.id).message, parts: createReasonedAssistantMessageWithParts(
        'Let me analyze both approaches systematically...',
        'The key differences are...',
        session.id,
      ).parts },
    ],
  },
};

export const ArchivedSession: Story = {
  args: {
    sessionStatus: 'closed',
  },
};

export const Compacting: Story = {
  args: {
    isCompacting: true,
  },
};

export const CompactionSuccess: Story = {
  args: {
    compactionSuccess: true,
    onClearCompactionSuccess: () => {},
  },
};

export const WithCompactionDivider: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('First question', session.id),
      createAssistantMessageWithParts('First answer', session.id),
      {
        message: createAssistantMessage({ sessionId: session.id }),
        parts: [createCompactionPart()],
      },
      createUserMessageWithParts('Second question after compaction', session.id),
      createAssistantMessageWithParts('Second answer', session.id),
    ],
    displayItems: [
      { message: createUserMessageWithParts('First question', session.id).message, parts: createUserMessageWithParts('First question', session.id).parts },
      { message: createAssistantMessageWithParts('First answer', session.id).message, parts: createAssistantMessageWithParts('First answer', session.id).parts },
      { message: createAssistantMessage({ sessionId: session.id }), parts: [createCompactionPart()] },
      { message: createUserMessageWithParts('Second question after compaction', session.id).message, parts: createUserMessageWithParts('Second question after compaction', session.id).parts },
      { message: createAssistantMessageWithParts('Second answer', session.id).message, parts: createAssistantMessageWithParts('Second answer', session.id).parts },
    ],
  },
};

export const WithQueuedMessages: Story = {
  args: {
    displayItems: [
      ...makeDisplayItems(createTypicalConversation(session.id)),
      {
        message: { id: mockId('queued'), role: 'user' as const, sessionId: session.id, createdAt: Date.now() },
        parts: [createTextPart({}, 'Follow-up question in the queue')],
        isQueued: true,
        queueId: mockId('queued'),
      },
    ],
  },
};

export const WithPendingPermission: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Deploy to staging', session.id),
      {
        message: createAssistantMessage({ sessionId: session.id, status: 'streaming' }),
        parts: [
          createTextPart({}, 'I need permission to run the deploy command.'),
          createToolPart({ name: 'shell' }, createToolStateCompleted()),
        ],
      },
    ],
    displayItems: [
      { message: createUserMessageWithParts('Deploy to staging', session.id).message, parts: createUserMessageWithParts('Deploy to staging', session.id).parts },
      {
        message: createAssistantMessage({ sessionId: session.id, status: 'streaming' }),
        parts: [
          createTextPart({}, 'I need permission to run the deploy command.'),
          createToolPart({ name: 'shell' }, createToolStateCompleted()),
        ],
      },
    ],
    pendingAskRequests: [
      {
        toolCallId: mockId('call'),
        sessionId: session.id,
        toolName: 'shell',
        ask: createPermissionAsk() as import('@prokopai/sdk').Ask,
      },
    ],
  },
};

export const AutoFollowDisabled: Story = {
  args: {
    autoFollow: false,
  },
};

// =============================================================================
// User Messages with Code Blocks — current rendering bug
// =============================================================================
// The VirtualizedTranscript applies a newline-doubling regex to user message text:
//   part.text.replace(/\n(?!\n)/g, '\n\n')
// This runs on the ENTIRE string including inside code blocks, double-spacing
// every line inside fenced code. These stories reproduce the real-world issue
// so we can validate fixes and prevent regressions.

const userCodeBlockConversation: MessageWithParts[] = [
  {
    message: {
      id: mockId('msg'),
      sessionId: session.id,
      role: 'user' as const,
      createdAt: Date.now(),
    },
    parts: [
      createTextPart(
        {},
        'The deploy failed, here is the log:\n\n```text\n2025-03-15T09:42:11.890Z ERROR 18234 --- [app-server] [         worker-1] db.migrate : Migration "add-user-table" failed\nDatabaseException: ERROR: relation "users" already exists\n  Position: 214 [Failed SQL: (0)\n--changeset app:add-user-table splitStatements:false\n\ncreate table users (\n    id bigint primary key,\n    email varchar(255) unique,\n    created_at timestamp default now()\n);\n```\n',
      ),
    ],
  },
];

export const UserMessageWithCodeBlock: Story = {
  args: {
    messagesWithParts: userCodeBlockConversation,
    displayItems: userCodeBlockConversation.map((mwp) => ({
      message: mwp.message,
      parts: mwp.parts,
    })),
  },
};

const assistantCodeBlockConversation: MessageWithParts[] = [
  createUserMessageWithParts('Show me the migration SQL', session.id),
  {
    message: {
      id: mockId('msg'),
      sessionId: session.id,
      role: 'assistant' as const,
      status: 'completed' as const,
      modelId: 'claude-3.5-sonnet',
      providerId: 'anthropic',
      tokens: { prompt: 100, completion: 100 },
      cost: 0.001,
      completedAt: Date.now(),
      createdAt: Date.now(),
    },
    parts: [
      createTextPart(
        {},
        'Here is the migration:\n\n```sql\ncreate table users (\n    id bigint primary key,\n    email varchar(255) unique,\n    created_at timestamp default now()\n);\n```\n',
      ),
    ],
  },
];

export const AssistantMessageWithCodeBlock: Story = {
  name: 'Assistant Message With Code Block (control)',
  args: {
    messagesWithParts: assistantCodeBlockConversation,
    displayItems: assistantCodeBlockConversation.map((mwp) => ({
      message: mwp.message,
      parts: mwp.parts,
    })),
  },
};
