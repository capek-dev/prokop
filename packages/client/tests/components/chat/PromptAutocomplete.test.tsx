import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { PromptInfo } from '@prokopai/sdk';
import { PromptAutocomplete } from '@/components/chat/PromptAutocomplete';

const prompts: PromptInfo[] = [
  { name: 'review', description: 'Review code changes', content: 'Review the following code' },
  { name: 'fix', description: 'Fix bugs', content: 'Fix the following bug' },
  { name: 'refactor', description: 'Refactor code', content: 'Refactor the following code' },
];

describe('PromptAutocomplete', () => {
  it('renders matching prompts', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query="re"
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('/review')).toBeInTheDocument();
    expect(screen.getByText('/refactor')).toBeInTheDocument();
    expect(screen.queryByText('/fix')).not.toBeInTheDocument();
  });

  it('shows all prompts when query is empty', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query=""
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('/review')).toBeInTheDocument();
    expect(screen.getByText('/fix')).toBeInTheDocument();
    expect(screen.getByText('/refactor')).toBeInTheDocument();
  });

  it('shows "No prompts matching" when no matches', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query="xyz"
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/No prompts matching "\/xyz"/)).toBeInTheDocument();
  });

  it('performs case-insensitive filtering', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query="FIX"
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('/fix')).toBeInTheDocument();
  });

  it('calls onSelect when prompt is clicked', async () => {
    const onSelect = vi.fn();
    render(
      <PromptAutocomplete
        prompts={prompts}
        query=""
        selectedIndex={0}
        onSelect={onSelect}
      />,
    );

    await userEvent.click(screen.getByText('/fix'));
    expect(onSelect).toHaveBeenCalledWith(prompts[1]);
  });

  it('highlights selected index', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query=""
        selectedIndex={1}
        onSelect={vi.fn()}
      />,
    );
    const fixBtn = screen.getByText('/fix').closest('button');
    expect(fixBtn?.className).toContain('bg-primary/20');
    expect(fixBtn?.className).toContain('ring-1');
  });

  it('displays prompt descriptions', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query=""
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Review code changes')).toBeInTheDocument();
    expect(screen.getByText('Fix bugs')).toBeInTheDocument();
    expect(screen.getByText('Refactor code')).toBeInTheDocument();
  });

  it('shows count of filtered prompts', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query="re"
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 prompts/)).toBeInTheDocument();
  });

  it('shows singular "prompt" for single match', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query="fix"
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 prompt /)).toBeInTheDocument();
  });

  it('shows keyboard navigation hints', () => {
    render(
      <PromptAutocomplete
        prompts={prompts}
        query=""
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('↑↓')).toBeInTheDocument();
    expect(screen.getByText('↵')).toBeInTheDocument();
    expect(screen.getByText('esc')).toBeInTheDocument();
  });
});
