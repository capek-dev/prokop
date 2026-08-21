import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { TodoListItem } from '@prokopai/sdk';
import { TodoList } from '@/components/visualizations/TodoList';

const baseItem: TodoListItem = {
  content: 'Task',
  status: 'pending',
  priority: 'medium',
};

describe('TodoList', () => {
  it('renders nothing for empty items', () => {
    const { container } = render(<TodoList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders items with their content', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Write tests' },
      { ...baseItem, content: 'Ship feature' },
    ];
    render(<TodoList items={items} />);
    expect(screen.getByText('Write tests')).toBeInTheDocument();
    expect(screen.getByText('Ship feature')).toBeInTheDocument();
  });

  it('displays total item count', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'A' },
      { ...baseItem, content: 'B' },
      { ...baseItem, content: 'C' },
    ];
    render(<TodoList items={items} />);
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('displays completed count when items are completed', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Done', status: 'completed' },
      { ...baseItem, content: 'Pending' },
    ];
    render(<TodoList items={items} />);
    expect(screen.getByText('1 completed')).toBeInTheDocument();
  });

  it('hides completed count when none are completed', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Pending' },
    ];
    render(<TodoList items={items} />);
    expect(screen.queryByText(/completed/)).not.toBeInTheDocument();
  });

  it('shows custom title when provided', () => {
    render(<TodoList title="My Tasks" items={[{ ...baseItem, content: 'A' }]} />);
    expect(screen.getByText('My Tasks')).toBeInTheDocument();
  });

  it('shows "Todo List" as default title', () => {
    render(<TodoList items={[{ ...baseItem, content: 'A' }]} />);
    expect(screen.getByText('Todo List')).toBeInTheDocument();
  });

  it('applies line-through to completed items', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Done task', status: 'completed' },
    ];
    render(<TodoList items={items} />);
    const text = screen.getByText('Done task');
    expect(text.className).toContain('line-through');
  });

  it('applies muted styling to cancelled items', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Cancelled task', status: 'cancelled' },
    ];
    render(<TodoList items={items} />);
    const text = screen.getByText('Cancelled task');
    expect(text.className).toContain('text-muted-foreground');
  });

  it('shows high priority badge', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Urgent', priority: 'high' },
    ];
    render(<TodoList items={items} />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('shows low priority badge for non-completed items', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Low task', priority: 'low' },
    ];
    render(<TodoList items={items} />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('hides low priority badge for completed items', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Low done', priority: 'low', status: 'completed' },
    ];
    render(<TodoList items={items} />);
    const badges = screen.queryAllByText('low');
    expect(badges).toHaveLength(0);
  });

  it('hides low priority badge for cancelled items', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Low cancelled', priority: 'low', status: 'cancelled' },
    ];
    render(<TodoList items={items} />);
    expect(screen.queryByText('low')).not.toBeInTheDocument();
  });

  it('renders in_progress item with spin animation', () => {
    const items: TodoListItem[] = [
      { ...baseItem, content: 'Working', status: 'in_progress' },
    ];
    const { container } = render(<TodoList items={items} />);
    const spinningIcon = container.querySelector('.animate-spin');
    expect(spinningIcon).toBeInTheDocument();
  });
});
