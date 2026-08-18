import type { AutoApproveSeverity } from './session';

export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly';

export type ScheduledJobState = 'active' | 'paused' | 'completed';

export interface ScheduleConfigOnce {
  type: 'once';
  runAt: string;
}

export interface ScheduleConfigInterval {
  type: 'interval';
  intervalMinutes: number;
}

export interface ScheduleConfigDaily {
  type: 'daily';
  time: string;
}

export interface ScheduleConfigWeekly {
  type: 'weekly';
  days: number[];
  time: string;
}

export type ScheduleConfig =
  | ScheduleConfigOnce
  | ScheduleConfigInterval
  | ScheduleConfigDaily
  | ScheduleConfigWeekly;

export interface ScheduledJob {
  id: string;
  workspaceId: string;
  name: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleConfig: ScheduleConfig;
  scheduleDisplay: string;
  state: ScheduledJobState;
  repeatLimit: number | null;
  runCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  reuseSession: boolean;
  includeHistory: boolean;
  preconfigId: string | null;
  originSessionId: string | null;
  autoApproveSeverity: AutoApproveSeverity | null;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledJobInput {
  name: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleConfig: ScheduleConfig;
  repeatLimit?: number | null;
  reuseSession?: boolean;
  includeHistory?: boolean;
  preconfigId?: string | null;
  originSessionId?: string | null;
  autoApproveSeverity?: AutoApproveSeverity | null;
  notificationsEnabled?: boolean;
}

export interface UpdateScheduledJobInput {
  name?: string;
  prompt?: string;
  scheduleKind?: ScheduleKind;
  scheduleConfig?: ScheduleConfig;
  repeatLimit?: number | null;
  reuseSession?: boolean;
  includeHistory?: boolean;
  preconfigId?: string | null;
  autoApproveSeverity?: AutoApproveSeverity | null;
  state?: ScheduledJobState;
  notificationsEnabled?: boolean;
}
