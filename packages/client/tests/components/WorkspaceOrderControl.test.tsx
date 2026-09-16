import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { WorkspaceOrderControl } from '@/components/layout/WorkspaceOrderControl';
import { useUIStore } from '@/stores/uiStore';
import { WORKSPACE_ORDER_KEY } from '@/lib/workspaceOrder';

beforeEach(() => { useUIStore.setState({ workspaceOrder: 'newest' }); localStorage.clear(); });
afterEach(cleanup);

test('compact control exposes all five choices and persists selection', async () => {
  const user = userEvent.setup();
  render(<WorkspaceOrderControl compact />);
  await user.click(screen.getByRole('button', { name: 'Workspace order' }));
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(5);
  expect(screen.getByRole('menuitemradio', { name: 'Newest added' })).toHaveAttribute('aria-checked', 'true');
  await user.click(screen.getByRole('menuitemradio', { name: 'Recently active' }));
  expect(useUIStore.getState().workspaceOrder).toBe('active');
  expect(localStorage.getItem(WORKSPACE_ORDER_KEY)).toBe('active');
});

test('settings selector uses the same preference', async () => {
  const user = userEvent.setup();
  render(<WorkspaceOrderControl />);
  await user.click(screen.getByRole('combobox', { name: 'Workspace order' }));
  expect(screen.getAllByRole('option')).toHaveLength(5);
  await user.click(screen.getByRole('option', { name: 'Oldest added' }));
  expect(useUIStore.getState().workspaceOrder).toBe('oldest');
});
