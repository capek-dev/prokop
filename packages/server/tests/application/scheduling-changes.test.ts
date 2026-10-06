import { expect, test } from 'bun:test';
import type { ScheduledJob } from '@prokopai/sdk';
import type { ScheduledJobRepositoryPort } from '@/application/ports/scheduling';
import { withScheduledJobChangeNotices } from '@/application/scheduling/changes';

const job = (id: string, workspaceId: string) => ({ id, workspaceId }) as ScheduledJob;

function repository(jobs: Record<string, ScheduledJob>): ScheduledJobRepositoryPort {
  return {
    create: (workspaceId) => job('new', workspaceId),
    get: (id) => jobs[id] ?? null,
    list: () => Object.values(jobs),
    update: (id) => jobs[id] ?? null,
    delete: (id) => Boolean(jobs[id]),
    deleteByWorkspace: (workspaceId) => Object.values(jobs).filter((j) => j.workspaceId === workspaceId).length,
    getDue: () => Object.values(jobs),
    markRun: () => {},
    markError: () => {},
    advance: () => {},
    markCompleted: () => {},
  };
}

test('every scheduled-job write reports its workspace so clients refetch instead of polling', () => {
  const changed: string[] = [];
  const jobs = withScheduledJobChangeNotices(repository({ a: job('a', 'ws-1'), b: job('b', 'ws-2') }),
    (workspaceId) => changed.push(workspaceId));

  jobs.create('ws-3', { name: 'n' } as never);
  jobs.update('a', { state: 'paused' });
  jobs.delete('b');
  jobs.deleteByWorkspace('ws-1');
  jobs.markRun('a', 'session-1');
  jobs.markError('a', 'boom');
  jobs.advance('a');
  jobs.markCompleted('a');

  expect(changed).toEqual(['ws-3', 'ws-1', 'ws-2', 'ws-1', 'ws-1', 'ws-1', 'ws-1', 'ws-1']);
});

test('reads and writes that changed nothing report nothing', () => {
  const changed: string[] = [];
  const jobs = withScheduledJobChangeNotices(repository({}), (workspaceId) => changed.push(workspaceId));

  jobs.get('missing');
  jobs.list('ws-1');
  jobs.getDue(Date.now());
  jobs.update('missing', { state: 'paused' });
  jobs.delete('missing');
  jobs.deleteByWorkspace('ws-empty');
  jobs.markRun('missing', 'session-1');

  expect(changed).toEqual([]);
});
