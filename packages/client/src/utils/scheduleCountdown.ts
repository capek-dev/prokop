import type { ScheduledJob } from '@prokopai/sdk';

export function formatNextRun(job: ScheduledJob, now: number = Date.now()): string {
  if (job.state === 'paused') return 'Paused';
  if (job.state === 'completed') return 'Completed';
  if (!job.nextRunAt) return job.state === 'active' ? 'Pending' : 'Inactive';

  const ts = new Date(job.nextRunAt).getTime();
  const diff = ts - now;

  if (diff <= 0) return 'Overdue';

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `in ${minutes}m`;
  return `in ${Math.floor(diff / 1000)}s`;
}

export function formatLastRun(job: ScheduledJob): string {
  if (!job.lastRunAt) return 'Never';
  const d = new Date(job.lastRunAt);
  return d.toLocaleString();
}
