import type { ScheduleConfig } from '@prokopai/sdk';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Scheduling domain: schedule computation and display. Moved byte-for-byte
 * from `store/schedule-utils.ts` in the S4 scheduling slice; the store module
 * now re-exports these functions for compatibility. No transport or
 * infrastructure imports belong here.
 */

/**
 * Compute the next run time (epoch ms) for a schedule config.
 * Returns null for 'once' schedules that are already in the past.
 */
export function computeNextRun(config: ScheduleConfig, fromNow: number = Date.now()): number | null {
  switch (config.type) {
    case 'once': {
      const ts = new Date(config.runAt).getTime();
      return Number.isFinite(ts) ? ts : null;
    }
    case 'interval': {
      return fromNow + config.intervalMinutes * 60_000;
    }
    case 'daily': {
      return nextDailyOccurrence(config.time, fromNow);
    }
    case 'weekly': {
      return nextWeeklyOccurrence(config.days, config.time, fromNow);
    }
  }
}

/**
 * Generate a human-readable description of the schedule.
 */
export function scheduleDisplay(config: ScheduleConfig): string {
  switch (config.type) {
    case 'once': {
      const d = new Date(config.runAt);
      return `Once at ${d.toLocaleString()}`;
    }
    case 'interval': {
      const mins = config.intervalMinutes;
      if (mins < 60) return `Every ${mins}m`;
      if (mins % 60 === 0) return `Every ${mins / 60}h`;
      return `Every ${mins}m`;
    }
    case 'daily': {
      return `Daily at ${config.time}`;
    }
    case 'weekly': {
      if (config.days.length === 0) return 'Weekly (no days set)';
      const isWeekdays =
        config.days.length === 5 &&
        [1, 2, 3, 4, 5].every(d => config.days.includes(d));
      if (isWeekdays) return `Weekdays at ${config.time}`;
      const names = [...config.days].sort().map(d => DAY_NAMES[d]);
      return `${names.join(', ')} at ${config.time}`;
    }
  }
}

function parseTimeToMinutes(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function nextDailyOccurrence(time: string, fromNow: number): number {
  const parsed = parseTimeToMinutes(time);
  if (!parsed) return fromNow + 24 * 60 * 60_000;

  const now = new Date(fromNow);
  const candidate = new Date(now);
  candidate.setHours(parsed.hour, parsed.minute, 0, 0);

  if (candidate.getTime() <= fromNow) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
}

function nextWeeklyOccurrence(days: number[], time: string, fromNow: number): number {
  const parsed = parseTimeToMinutes(time);
  if (!parsed || days.length === 0) return fromNow + 7 * 24 * 60 * 60_000;

  const now = new Date(fromNow);
  const daySet = new Set(days);

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(parsed.hour, parsed.minute, 0, 0);

    if (candidate.getTime() > fromNow && daySet.has(candidate.getDay())) {
      return candidate.getTime();
    }
  }

  return fromNow + 7 * 24 * 60 * 60_000;
}
