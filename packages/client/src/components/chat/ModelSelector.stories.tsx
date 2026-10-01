import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModelSelector } from './ModelSelector';
import {
  createModelList,
} from '../../../.storybook/mocks/mockProvider';

const models = createModelList().map((m) => ({
  id: m.id,
  name: m.name,
  contextWindow: m.contextWindow,
  providerId: m.providerId,
  providerName: m.providerName,
}));

const meta = {
  title: 'Chat/ModelSelector',
  component: ModelSelector,
  parameters: {
    layout: 'padded',
  },
  args: {
    models,
    selectedModelId: 'claude-3.5-sonnet',
    onChangeModel: () => {},
  },
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoSelection: Story = {
  args: {
    selectedModelId: undefined,
  },
};

export const SelectedGpt4o: Story = {
  args: {
    selectedModelId: 'gpt-4o',
  },
};

export const Compact: Story = {
  args: {
    compact: true,
  },
};

export const IconOnly: Story = {
  args: {
    iconOnly: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const SingleModel: Story = {
  args: {
    models: [
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
        providerId: 'anthropic',
        providerName: 'Anthropic',
      },
    ],
  },
};

export const ManyModels: Story = {
  args: {
    models: [
      ...models,
      {
        id: 'llama-3.1-70b',
        name: 'Llama 3.1 70B',
        contextWindow: 128000,
        providerId: 'openrouter',
        providerName: 'OpenRouter',
      },
      {
        id: 'llama-3.1-405b',
        name: 'Llama 3.1 405B',
        contextWindow: 128000,
        providerId: 'openrouter',
        providerName: 'OpenRouter',
      },
      {
        id: 'mistral-large',
        name: 'Mistral Large',
        contextWindow: 32000,
        providerId: 'openrouter',
        providerName: 'OpenRouter',
      },
    ],
  },
};

export const AllVariants: Story = {
  render: (args) => (
    <div className="flex items-center gap-6">
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Default</span>
        <ModelSelector {...args} compact={false} iconOnly={false} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Compact</span>
        <ModelSelector {...args} compact iconOnly={false} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Icon Only</span>
        <ModelSelector {...args} compact={false} iconOnly />
      </div>
    </div>
  ),
};
