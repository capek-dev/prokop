import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { AssistantMessage } from '@prokopai/sdk';
import { MessageBubble } from '@/components/chat/MessageBubble';

function assistant(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    id: 'a', sessionId: 's', role: 'assistant', status: 'completed', createdAt: 1_000, completedAt: 4_000,
    modelId: 'claude-sonnet', providerId: 'p', tokens: { prompt: 900, completion: 300 }, cost: 0,
    ...overrides,
  };
}

test('a finished turn shows model, duration and tokens beside the label', () => {
  render(<MessageBubble message={assistant({})} />);
  expect(screen.getByTestId('turn-meta')).toHaveTextContent('· claude-sonnet· 3.0s· 1.2k tok');
  expect(screen.getByText('· 1.2k tok')).toHaveAttribute('title', '900 in · 300 out');
});

test('a Codex turn without recorded tokens shows no token count', () => {
  render(<MessageBubble message={assistant({ tokens: { prompt: 0, completion: 0 } })} />);
  expect(screen.getByTestId('turn-meta')).not.toHaveTextContent('tok');
});
