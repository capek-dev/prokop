import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, ScheduledJob } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/hooks/queries', () => ({
  useCreateScheduledJob: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateScheduledJob: () => ({ mutateAsync: mocks.update, isPending: false }),
}));

vi.mock('@/stores/serverDataStore', () => ({
  useServerDataStore: () => [],
}));

import { SchedulerJobModal } from '@/components/modals/SchedulerJobModal';

const sdkClient = {} as ProkopaiClient;
const workspaceId = 'ws-1';

function makeEditingJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    workspaceId,
    name: 'Existing Job',
    prompt: 'Do the thing',
    scheduleKind: 'interval',
    scheduleConfig: { type: 'interval', intervalMinutes: 60 },
    scheduleDisplay: 'Every 60m',
    state: 'active',
    repeatLimit: null,
    runCount: 0,
    nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    lastRunAt: null,
    lastRunSessionId: null,
    lastError: null,
    reuseSession: false,
    includeHistory: false,
    preconfigId: null,
    originSessionId: null,
    autoApproveSeverity: null,
    notificationsEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function fillRequiredCreateFields() {
  await userEvent.type(screen.getByLabelText('Name'), 'My Job');
  await userEvent.type(screen.getByLabelText('Prompt'), 'Run something');
}

describe('SchedulerJobModal - notifications', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.update.mockReset();
    mocks.create.mockResolvedValue({});
    mocks.update.mockResolvedValue({});
  });

  test('create mode renders the switch unchecked', () => {
    render(
      <SchedulerJobModal
        open={true}
        onOpenChange={() => {}}
        sdkClient={sdkClient}
        workspaceId={workspaceId}
        editingJob={null}
      />,
    );

    expect(screen.getByRole('switch', { name: /send notifications/i })).not.toBeChecked();
  });

  test('saving without enabling sends notificationsEnabled: false in create payload', async () => {
    render(
      <SchedulerJobModal
        open={true}
        onOpenChange={() => {}}
        sdkClient={sdkClient}
        workspaceId={workspaceId}
        editingJob={null}
      />,
    );

    await fillRequiredCreateFields();
    await userEvent.click(screen.getByRole('button', { name: /create job/i }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ notificationsEnabled: false }),
    );
  });

  test('enabling the switch sends notificationsEnabled: true in create payload', async () => {
    render(
      <SchedulerJobModal
        open={true}
        onOpenChange={() => {}}
        sdkClient={sdkClient}
        workspaceId={workspaceId}
        editingJob={null}
      />,
    );

    await fillRequiredCreateFields();
    await userEvent.click(screen.getByRole('switch', { name: /send notifications/i }));
    await userEvent.click(screen.getByRole('button', { name: /create job/i }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ notificationsEnabled: true }),
    );
  });

  test('edit mode renders checked when the job has notificationsEnabled true', () => {
    render(
      <SchedulerJobModal
        open={true}
        onOpenChange={() => {}}
        sdkClient={sdkClient}
        workspaceId={workspaceId}
        editingJob={makeEditingJob({ notificationsEnabled: true })}
      />,
    );

    expect(screen.getByRole('switch', { name: /send notifications/i })).toBeChecked();
  });

  test.each([
    ['false', false],
    ['absent', undefined],
  ])('edit mode renders unchecked when the job value is %s', (_label, notificationsEnabled) => {
    render(
      <SchedulerJobModal
        open={true}
        onOpenChange={() => {}}
        sdkClient={sdkClient}
        workspaceId={workspaceId}
        editingJob={makeEditingJob({ notificationsEnabled })}
      />,
    );

    expect(screen.getByRole('switch', { name: /send notifications/i })).not.toBeChecked();
  });

  test('saving an edited job includes the current boolean in the update payload', async () => {
    render(
      <SchedulerJobModal
        open={true}
        onOpenChange={() => {}}
        sdkClient={sdkClient}
        workspaceId={workspaceId}
        editingJob={makeEditingJob({ notificationsEnabled: true })}
      />,
    );

    // Toggle off, then save
    await userEvent.click(screen.getByRole('switch', { name: /send notifications/i }));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        updates: expect.objectContaining({ notificationsEnabled: false }),
      }),
    );
  });
});
