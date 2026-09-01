import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Part, TextPart } from '@prokopai/sdk';
import {
  buildUserPromptMapItems,
  canShowUserPromptMap,
  UserPromptMap,
} from '@/components/chat/UserPromptMap';

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function textPart(messageId: string, text: string): TextPart {
  return {
    id: `${messageId}-part`,
    messageId,
    type: 'text',
    text,
    createdAt: 1,
  };
}

function item(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  isQueued = false,
) {
  return {
    message: { id, role },
    parts: [textPart(id, text)] as Part[],
    isQueued,
  };
}

describe('UserPromptMap', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds an ordered stack from sent user prompts', () => {
    const result = buildUserPromptMapItems([
      item('user-1', 'user', ' First\n prompt '),
      item('assistant-1', 'assistant', 'Response'),
      item('queued-1', 'user', 'Not sent yet', true),
      item('user-2', 'user', 'Second prompt'),
    ]);

    expect(result.map(prompt => ({
      messageId: prompt.messageId,
      label: prompt.label,
    }))).toEqual([
      { messageId: 'user-1', label: 'First prompt' },
      { messageId: 'user-2', label: 'Second prompt' },
    ]);
  });

  it('only reserves the map when the chat container has spare width', () => {
    expect(canShowUserPromptMap(927)).toBe(false);
    expect(canShowUserPromptMap(928)).toBe(true);
  });

  it('navigates to the selected prompt when there is room', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    const onNavigate = vi.fn();

    render(
      <UserPromptMap
        displayItems={[
          item('user-1', 'user', 'Inspect the failing request'),
          item('assistant-1', 'assistant', 'Response'),
          item('user-2', 'user', 'Apply the focused fix'),
        ]}
        onNavigate={onNavigate}
      />,
    );

    await userEvent.click(screen.getByRole('button', {
      name: 'Go to prompt 2: Apply the focused fix',
    }));

    expect(onNavigate).toHaveBeenCalledWith('user-2');
  });

  it('previews the prompt on hover', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);

    render(
      <UserPromptMap
        displayItems={[item('user-1', 'user', 'Inspect the failing request before changing it')]}
        onNavigate={vi.fn()}
      />,
    );

    await userEvent.hover(screen.getByRole('button', {
      name: 'Go to prompt 1: Inspect the failing request before changing it',
    }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Inspect the failing request before changing it',
    );
  });

  it('does not render navigation controls in a narrow chat container', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);

    render(
      <UserPromptMap
        displayItems={[item('user-1', 'user', 'Inspect the failing request')]}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByRole('navigation', { name: 'User prompts' })).not.toBeInTheDocument();
  });
});
