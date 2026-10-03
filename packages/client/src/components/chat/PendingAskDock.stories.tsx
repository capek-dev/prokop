import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Ask, PermissionAsk } from '@prokopai/sdk';
import type { PendingAskRequest } from '@/stores/askStore';
import { PendingAskDock } from './PendingAskDock';
import { createPermissionAsk } from '../../../.storybook/mocks/mockPermission';

const sessionId = 'sess-1';

function permissionRequest(
  ask: PermissionAsk,
  toolCallId: string,
  toolName: string,
): PendingAskRequest {
  return { toolCallId, requestId: toolCallId, sessionId, toolName, ask };
}

const confirmAsk: Ask = {
  type: 'confirm',
  target: 'human',
  question: 'Overwrite the existing migration file?',
  description: 'A migration with this name already exists.',
  defaultValue: false,
};

const meta = {
  title: 'Chat/PendingAskDock',
  component: PendingAskDock,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Bottom dock for pending asks. One card at a time between transcript and input; the pager cycles stacked requests and tall cards scroll internally.',
      },
    },
  },
  args: {
    sessionId,
    onRespond: () => {},
  },
} satisfies Meta<typeof PendingAskDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SinglePermission: Story = {
  args: {
    requests: [
      permissionRequest(createPermissionAsk(), 'call-1', 'shell'),
    ],
  },
};

export const StackedPermissions: Story = {
  args: {
    requests: [
      permissionRequest(createPermissionAsk({
        question: 'Run command "git push --force" (outside workspace): Destructive action. Requires approval.',
        risk: 'critical',
      }), 'call-1', 'shell'),
      permissionRequest(createPermissionAsk({
        question: 'Write file src/auth.ts (within workspace): Workspace modification. Requires approval.',
        resource: 'file',
      }), 'call-2', 'write-file'),
      permissionRequest(createPermissionAsk({
        question: 'Run command "rm -rf node_modules" (within workspace): Workspace modification. Requires approval.',
        risk: 'high',
        patterns: ['rm -rf node_modules'],
        metadata: {
          command: 'rm -rf node_modules',
          baseCommand: 'rm',
          riskCategory: 'workspace-modification',
        },
      }), 'call-3', 'shell'),
    ],
  },
};

export const MixedAskTypes: Story = {
  args: {
    requests: [
      permissionRequest(createPermissionAsk(), 'call-1', 'shell'),
      { toolCallId: 'call-2', sessionId, toolName: 'ask-tool', ask: confirmAsk },
    ],
  },
};

export const TallCommandScrollsInternally: Story = {
  args: {
    requests: [
      permissionRequest(createPermissionAsk({
        question: 'Run command "npx create-next-app@latest my-app --typescript --eslint --app --src-dir --import-alias @/* --use-npm --no-tailwind" (within workspace): Workspace modification. Requires approval.',
        patterns: ['npx create-next-app@latest my-app --typescript --eslint --app --src-dir --import-alias @/* --use-npm --no-tailwind'],
        metadata: {
          command: 'npx create-next-app@latest my-app --typescript --eslint --app --src-dir --import-alias @/* --use-npm --no-tailwind',
          baseCommand: 'npx',
          riskCategory: 'workspace-modification',
        },
      }), 'call-1', 'shell'),
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'A very long command stays inside the dock: the card region is capped and scrolls instead of pushing the transcript away.',
      },
    },
  },
};

export const Empty: Story = {
  args: {
    requests: [],
  },
  parameters: {
    docs: {
      description: {
        story: 'No pending asks: the dock renders nothing and the layout is unchanged.',
      },
    },
  },
};
