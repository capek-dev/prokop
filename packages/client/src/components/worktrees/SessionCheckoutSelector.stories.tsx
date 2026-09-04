import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ProkopaiClient } from '@prokopai/sdk';
import {
  SessionCheckoutSelector,
  SessionCheckoutStrip,
} from './SessionCheckoutSelector';
import {
  createSession,
  createWorkspace,
  createWorktree,
  createRefList,
  mockId,
} from '../../../.storybook/mocks';

function createSdkClient(
  worktrees: ReturnType<typeof createWorktree>[],
  refs: ReturnType<typeof createRefList>,
): ProkopaiClient {
  const created = createWorktree({ id: mockId('wt-new') });
  return {
    http: {
      workspaces: {
        listWorktrees: async () => ({ worktrees }),
        listWorktreeRefs: async () => ({ refs }),
        createWorktree: async () => ({ worktree: created }),
      },
      sessions: {
        bindWorktree: async () => ({ session: null }),
        unbindWorktree: async () => ({ session: null }),
      },
    },
  } as unknown as ProkopaiClient;
}

const workspace = createWorkspace({ name: 'prokop', path: '/Users/cherry/jean2' });
const twoWorktrees = [
  createWorktree({
    workspaceId: workspace.id,
    name: 'fix-auth',
    branch: 'fix/auth',
  }),
  createWorktree({
    workspaceId: workspace.id,
    name: 'redesign-settings',
    branch: 'feature/redesign-settings',
    dirty: true,
    untrackedCount: 2,
    attachments: [{ sessionId: mockId('sess'), title: 'Redesign', running: true }],
  }),
];

const meta = {
  title: 'Worktrees/SessionCheckoutSelector',
  component: SessionCheckoutSelector,
  parameters: {
    layout: 'padded',
  },
  args: {
    session: createSession({ workspaceId: workspace.id, title: null }),
  },
} satisfies Meta<typeof SessionCheckoutSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fresh session, primary checkout. */
export const PickerUnbound: Story = {
  args: {
    sdkClient: createSdkClient(twoWorktrees, createRefList()),
  },
};

/** Fresh session bound before the first message. */
export const PickerBound: Story = {
  args: {
    session: createSession({
      workspaceId: workspace.id,
      title: null,
      workspaceRootId: twoWorktrees[0].id,
    }),
    sdkClient: createSdkClient(twoWorktrees, createRefList()),
  },
};

/** 50 worktrees stay usable through the searchable list. */
export const PickerManyWorktrees: Story = {
  args: {
    sdkClient: createSdkClient(
      Array.from({ length: 50 }, (_, i) =>
        createWorktree({
          workspaceId: workspace.id,
          name: `feature-${i + 1}`,
          branch: `feature/issue-${i + 1}`,
          dirty: i % 4 === 0,
        })),
      createRefList(),
    ),
  },
};

/**
 * Strip variants: rendered below the input for bound sessions.
 */
const stripMeta = {
  ...meta,
  component: SessionCheckoutStrip,
} satisfies Meta<typeof SessionCheckoutStrip>;

export const StripBound: Story = {
  ...stripMeta,
  args: {
    session: createSession({
      workspaceId: workspace.id,
      title: null,
      workspaceRootId: twoWorktrees[1].id,
    }),
    sdkClient: createSdkClient(twoWorktrees, createRefList()),
  },
};

export const StripUnavailable: Story = {
  ...stripMeta,
  args: {
    session: createSession({
      workspaceId: workspace.id,
      title: null,
      workspaceRootId: 'missing-wt',
      worktree: {
        id: 'missing-wt',
        name: 'old-experiment',
        branch: 'experiment/old',
        path: '/Users/cherry/.prokopai/worktrees/old-experiment',
        state: 'missing',
      },
    }),
    sdkClient: createSdkClient(
      [
        createWorktree({
          id: 'missing-wt',
          workspaceId: workspace.id,
          name: 'old-experiment',
          branch: 'experiment/old',
          state: 'missing',
        }),
        ...twoWorktrees,
      ],
      createRefList(),
    ),
  },
};
