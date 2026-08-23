import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ToolCall } from './ToolCall';
import {
  createToolPart,
  createToolStatePending,
  createToolStateRunning,
  createToolStateCompleted,
  createToolStateError,
  createToolStateInterrupted,
} from '../../../.storybook/mocks/mockMessage';
import { withSessionStore } from '../../../.storybook/mocks/storeDecorators';

const pendingPart = createToolPart(
  { name: 'read-file', callId: 'call-pending' },
  createToolStatePending({ input: { path: '/src/index.ts' } }),
);

const runningPart = createToolPart(
  { name: 'shell', callId: 'call-running' },
  createToolStateRunning({ input: { command: 'npm run build' } }),
);

const completedPart = createToolPart(
  { name: 'read-file', callId: 'call-completed' },
  createToolStateCompleted({
    input: { path: '/src/index.ts' },
    output: { success: true, content: 'export { main } from "./main";\nexport { config } from "./config";' },
  }),
);

const errorPart = createToolPart(
  { name: 'shell', callId: 'call-error' },
  createToolStateError({
    input: { command: 'npm run build' },
    error: 'Build failed with 12 TypeScript errors.',
  }),
);

const interruptedPart = createToolPart(
  { name: 'shell', callId: 'call-interrupted' },
  createToolStateInterrupted({
    input: { command: 'npm run test' },
  }),
);

const largeOutputPart = createToolPart(
  { name: 'read-file', callId: 'call-large' },
  createToolStateCompleted({
    input: { path: '/src/large-file.ts' },
    output: { success: true, content: 'Line 1\n'.repeat(200) },
  }),
);

const taskPart = createToolPart(
  { name: 'task', callId: 'call-task' },
  createToolStateRunning({
    input: { prompt: 'Explore the codebase structure' },
  }),
);

const taskCompletedPart = createToolPart(
  { name: 'task', callId: 'call-task-done' },
  createToolStateCompleted({
    input: { prompt: 'Explore the codebase structure' },
    output: {
      success: true,
      _visualization: {
        type: 'todo_list',
        title: 'Exploration tasks',
        items: [
          { id: '1', content: 'Map directory structure', status: 'completed', priority: 'high' },
          { id: '2', content: 'Identify entry points', status: 'completed', priority: 'high' },
          { id: '3', content: 'Find configuration files', status: 'in_progress', priority: 'medium' },
        ],
      },
    },
  }),
);

const meta = {
  title: 'Chat/ToolCall',
  component: ToolCall,
  parameters: {
    layout: 'padded',
  },
  decorators: [withSessionStore()],
  args: {
    sessionId: 'session-1',
    pendingAskRequests: [],
    onAskResponse: fn(),
    onNavigateToSubagent: fn(),
  },
} as Meta<typeof ToolCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  args: {
    part: pendingPart,
  },
};

export const Running: Story = {
  args: {
    part: runningPart,
  },
};

export const Completed: Story = {
  args: {
    part: completedPart,
  },
};

export const CompletedExpanded: Story = {
  args: {
    part: completedPart,
  },
};

export const Error: Story = {
  args: {
    part: errorPart,
  },
};

export const ErrorExpanded: Story = {
  args: {
    part: errorPart,
  },
};

export const Interrupted: Story = {
  args: {
    part: interruptedPart,
  },
};

export const LargeOutput: Story = {
  args: {
    part: largeOutputPart,
  },
};

export const TaskRunning: Story = {
  args: {
    part: taskPart,
  },
};

export const TaskCompletedWithVisualization: Story = {
  args: {
    part: taskCompletedPart,
  },
};

export const MultipleToolCalls: Story = {
  args: {
    part: completedPart,
    pendingAskRequests: [],
    onAskResponse: fn(),
    onNavigateToSubagent: fn(),
  },
  render: (args) => (
    <div className="max-w-2xl space-y-2">
      <ToolCall {...args} part={pendingPart} />
      <ToolCall {...args} part={runningPart} />
      <ToolCall {...args} part={completedPart} />
      <ToolCall {...args} part={errorPart} />
      <ToolCall {...args} part={interruptedPart} />
    </div>
  ),
};
