import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorktreeCreateForm } from './WorktreeCreateForm';
import { createRef, createRefList } from '../../../.storybook/mocks';

const meta = {
  title: 'Worktrees/WorktreeCreateForm',
  component: WorktreeCreateForm,
  parameters: {
    layout: 'padded',
  },
  args: {
    refs: [
      createRef({ name: 'main', ref: 'refs/heads/main', current: true, checkedOut: true }),
      ...createRefList(6),
    ],
    existingWorktreeNames: [],
    refsLoading: false,
    pending: false,
    onCancel: () => {},
    onCreate: () => {},
  },
} satisfies Meta<typeof WorktreeCreateForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LoadingRefs: Story = {
  args: {
    refsLoading: true,
  },
};

export const NameConflict: Story = {
  args: {
    existingWorktreeNames: ['feature/branch-1'],
  },
};

export const Pending: Story = {
  args: {
    pending: true,
  },
};

export const ManyBranches: Story = {
  args: {
    refs: [
      createRef({ name: 'main', ref: 'refs/heads/main', current: true, checkedOut: true }),
      ...createRefList(40),
    ],
  },
};
