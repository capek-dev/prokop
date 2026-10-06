import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/components/providers/QueryProvider', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { queryClient } from '@/components/providers/QueryProvider';
import { handleSchedulerChanged } from '@/handlers/serverMessage/schedulerHandlers';

const invalidate = vi.mocked(queryClient.invalidateQueries);

beforeEach(() => invalidate.mockClear());

test('a scheduler change refetches only that workspace\'s jobs', () => {
  handleSchedulerChanged('ws-1');
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['scheduledJobs', 'workspace', 'ws-1'] });
});

test('malformed workspace ids are ignored', () => {
  handleSchedulerChanged('');
  expect(invalidate).not.toHaveBeenCalled();
});
