import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Ask, ClassifiedPermissionAsk } from '@prokopai/sdk';
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

// Permissions v2 classified asks: concern chips + evidence on the wire.
const concernsShellAsk = {
  type: 'permission',
  question: 'Allow this command to run?',
  description: 'rm with a destructive flag',
  resource: 'shell-command',
  action: 'execute',
  risk: 'high',
  concerns: ['destructive', 'escape', 'sensitive'],
  catastrophic: false,
  evidence: [
    'rm with a destructive flag',
    'path /Users/cherry/.ssh is outside the allowed roots',
    '.ssh references sensitive material',
  ],
  allowedScopes: ['once'],
  metadata: { command: 'rm -rf ~/.ssh', cwd: '/project', baseCommand: 'rm' },
} satisfies ClassifiedPermissionAsk;

const catastrophicShellAsk = {
  type: 'permission',
  question: 'Allow this command to run?',
  description: 'destructive target / is protected',
  resource: 'shell-command',
  action: 'execute',
  risk: 'critical',
  concerns: ['destructive'],
  catastrophic: true,
  evidence: ['destructive target / is protected'],
  allowedScopes: ['once'],
  metadata: { command: 'rm -rf /', cwd: '/project', baseCommand: 'rm' },
} satisfies ClassifiedPermissionAsk;

const escapeOnlyAsk = {
  type: 'permission',
  question: 'Allow this command to run?',
  description: 'path /etc/release is outside the allowed roots',
  resource: 'shell-command',
  action: 'execute',
  risk: 'medium',
  concerns: ['escape'],
  catastrophic: false,
  evidence: ['path /etc/release is outside the allowed roots'],
  allowedScopes: ['once', 'session', 'workspace'],
  metadata: { command: 'cat /etc/release', cwd: '/project', baseCommand: 'cat' },
} satisfies ClassifiedPermissionAsk;

// Highlighted pipeline: the flagged stage is marked, the rest recede.
const highlightedPipelineCommand = 'grep -rl "TODO" src --include=\'*.ts\' | xargs rm -rf | head -20';
const highlightedRm = highlightedPipelineCommand.indexOf('rm -rf');
const highlightedPipelineAsk = {
  type: 'permission',
  question: 'Allow Claude to run this command?',
  description: highlightedPipelineCommand,
  resource: 'shell-command',
  action: 'execute',
  risk: 'high',
  concerns: ['destructive', 'opaque'],
  catastrophic: false,
  evidence: ['under xargs: rm with a destructive flag', 'xargs runs a dangerous command'],
  highlights: [
    { start: highlightedRm, end: highlightedRm + 6, reason: 'deletes recursively or without confirmation' },
  ],
  commandSegments: [
    { start: 0, end: highlightedPipelineCommand.indexOf(' |') },
    { start: highlightedPipelineCommand.indexOf('xargs'), end: highlightedRm + 6 },
    { start: highlightedPipelineCommand.indexOf('head'), end: highlightedPipelineCommand.length },
  ],
  allowedScopes: ['once'],
  metadata: { command: highlightedPipelineCommand, cwd: '/project', baseCommand: 'grep' },
} satisfies ClassifiedPermissionAsk;

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

export const PermissionConcernChips: Story = {
  args: {
    request: createAskRequest(concernsShellAsk, 'shell'),
  },
};

export const PermissionCatastrophic: Story = {
  args: {
    request: createAskRequest(catastrophicShellAsk, 'shell'),
  },
};

export const PermissionHighlightedPipeline: Story = {
  args: {
    request: createAskRequest(highlightedPipelineAsk, 'claude-cli:Bash'),
  },
};

export const PermissionEscapeRememberable: Story = {
  args: {
    request: createAskRequest(escapeOnlyAsk, 'shell'),
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
