import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ScheduledJob, Session } from '@prokopai/sdk';

vi.mock('@/hooks/useNow', () => ({
  useNow: () => Date.now(),
}));

import { ScheduledJobsSection } from '@/components/layout/ScheduledJobsSection';

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    name: 'Test Job',
    prompt: 'Run',
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

const noopProps = {
  sessionsByJob: new Map<string, Session[]>(),
  currentSessionId: null,
  onCreateJob: () => {},
  onEditJob: () => {},
  onPauseJob: () => {},
  onResumeJob: () => {},
  onTriggerJob: () => {},
  onDeleteJob: () => {},
  onOpenSession: () => {},
};

describe('ScheduledJobsSection - notifications indicator', () => {
  test('shows session count instead of job count while collapsed', () => {
    render(<ScheduledJobsSection {...noopProps} jobs={[makeJob()]} sessionCount={23} />);
    expect(screen.getByLabelText('Scheduled sessions')).toHaveTextContent('23');
    expect(screen.queryByText('Test Job')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Scheduled'));
    expect(screen.getByText('Test Job')).toBeVisible();
  });

  test('shows the bell indicator when notifications are enabled', () => {
    render(
      <ScheduledJobsSection
        jobs={[makeJob({ notificationsEnabled: true })]}
        {...noopProps}
      />,
    );

    expect(screen.queryByText('Test Job')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Scheduled'));
    expect(screen.getByRole('img', { name: /notifications enabled/i })).toBeInTheDocument();
  });

  test('does not show the bell indicator when notifications are disabled', () => {
    render(
      <ScheduledJobsSection
        jobs={[makeJob({ notificationsEnabled: false })]}
        {...noopProps}
      />,
    );

    fireEvent.click(screen.getByText('Scheduled'));
    expect(screen.queryByRole('img', { name: /notifications enabled/i })).not.toBeInTheDocument();
  });
});
