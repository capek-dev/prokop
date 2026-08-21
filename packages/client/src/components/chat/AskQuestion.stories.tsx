import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Ask } from '@prokopai/sdk';
import type { PendingAskRequest } from '@/stores/askStore';
import { AskQuestion } from './AskQuestion';

function createAskRequest(ask: Ask, toolName = 'ask-tool'): PendingAskRequest {
  return {
    toolCallId: `call-${toolName}`,
    sessionId: 'sess-1',
    toolName,
    ask,
  };
}

const singleSelectAsk: Ask = {
  type: 'single_select',
  target: 'human',
  question: 'Which framework would you like to use?',
  description: 'Choose the framework for your new project.',
  options: [
    { value: 'react', label: 'React', description: 'A JavaScript library for building UIs' },
    { value: 'vue', label: 'Vue.js', description: 'The progressive JavaScript framework' },
    { value: 'svelte', label: 'Svelte', description: 'Cybernetically enhanced web apps' },
  ],
};

const multiSelectAsk: Ask = {
  type: 'multi_select',
  target: 'human',
  question: 'Which features do you want to include?',
  description: 'Select all that apply.',
  options: [
    { value: 'auth', label: 'Authentication' },
    { value: 'database', label: 'Database integration' },
    { value: 'api', label: 'REST API' },
    { value: 'testing', label: 'Testing setup' },
    { value: 'ci', label: 'CI/CD pipeline' },
  ],
  min: 1,
  max: 3,
};

const textAsk: Ask = {
  type: 'text',
  target: 'human',
  question: 'What is your project name?',
  description: 'This will be used for the directory name and package.json.',
  placeholder: 'my-awesome-project',
};

const confirmAsk: Ask = {
  type: 'confirm',
  target: 'human',
  question: 'Do you want to overwrite the existing file?',
  description: 'A file with this name already exists.',
  defaultValue: false,
};

const formAsk: Ask = {
  type: 'form',
  target: 'human',
  question: 'Project Configuration',
  description: 'Fill in the details for your new project.',
  questions: [
    {
      type: 'single_select',
      question: 'Which package manager?',
      options: [
        { value: 'npm', label: 'npm' },
        { value: 'yarn', label: 'Yarn' },
        { value: 'pnpm', label: 'pnpm' },
      ],
    },
    {
      type: 'confirm',
      question: 'Use TypeScript?',
    },
    {
      type: 'text',
      question: 'Project description',
      placeholder: 'A brief description',
    },
  ],
};

const permissionAsk: Ask = {
  type: 'permission',
  question: 'Run command "npm run build" (within workspace): Workspace modification. Requires approval.',
  risk: 'medium',
  resource: 'shell-command',
  scope: { type: 'shell-command', value: 'npm', label: 'npm run' },
  patterns: ['npm run build'],
  duration: 'session',
  metadata: {
    command: 'npm run build',
    baseCommand: 'npm',
    riskCategory: 'workspace-modification',
  },
};

const filePermissionAsk: Ask = {
  type: 'permission',
  question: 'Writing file "src/index.ts" requires approval.',
  risk: 'medium',
  resource: 'file',
  paths: ['/project/src/index.ts'],
  scope: { type: 'file', value: '/project/src/index.ts', label: 'index.ts' },
  patterns: ['file:index.ts'],
  duration: 'workspace',
  metadata: { operation: 'write', path: '/project/src/index.ts' },
};

const destructivePermissionAsk: Ask = {
  type: 'permission',
  question: 'Run command "rm -rf node_modules" (within workspace): Destructive operation. Requires approval.',
  risk: 'critical',
  resource: 'shell-command',
  scope: { type: 'shell-command', value: 'rm', label: 'rm -rf' },
  patterns: ['rm', 'rm:-rf'],
  duration: 'session',
  metadata: {
    command: 'rm -rf node_modules',
    baseCommand: 'rm',
    flags: ['-rf'],
    riskCategory: 'destructive',
  },
};

const clientCapabilityAsk: Ask = {
  type: 'client_capability',
  target: 'client',
  capability: 'browser_automation',
  metadata: {
    url: 'https://example.com',
    task: 'Take a screenshot of the homepage',
  },
};

const networkPermissionAsk: Ask = {
  type: 'permission',
  question: 'Fetch URL "api.example.com" requires approval.',
  risk: 'medium',
  resource: 'network',
  scope: { type: 'resource', value: 'https://api.example.com/data', label: 'api.example.com' },
  patterns: ['api.example.com'],
  duration: 'workspace',
  metadata: { url: 'https://api.example.com/data', host: 'api.example.com' },
};

const meta = {
  title: 'Chat/AskQuestion',
  component: AskQuestion,
  parameters: {
    layout: 'padded',
  },
  args: {
    request: createAskRequest(singleSelectAsk),
    onRespond: () => {},
  },
} satisfies Meta<typeof AskQuestion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSelect: Story = {
  args: {
    request: createAskRequest(singleSelectAsk),
  },
};

export const MultiSelect: Story = {
  args: {
    request: createAskRequest(multiSelectAsk),
  },
};

export const TextQuestion: Story = {
  args: {
    request: createAskRequest(textAsk),
  },
};

export const ConfirmQuestion: Story = {
  args: {
    request: createAskRequest(confirmAsk),
  },
};

export const FormQuestion: Story = {
  args: {
    request: createAskRequest(formAsk),
  },
};

export const PermissionShellCommand: Story = {
  args: {
    request: createAskRequest(permissionAsk, 'shell'),
  },
};

export const PermissionFileWrite: Story = {
  args: {
    request: createAskRequest(filePermissionAsk, 'edit'),
  },
};

export const PermissionDestructive: Story = {
  args: {
    request: createAskRequest(destructivePermissionAsk, 'shell'),
  },
};

export const PermissionNetwork: Story = {
  args: {
    request: createAskRequest(networkPermissionAsk, 'webfetch'),
  },
};

export const ClientCapability: Story = {
  args: {
    request: createAskRequest(clientCapabilityAsk, 'browser'),
  },
};

export const AllTypes: Story = {
  render: (args) => (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Single Select</span>
        <AskQuestion {...args} request={createAskRequest(singleSelectAsk)} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Multi Select</span>
        <AskQuestion {...args} request={createAskRequest(multiSelectAsk)} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Text</span>
        <AskQuestion {...args} request={createAskRequest(textAsk)} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Confirm</span>
        <AskQuestion {...args} request={createAskRequest(confirmAsk)} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Permission (medium)</span>
        <AskQuestion {...args} request={createAskRequest(permissionAsk, 'shell')} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Permission (critical)</span>
        <AskQuestion {...args} request={createAskRequest(destructivePermissionAsk, 'shell')} />
      </div>
    </div>
  ),
};
