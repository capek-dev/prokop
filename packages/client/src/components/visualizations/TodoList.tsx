import { Circle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { TodoListItem } from '@prokopai/sdk';
import { cn } from '@/lib/utils';

interface TodoListProps {
  title?: string;
  items: TodoListItem[];
}

interface StatusConfig {
  icon: typeof Circle;
  color: string;
  animate?: boolean;
}

const statusConfig: Record<TodoListItem['status'], StatusConfig> = {
  pending: {
    icon: Circle,
    color: 'text-muted-foreground',
  },
  in_progress: {
    icon: Loader2,
    color: 'text-warning',
    animate: true,
  },
  completed: {
    icon: CheckCircle,
    color: 'text-success',
  },
  cancelled: {
    icon: XCircle,
    color: 'text-destructive',
  },
};

const priorityConfig = {
  high: {
    label: 'high',
    className: 'bg-destructive/20 text-destructive',
  },
  medium: {
    label: '',
    className: '',
  },
  low: {
    label: 'low',
    className: 'text-muted-foreground',
  },
};

export function TodoList({ title, items }: TodoListProps) {
  if (items.length === 0) {
    return null;
  }

  let completedCount = 0;
  for (const item of items) {
    if (item.status === 'completed') completedCount++;
  }

  return (
    <div className="flex flex-col gap-3 w-full overflow-hidden">
      {(title || items.length > 0) && (
        <div className="text-sm font-medium text-foreground">
          {title || 'Todo List'}
          <span className="ml-2 text-muted-foreground">({items.length})</span>
          {completedCount > 0 && (
            <span className="ml-2 text-success text-xs">
              {completedCount} completed
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1 w-full">
        {items.map((item, index) => {
          const status = statusConfig[item.status];
          const StatusIcon = status.icon;
          const priority = priorityConfig[item.priority];

          return (
            <div
              key={index}
              className="flex items-center gap-2 text-sm min-w-0"
            >
              <StatusIcon
                className={cn(
                  'size-4 shrink-0',
                  status.color,
                  status.animate && 'animate-spin',
                )}
              />
              <span className={cn(
                'flex-1 break-all',
                item.status === 'completed' && 'line-through text-muted-foreground',
                item.status === 'cancelled' && 'text-muted-foreground',
              )}>
                {item.content}
              </span>
              {priority.label && item.priority === 'high' && (
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded shrink-0',
                  priority.className,
                )}>
                  {priority.label}
                </span>
              )}
              {item.priority === 'low' && item.status !== 'completed' && item.status !== 'cancelled' && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {priority.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
