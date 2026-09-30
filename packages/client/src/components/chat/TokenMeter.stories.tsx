import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SessionHarnessUsageState } from '@prokopai/sdk';
import { TokenMeter } from './TokenMeter';

function usage(overrides: Partial<SessionHarnessUsageState> = {}): SessionHarnessUsageState {
  return {
    used: 5000,
    contextWindow: 200000,
    rows: [
      { label: 'Input', value: '4,200' },
      { label: 'Output', value: '800' },
      { label: 'Total', value: '5,000' },
    ],
    ...overrides,
  };
}

const meta = {
  title: 'Chat/TokenMeter',
  component: TokenMeter,
  parameters: {
    layout: 'centered',
  },
  args: {
    usage: usage(),
  },
} satisfies Meta<typeof TokenMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoUsage: Story = {
  args: { usage: null },
};

export const MediumUsage: Story = {
  args: { usage: usage({ used: 40000, contextWindow: 100000 }) },
};

export const HighUsage: Story = {
  args: { usage: usage({ used: 70000, contextWindow: 100000 }) },
};

export const NearLimit: Story = {
  args: { usage: usage({ used: 92000, contextWindow: 100000 }) },
};

export const AtLimit: Story = {
  args: { usage: usage({ used: 100000, contextWindow: 100000 }) },
};

export const NoContextWindow: Story = {
  args: { usage: usage({ used: 5000, contextWindow: 0, rows: [{ label: 'Total', value: '5,000' }] }) },
};

export const LargeContext: Story = {
  args: { usage: usage({ used: 150000, contextWindow: 1000000 }) },
};

export const CodexStyle: Story = {
  args: {
    usage: usage({
      used: 12000,
      contextWindow: 200000,
      rows: [
        { label: 'Latest input', value: '9,500' },
        { label: 'Latest output', value: '2,500' },
        { label: 'Thread total', value: '48,000' },
        { label: 'Context window', value: '200,000' },
      ],
    }),
  },
};
