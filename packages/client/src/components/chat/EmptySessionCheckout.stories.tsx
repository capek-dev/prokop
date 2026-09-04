import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptySessionCheckout } from './EmptySessionCheckout';

const meta = {
  title: 'Chat/EmptySessionCheckout',
  component: EmptySessionCheckout,
  parameters: {
    layout: 'padded',
  },
  args: {},
} satisfies Meta<typeof EmptySessionCheckout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Same plain empty state for everyone; checkout lives in the input row. */
export const Default: Story = {};
