import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PromptInfo } from '@prokopai/sdk';
import { PromptAutocomplete } from './PromptAutocomplete';

const samplePrompts: PromptInfo[] = [
  {
    name: 'review',
    description: 'Review the current file for bugs and improvements',
    content: 'Review this file for bugs, performance issues, and best practice violations.',
  },
  {
    name: 'test',
    description: 'Generate tests for the current file',
    content: 'Generate comprehensive tests for this file using the projects test framework.',
  },
  {
    name: 'document',
    description: 'Add documentation to the current file',
    content: 'Add JSDoc documentation to all exported functions and types.',
  },
  {
    name: 'fix',
    description: 'Fix TypeScript errors',
    content: 'Fix all TypeScript errors in this file. ARG',
  },
  {
    name: 'refactor',
    description: 'Refactor to improve code quality',
    content: 'Refactor this code to improve readability, reduce complexity, and follow SOLID principles.',
  },
];

const meta = {
  title: 'Chat/PromptAutocomplete',
  component: PromptAutocomplete,
  parameters: {
    layout: 'centered',
  },
  args: {
    prompts: samplePrompts,
    query: '',
    selectedIndex: 0,
    onSelect: () => {},
  },
} satisfies Meta<typeof PromptAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllPrompts: Story = {};

export const FilteredResults: Story = {
  args: {
    query: 're',
  },
};

export const SingleResult: Story = {
  args: {
    query: 'fix',
  },
};

export const NoResults: Story = {
  args: {
    query: 'xyz',
  },
};

export const SelectedSecondItem: Story = {
  args: {
    query: '',
    selectedIndex: 2,
  },
};

export const EmptyPrompts: Story = {
  args: {
    prompts: [],
  },
};
