import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatView } from './ChatView';
import {
  createSession,
} from '../../../.storybook/mocks/mockSession';
import {
  createPreconfigList,
} from '../../../.storybook/mocks/mockPreconfig';
import {
  createModelList,
} from '../../../.storybook/mocks/mockProvider';
import {
  createUserMessageWithParts,
  createAssistantMessageWithParts,
  createAssistantMessageWithRunningTool,
  createAssistantMessageWithCompletedTool,
  createAssistantMessageWithErrorTool,
  createReasonedAssistantMessageWithParts,
  createConversation,
  createTypicalConversation,
  createQueuedMessage,
  createToolStateCompleted,
  createToolPart,
  createTextPart,
  createAssistantMessage,
  createCompactionPart,
} from '../../../.storybook/mocks/mockMessage';
import { mockId } from '../../../.storybook/mocks/mockHelpers';
import { createPermissionAsk } from '../../../.storybook/mocks/mockPermission';
import {
  withServerDataStore,
  withUIStore,
} from '../../../.storybook/mocks/storeDecorators';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { useClientIdentityStore } from '@/stores/clientIdentityStore';

const preconfigs = createPreconfigList();
void preconfigs;
const models = createModelList().map((m) => ({
  id: m.id,
  name: m.name,
  contextWindow: m.contextWindow,
  tier: m.tier,
  providerId: m.providerId,
  providerName: m.providerName,
  capabilities: m.capabilities
    ? {
        input: m.capabilities.input
          ? {
              text: m.capabilities.input.text,
              image: m.capabilities.input.image,
              video: m.capabilities.input.video,
              file: !!m.capabilities.input.file,
            }
          : undefined,
      }
    : undefined,
}));
void models;

const defaultUsage = {
  promptTokens: 2500,
  completionTokens: 1800,
  totalTokens: 4300,
};
void defaultUsage;

const session = createSession({ title: 'Refactoring the auth module' });

const meta = {
  title: 'Composite/ChatView',
  component: ChatView,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <Story />
      </div>
    ),
    withServerDataStore(),
    withUIStore(),
  ],
  args: {
    session,
    messagesWithParts: createTypicalConversation(session.id),
    queuedMessages: [],
    prompts: [],
    onSendMessage: () => {},
    onRemoveFromQueue: () => {},
    pendingAskRequests: [],
    onAskResponse: () => {},
    modelSupportsImage: true,
  },
} satisfies Meta<typeof ChatView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyConversation: Story = {
  args: {
    messagesWithParts: [],
  },
};

export const LongConversation: Story = {
  args: {
    messagesWithParts: createConversation([
      { user: 'Can you help me refactor the authentication module?', assistant: 'Of course! Let me start by reading the current implementation to understand the structure.' },
      { user: 'Make sure to keep backward compatibility.', assistant: 'Understood. I will maintain all existing API surfaces while improving the internal structure.' },
      { user: 'Also add proper TypeScript types.', assistant: 'I will add comprehensive TypeScript types for all the interfaces and function signatures.' },
      { user: 'What about error handling?', assistant: 'I will add proper error handling with custom error classes and consistent error responses.' },
      { user: 'Can you add unit tests too?', assistant: 'Absolutely. I will write unit tests covering all the new functionality and edge cases.' },
      { user: 'Great, let me review the changes.', assistant: 'Sounds good! All changes are ready for your review. Let me know if you want me to adjust anything.' },
    ], session.id),
  },
};

export const WithToolCalls: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Read the package.json file and check the dependencies', session.id),
      createAssistantMessageWithCompletedTool('read-file', session.id),
      createUserMessageWithParts('Now run the test suite', session.id),
      createAssistantMessageWithCompletedTool('shell', session.id),
      createUserMessageWithParts('Looks good. What about linting?', session.id),
      createAssistantMessageWithParts('All linting checks pass. The codebase follows the configured ESLint rules correctly.', session.id),
    ],
  },
};

export const WithRunningTool: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Run the build and check for errors', session.id),
      createAssistantMessageWithRunningTool('shell', session.id),
    ],
    isStreaming: true,
    onInterrupt: () => {},
  },
};

export const WithErrorTool: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Delete the old config files', session.id),
      createAssistantMessageWithErrorTool('shell', session.id),
    ],
  },
};

export const WithReasoning: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Explain the architecture of this project', session.id),
      createReasonedAssistantMessageWithParts(
        'The user wants an architectural overview. I should look at the project structure, dependencies, and code organization to give a comprehensive answer...',
        'This project follows a monorepo architecture with separate packages for the server, client, and SDK. The server uses Hono for HTTP handling and the AI SDK for LLM interactions...',
        session.id,
      ),
    ],
  },
};

export const WithQueuedMessages: Story = {
  args: {
    messagesWithParts: createTypicalConversation(session.id),
    queuedMessages: [
      createQueuedMessage({ sessionId: session.id, content: 'Follow-up question about the refactoring' }),
      createQueuedMessage({ sessionId: session.id, content: 'Another message in the queue' }),
    ],
  },
};

export const WithPendingPermission: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Deploy to staging environment', session.id),
      {
        message: createAssistantMessage({ sessionId: session.id, status: 'streaming' }),
        parts: [
          createTextPart({}, 'I need to run the deployment command. Let me execute it.'),
          createToolPart(
            { name: 'shell' },
            createToolStateCompleted({
              input: { command: 'deploy staging' },
              output: { success: true, content: 'Deployed to staging' },
            }),
          ),
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

export const StreamingResponse: Story = {
  args: {
    messagesWithParts: [
      createUserMessageWithParts('Write a comprehensive README for the project', session.id),
      {
        message: createAssistantMessage({ sessionId: session.id, status: 'streaming' }),
        parts: [
          createTextPart({}, '# Project README\n\nThis is a comprehensive project that...\n\n## Features\n\n- Feature one\n- Feature two\n- Feature three\n\n## Installation\n\n```bash\nnpm install\n```\n\n## Usage\n\nThe project can be used by...'),
        ],
      },
    ],
    isStreaming: true,
    onInterrupt: () => {},
  },
};

export const ArchivedSession: Story = {
  args: {
    session: createSession({ title: 'Old conversation', status: 'closed' }),
    messagesWithParts: createTypicalConversation(
      createSession({ title: 'Old conversation', status: 'closed' }).id,
    ),
  },
};

export const SubagentSession: Story = {
  args: {
    session: createSession({
      title: 'Subagent: Explore codebase',
      parentId: 'parent-session-1',
      agentName: 'explore',
      subagentStatus: 'running',
    }),
    messagesWithParts: [
      {
        message: createAssistantMessage({ sessionId: session.id, role: 'assistant' }),
        parts: [
          createTextPart({}, 'I am exploring the codebase to find relevant files for the main task.'),
          createToolPart({ name: 'glob' }, createToolStateCompleted({
            input: { pattern: '**/*.ts' },
            output: { success: true, content: 'Found 42 TypeScript files' },
          })),
          createTextPart({}, 'Found 42 TypeScript files. Let me check the key entry points...'),
        ],
      },
    ],
  },
};

export const CompactingConversation: Story = {
  args: {
    isCompacting: true,
    onCompact: () => {},
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
      createUserMessageWithParts('First question about the project', session.id),
      createAssistantMessageWithParts('Here is the answer to your first question.', session.id),
      {
        message: createAssistantMessage({ sessionId: session.id }),
        parts: [createCompactionPart()],
      },
      createUserMessageWithParts('Second question after compaction', session.id),
      createAssistantMessageWithParts('Here is the answer to your second question.', session.id),
    ],
  },
};

export const HighTokenUsage: Story = {};

export const WithVariants: Story = {};

export const ObservingSession: Story = {
  args: {
    onClaimControl: () => {},
  },
  decorators: [
    (Story) => {
      useClientIdentityStore.setState({ clientId: 'story-me' });
      useSessionControlStore.setState({
        controlBySessionId: {
          [session.id]: {
            sessionId: session.id,
            controllerClientId: 'another-device',
            status: 'controlled',
          },
        },
      });
      return <Story />;
    },
  ],
};
